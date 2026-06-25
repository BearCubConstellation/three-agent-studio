<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { EditorBridge } from './bridge/EditorBridge';
import {
  SceneController,
  type EnvironmentState,
  type SceneObjectInspector,
  type SceneTreeItem,
  type TransformMode,
  type Vector3Tuple
} from './core/SceneController';

interface InspectorForm extends SceneObjectInspector {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

const axes = ['X', 'Y', 'Z'] as const;
const viewport = ref<HTMLElement>();
const gltfInput = ref<HTMLInputElement>();
const hdriInput = ref<HTMLInputElement>();
const projectInput = ref<HTMLInputElement>();
const bridgeStatus = ref('初始化中…');
const notice = ref('');
const summary = ref('');
const tree = ref<SceneTreeItem[]>([]);
const inspector = ref<InspectorForm>();
const environment = ref<EnvironmentState>({ showBackground: false });
const controller = new SceneController();
const transformMode = ref<TransformMode>(controller.getTransformMode());
let stopSync: (() => void) | undefined;

function toInspectorForm(value: SceneObjectInspector | undefined): InspectorForm | undefined {
  if (!value) return undefined;
  return {
    ...value,
    position: [...value.position] as Vector3Tuple,
    rotation: [...value.rotation] as Vector3Tuple,
    scale: [...value.scale] as Vector3Tuple,
    material: value.material ? { ...value.material } : undefined
  };
}

function refreshEditorState() {
  summary.value = JSON.stringify(controller.summary(), null, 2);
  tree.value = controller.getSceneTree();
  inspector.value = toInspectorForm(controller.getSelectedObjectInspector());
  environment.value = controller.getEnvironmentState();
  transformMode.value = controller.getTransformMode();
}

async function runAction(successMessage: string, action: () => Promise<unknown> | unknown) {
  try {
    await action();
    notice.value = successMessage;
  } catch (error) {
    notice.value = `操作失败：${error instanceof Error ? error.message : '未知错误'}`;
  } finally {
    refreshEditorState();
  }
}

function addCube() {
  void runAction('已添加立方体。', () => controller.apply({
    label: '手动添加立方体',
    ops: [{ type: 'addPrimitive', primitive: 'box', position: [0, 0.5, 0], color: '#5b8cff' }]
  }));
}

function setTransformMode(mode: TransformMode) {
  controller.setTransformMode(mode);
  notice.value = `变换模式：${mode === 'translate' ? '移动' : mode === 'rotate' ? '旋转' : '缩放'}`;
  refreshEditorState();
}

function undo() {
  const result = controller.undo();
  notice.value = result.restored ? `已撤销：${result.label}` : result.message;
  refreshEditorState();
}

function redo() {
  const result = controller.redo();
  notice.value = result.restored ? `已重做：${result.label}` : result.message;
  refreshEditorState();
}

function selectTreeItem(id: string) {
  controller.selectObject(id);
  refreshEditorState();
}

function applyInspector() {
  if (!inspector.value) return;
  void runAction('对象属性已更新。', () => controller.updateObject(inspector.value!.id, {
    name: inspector.value!.name,
    visible: inspector.value!.visible,
    position: inspector.value!.position,
    rotation: inspector.value!.rotation,
    scale: inspector.value!.scale,
    material: inspector.value!.material
  }));
}

function deleteSelected() {
  if (!inspector.value) return;
  const name = inspector.value.name;
  void runAction(`已删除 ${name}。`, () => controller.deleteObject(inspector.value!.id));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function exportGltf(binary: boolean) {
  void runAction(binary ? 'GLB 已导出。' : 'glTF 已导出。', async () => {
    const blob = await controller.exportGltf(binary);
    downloadBlob(blob, `three-agent-scene.${binary ? 'glb' : 'gltf'}`);
  });
}

function saveProject() {
  downloadBlob(controller.exportProject(), 'three-agent-project.json');
  notice.value = '项目文件已保存。';
}

function openFilePicker(input: HTMLInputElement | undefined) {
  input?.click();
}

async function onGltfSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  if (files.length) await runAction('模型已导入。', () => controller.importGltf(files));
  input.value = '';
}

async function onHdriSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await runAction(`HDRI 环境已加载：${file.name}`, () => controller.loadHdri(file));
  input.value = '';
}

async function onProjectSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await runAction(`已打开项目：${file.name}`, () => controller.loadProject(file));
  input.value = '';
}

function updateEnvironmentBackground(event: Event) {
  const showBackground = (event.target as HTMLInputElement).checked;
  controller.setEnvironmentBackground(showBackground);
  refreshEditorState();
}

function clearEnvironment() {
  controller.clearEnvironment();
  notice.value = '已清除 HDRI 环境。';
  refreshEditorState();
}

onMounted(async () => {
  await nextTick();
  if (viewport.value) controller.mount(viewport.value);
  stopSync = controller.subscribe(refreshEditorState);
  new EditorBridge(controller, (value: string) => {
    bridgeStatus.value = value;
    refreshEditorState();
  }).connect();
  refreshEditorState();
});

onBeforeUnmount(() => stopSync?.());
</script>

