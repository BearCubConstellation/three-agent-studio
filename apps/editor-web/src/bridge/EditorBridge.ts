import { sceneApplyInputSchema } from '@three-agent/scene-contract';
import type { SceneController } from '../core/SceneController';

type Request = { id: string; method: string; params?: unknown };

export class EditorBridge {
  private socket?: WebSocket;
  private retryTimer?: number;

  constructor(private readonly controller: SceneController, private readonly onStatus: (status: string) => void) {}

  connect(url = import.meta.env.VITE_THREE_MCP_BRIDGE_URL ?? 'ws://127.0.0.1:8787/editor') {
    this.socket?.close();
    this.onStatus('正在连接 MCP 桥接服务…');
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.addEventListener('open', () => this.onStatus('MCP 桥接已连接'));
    socket.addEventListener('message', async (event) => this.onMessage(event.data));
    socket.addEventListener('close', () => {
      this.onStatus('MCP 桥接未连接（3 秒后重试）');
      window.clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => this.connect(url), 3000);
    });
    socket.addEventListener('error', () => socket.close());
  }

  private async onMessage(raw: string) {
    const request = JSON.parse(raw) as Request;
    try {
      const data = await this.handle(request);
      this.send({ id: request.id, data });
    } catch (error) {
      this.send({ id: request.id, error: error instanceof Error ? error.message : '未知错误' });
    }
  }

  private async handle(request: Request) {
    switch (request.method) {
      case 'scene.getSummary': return this.controller.summary();
      case 'scene.validate': return this.controller.validate();
      case 'scene.capture': return this.controller.capture();
      case 'scene.undo': return this.controller.undo();
      case 'scene.applyOps': return this.controller.apply(sceneApplyInputSchema.parse(request.params));
      default: throw new Error(`不支持的方法：${request.method}`);
    }
  }

  private send(payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(payload));
  }
}
