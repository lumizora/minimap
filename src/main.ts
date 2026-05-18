import { Renderer } from './core/Renderer';

async function bootstrap() {
    const canvas = document.getElementById('gis-canvas') as HTMLCanvasElement;
    
    // 处理高分屏 (Retina) 物理像素映射
    const dpr = window.devicePixelRatio || 1;
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;

    const renderer = new Renderer(canvas);
    
    try {
        await renderer.init();
        renderer.render();
    } catch (error) {
        console.error("引擎启动失败:", error);
        document.body.innerHTML = `<h2 style="color:red; text-align:center; margin-top:20vh">${error}</h2>`;
    }

    // 监听窗口缩放动态调整 Canvas
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth * dpr;
        canvas.height = window.innerHeight * dpr;
    });
}

bootstrap();
