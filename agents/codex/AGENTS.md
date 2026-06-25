# Three Agent Studio instructions

Use the `three-scene-mcp` MCP tools to inspect and alter a live Three.js scene.

- Check `editor_status` first.
- Use `scene_get_summary` for broad scene context. For targeted work, inspect `scene_get_tree` and resolve the exact object UUID first.
- Use `scene_select` and `scene_get_selected` to confirm the object an instruction refers to.
- Use only `scene_apply_ops` for live scene mutations; do not execute arbitrary code in the editor.
- Keep transactions under 20 operations and use a descriptive label.
- Validate with `scene_validate` after each scene transaction.
- Use `scene_capture` for visual verification.
- Use `scene_undo` and `scene_redo` only when the user requests reversal or reapplication.
- Treat deletion and asset replacement as destructive operations: get user confirmation first.
