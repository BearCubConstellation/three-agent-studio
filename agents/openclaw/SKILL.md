---
name: threejs-studio
description: 通过 three-scene-mcp 操作本地 Three.js 场景。
user-invocable: true
---

# Three.js Studio

1. 先调用 `editor_status`；未连接时提示用户启动编辑器。
2. 修改前调用 `scene_get_summary`。
3. 只能用 `scene_apply_ops` 修改实时场景，禁止执行任意 JavaScript。
4. 每次修改后调用 `scene_validate`。
5. 用户要求查看效果时调用 `scene_capture`。
6. 删除对象或覆盖资产前，先取得用户确认。
