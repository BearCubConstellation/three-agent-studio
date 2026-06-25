# Three Agent Studio

面向 **Claude Code、Codex、OpenClaw** 等 MCP 客户端的本地 Three.js 场景编辑平台。

## 首版能力

- Vue 3 + Three.js 真实场景编辑器
- MCP Server（stdio）通过本地 WebSocket 与编辑器连接
- 受控、可校验的场景操作协议：几何体、材质、灯光、相机、删除、撤销
- 场景概览、验证、截图
- Claude Code / Codex / OpenClaw 指令模板

## 架构

```text
Agent client → three-scene-mcp (stdio) → WebSocket → browser editor → Three.js scene
```

浏览器是实时场景状态的唯一来源。MCP 只发送经过 Schema 校验的声明式操作，不执行任意 JavaScript。

## 快速开始

要求：Node.js 20+、pnpm 10+。

```bash
pnpm install
pnpm dev:editor
# 新开一个终端
pnpm dev:mcp
```

打开 `http://127.0.0.1:5173`。页面显示“桥接已连接”后，MCP 客户端即可调用工具。

构建：

```bash
pnpm build
pnpm typecheck
```

## MCP 配置

将 [`mcp.example.json`](./mcp.example.json) 中的绝对路径换成你的仓库路径。不同客户端的指令模板见：

- `agents/claude-code/SKILL.md`
- `agents/codex/AGENTS.md`
- `agents/openclaw/SKILL.md`

## 当前 MCP 工具

| 工具 | 说明 |
| --- | --- |
| `editor_status` | 检查浏览器编辑器是否已连接 |
| `scene_get_summary` | 获取对象、网格、灯光、相机摘要 |
| `scene_apply_ops` | 批量执行声明式场景操作 |
| `scene_validate` | 检查灯光、网格、复杂度、材质 |
| `scene_undo` | 撤销最近一笔场景事务 |
| `scene_capture` | 返回当前场景 PNG |

## 下一阶段

- GLTF/GLB 导入导出
- HDRI 环境与贴图资产库
- 场景树、选中对象与参数面板
- 事务快照持久化、重做和项目文件
- 通过 WebSocket 推送进度与生成任务状态
