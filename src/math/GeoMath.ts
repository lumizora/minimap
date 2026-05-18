export const WGS84_A = 6378137.0; // 赤道半径 (a)
export const WGS84_B = 6356752.3142451793; // 极半径 (b)
const E2 = 1 - (WGS84_B * WGS84_B) / (WGS84_A * WGS84_A); // 第一偏心率平方 e^2

/**
 * 将经纬度(度)转换为 WebGPU 需要的 3D 笛卡尔坐标系
 * @param lon 经度 (度)
 * @param lat 纬度 (度)
 * @param height 高度 (米)
 * @returns [x, y, z] Float32Array
 */
export function lonLatToCartesian(lon: number, lat: number, height: number = 0): Float32Array {
    // 转换为弧度
    const radLon = (lon * Math.PI) / 180.0;
    const radLat = (lat * Math.PI) / 180.0;

    const cosLat = Math.cos(radLat);
    const sinLat = Math.sin(radLat);
    const cosLon = Math.cos(radLon);
    const sinLon = Math.sin(radLon);

    // 卯酉圈曲率半径 N
    const N = WGS84_A / Math.sqrt(1.0 - E2 * sinLat * sinLat);

    const x = (N + height) * cosLat * cosLon;
    const y = (N + height) * cosLat * sinLon;
    const z = (N * (1.0 - E2) + height) * sinLat;

    // WebGPU 中通常采用 Y 向上或者 Z 向上的右手坐标系
    // 这里我们直接输出，后续通过矩阵调整视角
    return new Float32Array([x, y, z]);
}

/**
 * 生成一个地球点云数据的 DOD 结构
 * @param resolution 经纬度的步长分辨率
 * @returns 包含所有点 [x,y,z] 的连续 Float32Array
 */
export function generateEarthPointCloud(resolution: number = 5): Float32Array {
    const points: number[] = [];
    for (let lat = -90; lat <= 90; lat += resolution) {
        for (let lon = -180; lon < 180; lon += resolution) {
            const pos = lonLatToCartesian(lon, lat, 0);
            points.push(pos[0], pos[1], pos[2]);
        }
    }
    return new Float32Array(points);
}