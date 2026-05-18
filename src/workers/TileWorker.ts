// src/workers/TileWorker.ts

self.addEventListener('message', async (e: MessageEvent) => {
    const { z, x, y } = e.data;

    // 1. 拼装免费的 OpenStreetMap 瓦片 URL
    const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;

    try {
        // 2. 后台网络请求
        const response = await fetch(url);
        const blob = await response.blob();

        // 3. 在后台线程直接进行图片解码！(关键性能优化)
        const imageBitmap = await createImageBitmap(blob);

        // 4. 将解码后的位图传输回主线程
        // 使用转移列表 (Transferable Objects)，实现无拷贝的高速跨线程通信
        self.postMessage({ z, x, y, imageBitmap }, { transfer: [imageBitmap] });
    } catch (error) {
        // 失败则通知主线程该瓦片加载异常
        self.postMessage({ z, x, y, error: true });
    }
});