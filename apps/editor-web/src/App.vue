<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { SceneController } from './core/SceneController';
import { EditorBridge } from './bridge/EditorBridge';

const viewport = ref<HTMLElement>();
const status = ref('初始化中…');
const summary = ref('');
const controller = new SceneController();

function refreshSummary() {
  summary.value = JSON.stringify(controller.summary(), null, 2);
}

function addCube() {
  controller.apply({ label: '手动添加立方体', ops: [{ type: 'addPrimitive', primitive: 'box', position: [0, 0.5, 0], color: '#5b8cff' }] });
  refreshSummary();
}

function undo() {
  controller.undo();
  refreshSummary();
}

onMounted(async () => {
  await nextTick();
  if (viewport.value) controller.mount(viewport.value);
  new EditorBridge(controller, (value) => { status.value = value; refreshSummary(); }).connect();
  refreshSummary();
});
</script>

<template>
  <main class="shell">
    <aside class="sidebar">
      <p class="eyebrow">MCP-READY 3D EDITOR</p>
      <h1>Three Agent Studio</h1>
      <p class="muted">浏览器持有场景状态；MCP 只发送受控操作。</p>
      <div class="actions">
        <button @click="addCube">添加立方体</button>
        <button class="secondary" @click="undo">撤销</button>
      </div>
      <section>
        <h2>桥接状态</h2>
        <p class="status">{{ status }}</p>
      </section>
      <section>
        <h2>场景概览</h2>
        <pre>{{ summary }}</pre>
      </section>
    </aside>
    <section ref="viewport" class="viewport" aria-label="Three.js 场景视口" />
  </main>
</template>
