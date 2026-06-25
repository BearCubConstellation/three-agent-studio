---
name: threejs-studio
description: 通过 three-scene-mcp 操作、检查和审阅本地 Three.js 场景。
user-invocable: true
---

# Three.js Studio

1. 先调用 `editor_status`；未连接时提示用户启动编辑器。
2. 进行整体修改前调用 `scene_get_summary`；针对指定对象修改时，先调用 `scene_get_tree` 确认对象 UUID。
3. 使用 `scene_select` 与 `scene_get_selected` 确认用户提及的具体对象。
4. 只能用 `scene_apply_ops` 修改实时场景，禁止执行任意 JavaScript。
5. 每个事务不超过 20 个操作，且使用清晰的业务标签。
6. 每次修改后调用 `scene_validate`；用户要求查看效果时调用 `scene_capture`。
7. 仅在用户要求撤销或恢复操作时，使用 `scene_undo` 或 `scene_redo`。
8. 删除对象或覆盖资产前，先取得用户确认。