<template>
  <main class="editor-shell">
    <header class="topbar">
      <div class="brand">
        <p class="eyebrow">MCP-READY 3D EDITOR</p>
        <h1>Three Agent Studio</h1>
      </div>
      <div class="toolbar" aria-label="场景操作">
        <button @click="addCube">添加立方体</button>
        <button class="secondary" :class="{ active: transformMode === 'translate' }" @click="setTransformMode('translate')">移动</button>
        <button class="secondary" :class="{ active: transformMode === 'rotate' }" @click="setTransformMode('rotate')">旋转</button>
        <button class="secondary" :class="{ active: transformMode === 'scale' }" @click="setTransformMode('scale')">缩放</button>
        <span class="toolbar-divider" />
        <button class="secondary" @click="undo">撤销</button>
        <button class="secondary" @click="redo">重做</button>
        <span class="toolbar-divider" />
        <button class="secondary" @click="openFilePicker(gltfInput)">导入 GLTF/GLB</button>
        <button class="secondary" @click="exportGltf(false)">导出 glTF</button>
        <button class="secondary" @click="exportGltf(true)">导出 GLB</button>
        <span class="toolbar-divider" />
        <button class="secondary" @click="saveProject">保存项目</button>
        <button class="secondary" @click="openFilePicker(projectInput)">打开项目</button>
      </div>
    </header>

    <aside class="left-panel">
      <section class="panel-section compact-status">
        <div class="status-row">
          <span class="status-dot" />
          <span>{{ bridgeStatus }}</span>
        </div>
        <p v-if="notice" class="notice">{{ notice }}</p>
      </section>

      <section class="panel-section">
        <div class="section-heading">
          <h2>场景树</h2>
          <span>{{ tree.length }}</span>
        </div>
        <div v-if="tree.length" class="scene-tree">
          <button
            v-for="node in tree"
            :key="node.id"
            class="tree-row"
            :class="{ selected: node.selected }"
            :style="{ paddingLeft: `${12 + node.depth * 18}px` }"
            :title="node.id"
            @click="selectTreeItem(node.id)"
          >
            <span class="visibility-mark">{{ node.visible ? '●' : '○' }}</span>
            <span class="tree-name">{{ node.name }}</span>
            <span class="tree-type">{{ node.type }}</span>
          </button>
        </div>
        <p v-else class="empty-state">场景暂无可编辑对象。</p>
      </section>

      <section class="panel-section">
        <div class="section-heading">
          <h2>环境</h2>
          <button class="icon-button" title="加载 HDRI" @click="openFilePicker(hdriInput)">＋</button>
        </div>
        <template v-if="environment.name">
          <p class="environment-name" :title="environment.name">{{ environment.name }}</p>
          <label class="toggle-row">
            <input type="checkbox" :checked="environment.showBackground" @change="updateEnvironmentBackground">
            <span>显示为背景</span>
          </label>
          <button class="text-button danger" @click="clearEnvironment">清除环境</button>
        </template>
        <button v-else class="wide-button secondary" @click="openFilePicker(hdriInput)">加载 .hdr 环境光</button>
      </section>

      <section class="panel-section summary-section">
        <div class="section-heading"><h2>场景概览</h2></div>
        <pre>{{ summary }}</pre>
      </section>
    </aside>

    <section ref="viewport" class="viewport" aria-label="Three.js 场景视口" />

    <aside class="right-panel">
      <section class="panel-section inspector-section">
        <div class="section-heading">
          <h2>属性</h2>
          <button v-if="inspector" class="text-button danger" @click="deleteSelected">删除</button>
        </div>
        <template v-if="inspector">
          <p class="object-kind">{{ inspector.type }}</p>
          <label class="field-label">
            名称
            <input v-model="inspector.name" type="text" @change="applyInspector">
          </label>
          <label class="toggle-row">
            <input v-model="inspector.visible" type="checkbox" @change="applyInspector">
            <span>可见</span>
          </label>

          <div class="transform-group">
            <span>位置</span>
            <div class="vector-row">
              <label v-for="(axis, index) in axes" :key="`position-${axis}`">
                {{ axis }}
                <input v-model.number="inspector.position[index]" type="number" step="0.1" @change="applyInspector">
              </label>
            </div>
          </div>
          <div class="transform-group">
            <span>旋转</span>
            <div class="vector-row">
              <label v-for="(axis, index) in axes" :key="`rotation-${axis}`">
                {{ axis }}
                <input v-model.number="inspector.rotation[index]" type="number" step="0.05" @change="applyInspector">
              </label>
            </div>
          </div>
          <div class="transform-group">
            <span>缩放</span>
            <div class="vector-row">
              <label v-for="(axis, index) in axes" :key="`scale-${axis}`">
                {{ axis }}
                <input v-model.number="inspector.scale[index]" type="number" min="0.001" step="0.1" @change="applyInspector">
              </label>
            </div>
          </div>

          <template v-if="inspector.material">
            <div class="material-heading">标准材质</div>
            <label class="field-label color-field">
              颜色
              <input v-model="inspector.material.color" type="color" @change="applyInspector">
            </label>
            <label class="range-field">
              <span>粗糙度 <b>{{ inspector.material.roughness.toFixed(2) }}</b></span>
              <input v-model.number="inspector.material.roughness" type="range" min="0" max="1" step="0.01" @change="applyInspector">
            </label>
            <label class="range-field">
              <span>金属度 <b>{{ inspector.material.metalness.toFixed(2) }}</b></span>
              <input v-model.number="inspector.material.metalness" type="range" min="0" max="1" step="0.01" @change="applyInspector">
            </label>
            <label class="range-field">
              <span>不透明度 <b>{{ inspector.material.opacity.toFixed(2) }}</b></span>
              <input v-model.number="inspector.material.opacity" type="range" min="0" max="1" step="0.01" @change="applyInspector">
            </label>
          </template>
        </template>
        <p v-else class="empty-state">在场景树中选择对象，或直接点击视口中的模型。</p>
      </section>
    </aside>

    <input ref="gltfInput" class="hidden-input" type="file" accept=".gltf,.glb,.bin,image/*" multiple @change="onGltfSelected">
    <input ref="hdriInput" class="hidden-input" type="file" accept=".hdr" @change="onHdriSelected">
    <input ref="projectInput" class="hidden-input" type="file" accept=".json,.three-agent.json" @change="onProjectSelected">
  </main>
</template>
