// src/math/TileMesh.ts
import { lonLatToCartesian } from './GeoMath';

export interface MeshData {
    vertexData: Float32Array;
    indexData: Uint16Array;
}

/**
 * 为单块瓦片动态编织 3D 几何网格与 UV 纹理坐标
 */
export function createTileMesh(minLon: number, minLat: number, maxLon: number, maxLat: number, segments: number = 4): MeshData {
    const vertexCount = (segments + 1) * (segments + 1);
    // 每个顶点包含 5 个 float: X, Y, Z (位置) + U, V (纹理坐标)
    const vertexData = new Float32Array(vertexCount * 5);
    const indices: number[] = [];

    let vIdx = 0;
    for (let i = 0; i <= segments; i++) {
        const u = i / segments;
        const lon = minLon + u * (maxLon - minLon);

        for (let j = 0; j <= segments; j++) {
            const v = j / segments;
            const lat = minLat + v * (maxLat - minLat);

            // 1. 经纬度转 3D 空间坐标
            const pos = lonLatToCartesian(lon, lat, 0);

            // 2. 填充顶点数据
            vertexData[vIdx++] = pos[0]; // X
            vertexData[vIdx++] = pos[1]; // Y
            vertexData[vIdx++] = pos[2]; // Z
            vertexData[vIdx++] = u;      // U (纹理X)
            vertexData[vIdx++] = 1.0 - v;// V (纹理Y，反转以匹配 WebGPU 坐标系)
        }
    }

    // 3. 生成索引三角面片 (Index Buffer)
    for (let i = 0; i < segments; i++) {
        for (let j = 0; j < segments; j++) {
            const r0 = i * (segments + 1) + j;
            const r1 = r0 + 1;
            const r2 = (i + 1) * (segments + 1) + j;
            const r3 = r2 + 1;

            // 顺时针画两个三角形组成一个正方形网格
            indices.push(r0, r1, r2);
            indices.push(r1, r3, r2);
        }
    }

    return {
        vertexData,
        indexData: new Uint16Array(indices)
    };
}