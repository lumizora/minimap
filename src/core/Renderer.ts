import { createTileMesh } from '../math/TileMesh';
import basicShaderCode from '../shaders/basic.wgsl?raw'; // 使用 Vite 的 ?raw 导入纯文本
import { OrbitCamera } from './OrbitCamera';
import { QuadtreeScheduler, TileKey } from './QuadtreeScheduler'; // 引入调度器
import TileWorker from '../workers/TileWorker?worker';

interface TileResource {
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    bindGroup: GPUBindGroup;
    numIndices: number;
}

export class Renderer {
    private adapter!: GPUAdapter;
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private format!: GPUTextureFormat;
    
    private pipeline!: GPURenderPipeline;
    private uniformBuffer!: GPUBuffer;
    private globalBindGroup!: GPUBindGroup; // Group 0
    private globalSampler!: GPUSampler;

    private camera!: OrbitCamera; // 新增相机实例
    private scheduler!: QuadtreeScheduler; // 新增调度器实例
    private worker!: Worker;

    private tileCache: Map<string, TileResource> = new Map();
    private loadingTiles: Set<string> = new Set();

    constructor(private canvas: HTMLCanvasElement) {}

    async init(): Promise<void> {
        const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) throw new Error("WebGPU not supported");
        this.adapter = adapter;
        this.device = await this.adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
        this.format = navigator.gpu.getPreferredCanvasFormat();

        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied',
        });

        this.camera = new OrbitCamera(this.canvas);
        this.scheduler = new QuadtreeScheduler(); // 初始化大脑

        this.worker = new TileWorker();
        this.worker.onmessage = (e) => this.handleWorkerMessage(e);

        this.setupPipeline();
        this.setupData();
    }

    private handleWorkerMessage(e: MessageEvent) {
        const { z, x, y, imageBitmap, error } = e.data;
        const key = `${z}-${x}-${y}`;
        this.loadingTiles.delete(key);

        if (error || !imageBitmap) return;

        // 1. 创建 GPU 纹理
        const texture = this.device.createTexture({
            size: [imageBitmap.width, imageBitmap.height, 1],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
        });

        this.device.queue.copyExternalImageToTexture(
            { source: imageBitmap },
            { texture },
            [imageBitmap.width, imageBitmap.height]
        );

        // 2. 生成对应的地形网格
        const lonStep = 180.0 / Math.pow(2, z);
        const latStep = 180.0 / Math.pow(2, z);
        const minLon = -180.0 + x * lonStep;
        const maxLon = minLon + lonStep;
        const minLat = -90.0 + y * latStep;
        const maxLat = minLat + latStep;
        
        const mesh = createTileMesh(minLon, minLat, maxLon, maxLat, 16);

        const vertexBuffer = this.device.createBuffer({
            size: mesh.vertexData.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(vertexBuffer, 0, mesh.vertexData);

        const indexBuffer = this.device.createBuffer({
            size: mesh.indexData.byteLength,
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        this.device.queue.writeBuffer(indexBuffer, 0, mesh.indexData);

        // 3. 创建 BindGroup
        const bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: this.globalSampler },
                { binding: 1, resource: texture.createView() }
            ]
        });

        this.tileCache.set(key, {
            vertexBuffer,
            indexBuffer,
            bindGroup,
            numIndices: mesh.indexData.length
        });

        imageBitmap.close();
    }

    private setupPipeline() {
        const shaderModule = this.device.createShaderModule({ code: basicShaderCode });

        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto', // 自动推导 BindGroup 布局
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
                buffers: [{
                    // 每个顶点包含 5 个 float (X, Y, Z, U, V)，每个 float 4 字节
                    arrayStride: 5 * 4, 
                    attributes: [
                        { 
                            // @location(0) position : vec3<f32>
                            shaderLocation: 0, 
                            offset: 0, 
                            format: 'float32x3' 
                        },
                        { 
                            // @location(1) uv : vec2<f32>
                            shaderLocation: 1, 
                            offset: 3 * 4, // 偏移前 3 个 float (X, Y, Z) 的字节数
                            format: 'float32x2' 
                        }
                    ]
                }]
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{ format: this.format }]
            },
            primitive: {
                topology: 'triangle-list', 
                cullMode: 'back', // 开启背面剔除，提升性能
            },
            // WebGPU 必须配置深度测试，否则背面的点会遮挡前面的点
            depthStencil: {
                depthWriteEnabled: true,
                depthCompare: 'less',
                format: 'depth24plus',
            },
        });
    }

    private setupData() {
        // 1. 创建 MVP 矩阵的 Uniform Buffer
        this.uniformBuffer = this.device.createBuffer({
            size: 16 * 4, // mat4x4 需要 16 个 float32
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        // 2. 创建 Group 0 (全局 MVP)
        this.globalBindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }]
        });

        // 3. 创建全局采样器
        this.globalSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
    }

    private depthTexture!: GPUTexture;

    render(): void {
        const aspect = this.canvas.width / this.canvas.height;
        const mvp = this.camera.update(aspect);
        this.device.queue.writeBuffer(this.uniformBuffer, 0, mvp);

        const activeTiles = this.scheduler.selectTiles(this.camera, this.canvas.height);
        
        if (Date.now() % 1000 === 0) {
            console.log(`📊 当前活跃瓦片: ${activeTiles.length} | 缓存数量: ${this.tileCache.size}`);
        }

        if (!this.depthTexture || this.depthTexture.width !== this.canvas.width || this.depthTexture.height !== this.canvas.height) {
            if (this.depthTexture) this.depthTexture.destroy();
            this.depthTexture = this.device.createTexture({
                size: [this.canvas.width, this.canvas.height],
                format: 'depth24plus',
                usage: GPUTextureUsage.RENDER_ATTACHMENT,
            });
        }

        const commandEncoder = this.device.createCommandEncoder();
        const textureView = this.context.getCurrentTexture().createView();

        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: textureView,
                clearValue: { r: 0.02, g: 0.05, b: 0.1, a: 1.0 }, 
                loadOp: 'clear',
                storeOp: 'store',
            }],
            depthStencilAttachment: {
                view: this.depthTexture.createView(),
                depthClearValue: 1.0,
                depthLoadOp: 'clear',
                depthStoreOp: 'store',
            }
        });

        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.globalBindGroup);

        for (const tile of activeTiles) {
            const key = `${tile.z}-${tile.x}-${tile.y}`;
            const resource = this.tileCache.get(key);

            if (resource) {
                passEncoder.setBindGroup(1, resource.bindGroup);
                passEncoder.setVertexBuffer(0, resource.vertexBuffer);
                passEncoder.setIndexBuffer(resource.indexBuffer, 'uint16');
                passEncoder.drawIndexed(resource.numIndices);
            } else if (!this.loadingTiles.has(key)) {
                this.loadingTiles.add(key);
                this.worker.postMessage(tile);
            }
        }

        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
        requestAnimationFrame(() => this.render());
    }
}
