// src/core/OrbitCamera.ts
import { WGS84_A } from '../math/GeoMath';
import * as Mat4 from '../math/Matrix4';

export class OrbitCamera {
    // 球面坐标系参数
    public radius: number = WGS84_A * 3.5; // 默认拉远到距离地心 3.5 倍地球半径的位置
    public theta: number = 0;             // 绕 Y 轴的旋转角 (经度)
    public phi: number = Math.PI / 4;     // 绕 X 轴的旋转角 (纬度)，默认俯视 45 度

    // 缓存的矩阵变量，避免每帧 GC 
    private viewMatrix = Mat4.create();
    private projMatrix = Mat4.create();
    public mvpMatrix = Mat4.create();

    private target = new Float32Array([0, 0, 0]); // 地心
    private up = new Float32Array([0, 0, 1]);     // Z 轴向上 (WGS84 惯例)
    public eye = new Float32Array(3);

    // 交互状态
    private isDragging = false;
    private lastMouseX = 0;
    private lastMouseY = 0;

    constructor(private canvas: HTMLCanvasElement) {
        this.attachEvents();
    }

    private attachEvents() {
        this.canvas.addEventListener('pointerdown', (e) => {
            this.isDragging = true;
            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        window.addEventListener('pointerup', () => {
            this.isDragging = false;
        });

        window.addEventListener('pointermove', (e) => {
            if (!this.isDragging) return;
            const deltaX = e.clientX - this.lastMouseX;
            const deltaY = e.clientY - this.lastMouseY;

            // 拖拽灵敏度
            this.theta -= deltaX * 0.005;
            this.phi -= deltaY * 0.005;

            // 限制 Phi (极角) 范围，防止翻转 (0.1 到 PI - 0.1)
            this.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.phi));

            this.lastMouseX = e.clientX;
            this.lastMouseY = e.clientY;
        });

        this.canvas.addEventListener('wheel', (e) => {
            // 缩放灵敏度与当前高度成正比 (越靠近地面缩放越慢)
            const zoomSpeed = this.radius * 0.1;
            this.radius += Math.sign(e.deltaY) * zoomSpeed;
            // 限制最近距离为地表以上一点点，最远为地球的 10 倍
            this.radius = Math.max(WGS84_A * 1.01, Math.min(WGS84_A * 10, this.radius));
        }, { passive: true });
    }

    /**
     * 每帧调用，计算最终的 MVP 矩阵
     */
    public update(aspectRatio: number): Float32Array {
        // 1. 球面坐标转笛卡尔坐标 (更新相机 Eye 位置)
        this.eye[0] = this.radius * Math.sin(this.phi) * Math.cos(this.theta);
        this.eye[1] = this.radius * Math.sin(this.phi) * Math.sin(this.theta);
        this.eye[2] = this.radius * Math.cos(this.phi);

        // 2. 更新 View 矩阵
        Mat4.lookAt(this.viewMatrix, this.eye, this.target, this.up);

        // 3. 更新 Projection 矩阵
        // 动态计算近截面和远截面，防止 Z-Fighting (深度冲突)
        const near = Math.max(100.0, this.radius - WGS84_A * 1.5);
        const far = this.radius + WGS84_A * 1.5;
        Mat4.perspective(this.projMatrix, Math.PI / 4, aspectRatio, near, far);

        // 4. MVP = Projection * View
        Mat4.multiply(this.mvpMatrix, this.projMatrix, this.viewMatrix);

        return this.mvpMatrix;
    }
}
