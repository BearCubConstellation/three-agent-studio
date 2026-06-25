import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { sceneApplyInputSchema } from '@three-agent/scene-contract';

const port = Number(process.env.THREE_MCP_BRIDGE_PORT ?? 8787);
const SESSION_REPLACED_CLOSE_CODE = 4001;
let editor: WebSocket | undefined;

type PendingRequest = {
  socket: WebSocket;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timer: NodeJS.Timeout;
};

const pending = new Map<string, PendingRequest>();

function rejectPendingForSocket(socket: WebSocket, reason: Error) {
  for (const [id, request] of pending) {
    if (request.socket !== socket) continue;
    clearTimeout(request.timer);
    pending.delete(id);
    request.reject(reason);
  }
}

const bridge = new WebSocketServer({ port, host: '127.0.0.1', path: '/editor' });
bridge.on('connection', (socket) => {
  const previousEditor = editor;
  editor = socket;

  if (previousEditor && previousEditor !== socket && previousEditor.readyState === WebSocket.OPEN) {
    previousEditor.close(SESSION_REPLACED_CLOSE_CODE, '新的编辑器页面已接管');
  }

  process.stderr.write('[three-scene-mcp] 编辑器已连接\n');

  socket.on('close', (code) => {
    if (editor === socket) editor = undefined;
    rejectPendingForSocket(socket, new Error('编辑器连接已关闭。'));

    if (code !== 1000 && code !== SESSION_REPLACED_CLOSE_CODE) {
      process.stderr.write(`[three-scene-mcp] 编辑器连接已断开（${code}）\n`);
    }
  });

  socket.on('message', (raw) => {
    let response: { id: string; data?: unknown; error?: string };
    try {
      response = JSON.parse(raw.toString()) as { id: string; data?: unknown; error?: string };
    } catch {
      return;
    }

    const request = pending.get(response.id);
    if (!request || request.socket !== socket) return;

    clearTimeout(request.timer);
    pending.delete(response.id);
    response.error ? request.reject(new Error(response.error)) : request.resolve(response.data);
  });
});
process.stderr.write(`[three-scene-mcp] 浏览器桥接监听 ws://127.0.0.1:${port}/editor\n`);

function callEditor(method: string, params: unknown = {}) {
  const target = editor;
  if (!target || target.readyState !== WebSocket.OPEN) {
    throw new Error('Three.js 编辑器未连接。请先运行 editor-web 并打开 http://127.0.0.1:5173。');
  }

  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`编辑器调用超时：${method}`));
    }, 15_000);

    pending.set(id, { socket: target, resolve, reject, timer });
    target.send(JSON.stringify({ id, method, params }), (error) => {
      if (!error) return;
      const request = pending.get(id);
      if (!request) return;
      clearTimeout(request.timer);
      pending.delete(id);
      request.reject(error);
    });
  });
}

const server = new McpServer(
  { name: 'three-scene-mcp', version: '0.2.1' },
  {
    instructions: '用于操作本地 Three.js 编辑器。修改前读取场景概览；修改后验证。仅使用结构化场景操作，不生成或执行任意 JavaScript。'
  }
);

const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }]
});

server.registerTool(
  'editor_status',
  {
    description: '检查浏览器中的 Three.js 编辑器是否已连接。',
    inputSchema: {}
  },
  async () => text({
    connected: Boolean(editor && editor.readyState === WebSocket.OPEN),
    bridge: `ws://127.0.0.1:${port}/editor`
  })
);

server.registerTool(
  'scene_get_summary',
  {
    description: '获取当前场景中对象、网格、灯光与相机摘要。',
    inputSchema: {}
  },
  async () => text(await callEditor('scene.getSummary'))
);

server.registerTool(
  'scene_get_tree',
  {
    description: '获取场景树，含对象 UUID、层级、类型、可见状态和当前选中状态。',
    inputSchema: {}
  },
  async () => text(await callEditor('scene.getTree'))
);

server.registerTool(
  'scene_get_selected',
  {
    description: '获取当前选中对象的名称、变换和标准材质属性；未选中时返回 null。',
    inputSchema: {}
  },
  async () => text(await callEditor('scene.getSelected'))
);

server.registerTool(
  'scene_select',
  {
    description: '按对象 UUID 选中场景对象。省略 id 可清除当前选择。',
    inputSchema: { id: z.string().min(1).optional() }
  },
  async ({ id }) => text(await callEditor('scene.select', { id }))
);

server.registerTool(
  'scene_apply_ops',
  {
    description: '批量执行受控的场景操作。每批最多 20 条，修改后应调用 scene_validate。',
    inputSchema: sceneApplyInputSchema.shape
  },
  async ({ label, ops }) => {
    const input = sceneApplyInputSchema.parse({ label, ops });
    return text(await callEditor('scene.applyOps', input));
  }
);

server.registerTool(
  'scene_validate',
  {
    description: '检查灯光、网格数量、对象数量和材质兼容性。',
    inputSchema: {}
  },
  async () => text({ issues: await callEditor('scene.validate') })
);

server.registerTool(
  'scene_undo',
  {
    description: '撤销最近一次场景事务。',
    inputSchema: {}
  },
  async () => text(await callEditor('scene.undo'))
);

server.registerTool(
  'scene_redo',
  {
    description: '重做最近一次被撤销的场景事务。',
    inputSchema: {}
  },
  async () => text(await callEditor('scene.redo'))
);

server.registerTool(
  'scene_capture',
  {
    description: '截取当前场景；返回 PNG 图像。',
    inputSchema: {}
  },
  async () => {
    const data = await callEditor('scene.capture') as { dataUrl: string };
    return {
      content: [{
        type: 'image' as const,
        data: data.dataUrl.replace(/^data:image\/png;base64,/, ''),
        mimeType: 'image/png'
      }]
    };
  }
);

await server.connect(new StdioServerTransport());
