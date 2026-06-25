import { sceneApplyInputSchema } from '@three-agent/scene-contract';
import type { SceneController } from '../core/SceneController';

type Request = { id: string; method: string; params?: unknown };

const RECONNECT_DELAY_MS = 3_000;
const SESSION_REPLACED_CLOSE_CODE = 4001;

export class EditorBridge {
  private socket?: WebSocket;
  private retryTimer?: number;
  private disposed = false;

  constructor(private readonly controller: SceneController, private readonly onStatus: (status: string) => void) {}

  connect(url = import.meta.env.VITE_THREE_MCP_BRIDGE_URL ?? 'ws://127.0.0.1:8787/editor') {
    this.disposed = false;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;

    if (this.socket && (this.socket.readyState === WebSocket.CONNECTING || this.socket.readyState === WebSocket.OPEN)) {
      return;
    }

    this.open(url);
  }

  disconnect() {
    this.disposed = true;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;

    const socket = this.socket;
    this.socket = undefined;
    socket?.close(1000, '编辑器页面已关闭');
  }

  private open(url: string) {
    if (this.disposed) return;

    this.onStatus('正在连接 MCP 桥接服务…');
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      if (this.socket === socket) this.onStatus('MCP 桥接已连接');
    });
    socket.addEventListener('message', async (event) => this.onMessage(socket, event.data));
    socket.addEventListener('close', (event) => this.onClose(socket, url, event));
    socket.addEventListener('error', () => {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close();
    });
  }

  private onClose(socket: WebSocket, url: string, event: CloseEvent) {
    if (this.disposed || this.socket !== socket) return;

    this.socket = undefined;
    if (event.code === SESSION_REPLACED_CLOSE_CODE) {
      this.onStatus('MCP 桥接已由另一页面接管');
      return;
    }

    this.onStatus('MCP 桥接未连接（3 秒后重试）');
    if (this.retryTimer !== undefined) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.connect(url);
    }, RECONNECT_DELAY_MS);
  }

  private async onMessage(socket: WebSocket, raw: string) {
    let request: Request;
    try {
      request = JSON.parse(raw) as Request;
    } catch {
      return;
    }

    try {
      const data = await this.handle(request);
      this.send(socket, { id: request.id, data });
    } catch (error) {
      this.send(socket, { id: request.id, error: error instanceof Error ? error.message : '未知错误' });
    }
  }

  private async handle(request: Request) {
    switch (request.method) {
      case 'scene.getSummary': return this.controller.summary();
      case 'scene.getTree': return this.controller.getSceneTree();
      case 'scene.getSelected': return this.controller.getSelectedObjectInspector();
      case 'scene.select': {
        const params = request.params as { id?: unknown };
        return this.controller.selectObject(typeof params?.id === 'string' ? params.id : undefined);
      }
      case 'scene.validate': return this.controller.validate();
      case 'scene.capture': return this.controller.capture();
      case 'scene.undo': return this.controller.undo();
      case 'scene.redo': return this.controller.redo();
      case 'scene.applyOps': return this.controller.apply(sceneApplyInputSchema.parse(request.params));
      default: throw new Error(`不支持的方法：${request.method}`);
    }
  }

  private send(socket: WebSocket, payload: unknown) {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
  }
}
