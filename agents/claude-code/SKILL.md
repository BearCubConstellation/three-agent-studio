---
name: threejs-studio
description: Use the local Three.js MCP editor to create, inspect, select, modify, validate, and review 3D scenes.
---

# Three.js Studio

Use the `three-scene-mcp` MCP server for live scene work.

1. Call `editor_status` before scene work. If disconnected, ask the user to start the editor.
2. Call `scene_get_summary` before a broad edit. For a targeted edit, call `scene_get_tree` first and identify the exact object UUID.
3. Use `scene_select` and `scene_get_selected` when a user refers to a specific object or when confirming the target before a mutation.
4. Only use `scene_apply_ops` for live scene mutations; never inject arbitrary JavaScript or edit editor runtime code to alter a live scene.
5. Keep one transaction below 20 operations and give it a clear, user-facing label.
6. Call `scene_validate` after every mutation. Use `scene_capture` when the user asks to review the visual result.
7. Use `scene_undo` or `scene_redo` only when the user requests reversal or reapplication of a prior scene transaction.
8. Explain and request confirmation before deleting objects or replacing imported assets.
