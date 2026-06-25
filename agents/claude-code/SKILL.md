---
name: threejs-studio
description: Use the local Three.js MCP editor to create, modify, validate, and inspect 3D scenes.
---

# Three.js Studio

Use the `three-scene-mcp` MCP server for live scene changes.

1. Call `editor_status` before scene work. If disconnected, ask the user to start the editor.
2. Before mutation, call `scene_get_summary`.
3. Only use `scene_apply_ops`; never inject arbitrary JavaScript or edit editor runtime code to alter a live scene.
4. Keep one transaction below 20 operations.
5. Call `scene_validate` after every mutation.
6. Use `scene_capture` when the user asks to review the visual result.
7. Explain and request confirmation before deleting objects or replacing imported assets.
