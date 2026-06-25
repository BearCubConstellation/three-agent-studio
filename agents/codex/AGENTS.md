# Three Agent Studio instructions

Use the `three-scene-mcp` MCP tools to alter a live Three.js scene.

- Check `editor_status` first.
- Read the scene with `scene_get_summary` before modifying it.
- Use only `scene_apply_ops` for live scene changes; do not execute arbitrary code in the editor.
- Validate with `scene_validate` after each scene transaction.
- Use `scene_capture` for visual verification.
- Treat deletion and asset replacement as destructive operations: get user confirmation first.
