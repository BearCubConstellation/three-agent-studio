import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { sceneApplyInputSchema } from '@three-agent/scene-contract';

const port = Number(process.env.THREE_MCP_BRIDGE_PORT ?? 8787);
let editor: WebSocket | undefined;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason?: unknown) => void; timer: NodeJS.Timeout }>();

const bridge = new WebSocketServer({ port, host: '127.0.0.1', path: '/editor' });
bridge.on('connection', (socket) => {
  editor?.close(1000, '新的编辑器已连接');
  editor = socket;
  process.stderr.write('[three-scene-mcp] 编辑器已连接\\n');
  socket.on('close', () => { if (editor === socket) editor = undefined; });
  socket.on('message', (raw) => {
    const response = JSON.parse(raw.toString()) as { id: string; data?: unknown; error?: string };
    const request = pending.get(response.id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(response.id);
    response.error ? request.reject(new Error(response.error)) : request.resolve(response.data);
  });
});
process.stderr.write(`[three-scene-mcp] 浏览器桥接监听 ws://127.0.0.1:${port}/editor\\n`);

function callEditor(method: string, params: unknown = {}) {
  if (!editor || editor.readyState !== WebSocket.OPEN) {
    throw new Error('Three.js 编辑器未连接。请先运行 editor-web 并打开 http://127.0.0.1:5173。');
  }
  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`编辑器调用超时：${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    editor!.send(JSON.stringify({ id, method, params }));
  });
}

const server = new McpServer({ name: 'three-scene-mcp', version: '0.1.0' }, {
  instructions: '用于操作本地 Three.js 编辑器。修改前读取场景概览；修改后验证。仅使用结构化场景操作，不生成或执行任意 JavaScript。'
});

server.tool('editor_status', '检查浏览器中的 Three.js 编辑器是否已连接。', {}, async () => ({
  content: [{ type: 'text', text: JSON.stringify({ connected: Boolean(editor && editor.readyState === WebSocket.OPEN), bridge: `ws://127.0.0.1:${port}/editor` }) }]
}));

server.tool('scene_get_summary', '获取当前场景中对象、网格、灯光与相机摘要。', {}, async () => {
  const data = await callEditor('scene.getSummary');
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
});

server.tool('scene_apply_ops', '批量执行受控的场景操作。每批最多 20 条，修改后应调用 scene_validate。', { input: sceneApplyInputSchema }, async ({ input }) => {
  const data = await callEditor('scene.applyOps', input);
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
});

server.tool('scene_validate', '检查灯光、网格数量、对象数量和材质兼容性。', {}, async () => {
  const data = await callEditor('scene.validate');
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: { issues: data } };
});

server.tool('scene_undo', '撤销最近一次由 scene_apply_ops 创建的场景事务。', {}, async () => {
  const data = await callEditor('scene.undo');
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data as Record<string, unknown> };
});

server.tool('scene_capture', '截取当前场景；返回 PNG data URL。', {}, async () => {
  const data = await callEditor('scene.capture') as { dataUrl: string };
  return { content: [{ type: 'image', data: data.dataUrl.replace(/^data:image\\/png;base64,/, ''), mimeType: 'image/png' }] };
});

await server.connect(new StdioServerTransport());
