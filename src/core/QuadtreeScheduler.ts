// src/core/QuadtreeScheduler.ts
import { WGS84_A, lonLatToCartesian } from '../math/GeoMath';
import { OrbitCamera } from './OrbitCamera';

// 扁平化的瓦片坐标结构定义
export interface TileKey {
    z: number;
    x: number;
    y: number;
}

export class QuadtreeScheduler {
    // 最大允许细分的层级，防止无限细分导致内存崩溃
    private maxLevel = 18;
    // 屏幕空间误差阈值 (像素)，值越小越清晰，但瓦片数量暴增
    private sseThreshold = 4.0;

    // 每一帧计算出的可见瓦片结果池 (复用数组，防止 GC)
    private visibleTiles: TileKey[] = [];

    // 预分配的临时数学变量，实现零分配计算
    private tileCenter = new Float32Array(3);
    private cameraToTile = new Float32Array(3);

    constructor() {}

    /**
     * 调度主入口：计算当前相机视野下的可见瓦片列表
     */
    public selectTiles(camera: OrbitCamera, canvasHeight: number): TileKey[] {
        this.visibleTiles.length = 0; // 清空上一帧结果，保持内存引用

        // Level 0 定义：全球地理坐标系 (EPSG:4326) 划分为东西两个半球根瓦片
        // 根瓦片 1: Z=0, X=0, Y=0 (西半球: -180 到 0 经度)
        // 根瓦片 2: Z=0, X=1, Y=0 (东半球: 0 到 180 经度)
        this.traverseNode(0, 0, 0, camera, canvasHeight);
        this.traverseNode(0, 1, 0, camera, canvasHeight);

        return this.visibleTiles;
    }

    /**
     * 递归遍历四叉树节点
     */
    private traverseNode(z: number, x: number, y: number, camera: OrbitCamera, canvasHeight: number) {
        // 1. 计算当前瓦片的经纬度范围 (Extent)
        const extent = this.getTileExtent(z, x, y);
        
        // 2. 地平线背面裁剪 (Horizon Culling) - 最强的 GIS 优化第一性原理
        // 如果瓦片完全转到了地球背面，直接剔除，不需要进一步计算
        if (this.isBehindHorizon(extent, camera.eye)) {
            return; 
        }

        // 3. 计算当前的屏幕空间误差 (SSE)
        const sse = this.calculateSSE(z, extent, camera, canvasHeight);

        // 4. 评估是否需要分裂
        // 如果误差大于阈值，且未达到最大层级 -> 触发细分分裂，递归调用4个子节点
        if (sse > this.sseThreshold && z < this.maxLevel) {
            const nextZ = z + 1;
            const nextX = x * 2;
            const nextY = y * 2;

            this.traverseNode(nextZ, nextX,     nextY,     camera, canvasHeight); // 左下
            this.traverseNode(nextZ, nextX + 1, nextY,     camera, canvasHeight); // 右下
            this.traverseNode(nextZ, nextX,     nextY + 1, camera, canvasHeight); // 左上
            this.traverseNode(nextZ, nextX + 1, nextY + 1, camera, canvasHeight); // 右上
        } else {
            // 否则，当前瓦片就是最合适的渲染层级，将其记录到可见列表
            this.visibleTiles.push({ z, x, y });
        }
    }

    /**
     * 根据 Z, X, Y 换算瓦片的经纬度边界范围
     */
    private getTileExtent(z: number, x: number, y: number) {
        const lonStep = 180.0 / Math.pow(2, z); // Level 0 跨度是 180 度
        const latStep = 180.0 / Math.pow(2, z); // Level 0 跨度是 180 度

        const minLon = -180.0 + x * lonStep;
        const maxLon = minLon + lonStep;
        const minLat = -90.0 + y * latStep;
        const maxLat = minLat + latStep;

        return { minLon, minLat, maxLon, maxLat };
    }

    /**
     * 判断瓦片是否完全沉入地平线背面
     */
    private isBehindHorizon(extent: { minLon: number, minLat: number, maxLon: number, maxLat: number }, cameraEye: Float32Array): boolean {
        // 取瓦片的中心点经纬度
        const centerLon = (extent.minLon + extent.maxLon) * 0.5;
        const centerLat = (extent.minLat + extent.maxLat) * 0.5;
        
        // 转换为笛卡尔世界坐标
        const cartesian = lonLatToCartesian(centerLon, centerLat, 0);
        this.tileCenter[0] = cartesian[0];
        this.tileCenter[1] = cartesian[1];
        this.tileCenter[2] = cartesian[2];

        // 计算地球切线相交夹角
        // 如果 相机到地心的向量 与 瓦片中心到地心的向量 的点积满足一定条件，说明在背面
        const dot = cameraEye[0] * this.tileCenter[0] + 
                    cameraEye[1] * this.tileCenter[1] + 
                    cameraEye[2] * this.tileCenter[2];

        // 视线安全阈值（考虑椭球体曲率，这里做极简安全截断）
        return dot < (WGS84_A * WGS84_A) * 0.5;
    }

    /**
     * 计算瓦片的屏幕空间误差 (SSE)
     */
    private calculateSSE(z: number, extent: any, camera: OrbitCamera, canvasHeight: number): number {
        // 1. 估算当前层级瓦片的本征几何误差 (Geometric Error)
        // Level 0 的最大几何误差约为地球半径，每升一级误差减半
        const geometricError = WGS84_A / Math.pow(2, z);

        // 2. 计算相机到瓦片中心的物理距离
        const dx = camera.eye[0] - this.tileCenter[0];
        const dy = camera.eye[1] - this.tileCenter[1];
        const dz = camera.eye[2] - this.tileCenter[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // 防止除以 0
        if (distance === 0) return Infinity;

        // 3. 标准 GIS SSE 投影换算公式
        const fov = Math.PI / 4; // 45度 FOV
        const sse = (geometricError * canvasHeight) / (2.0 * distance * Math.tan(fov * 0.5));
        
        return sse;
    }
}
