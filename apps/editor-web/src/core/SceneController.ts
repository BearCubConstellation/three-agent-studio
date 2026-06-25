import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import type { SceneApplyInput, SceneOperation, SceneSummary, SceneValidationIssue } from '@three-agent/scene-contract';

export type Vector3Tuple = [number, number, number];
export type TransformMode = 'translate' | 'rotate' | 'scale';

export interface SceneTreeItem {
  id: string;
  name: string;
  type: string;
  depth: number;
  visible: boolean;
  selected: boolean;
  hasChildren: boolean;
}

export interface SceneObjectInspector {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  material?: {
    color: string;
    roughness: number;
    metalness: number;
    opacity: number;
  };
}

export interface SceneObjectPatch {
  name?: string;
  visible?: boolean;
  position?: Vector3Tuple;
  rotation?: Vector3Tuple;
  scale?: Vector3Tuple;
  material?: Partial<NonNullable<SceneObjectInspector['material']>>;
}

export interface EnvironmentState {
  name?: string;
  showBackground: boolean;
}

interface ProjectEnvironment {
  name: string;
  dataUrl: string;
  showBackground: boolean;
}

interface SceneSnapshot {
  scene: THREE.Object3DJSON;
  camera: { position: Vector3Tuple; rotation: Vector3Tuple; fov: number };
  cameraTarget: Vector3Tuple;
  selectedObjectId?: string;
  environment?: ProjectEnvironment;
}

interface ProjectDocument {
  format: 'three-agent-studio-project';
  version: 1;
  scene: THREE.Object3DJSON;
  camera: { position: Vector3Tuple; rotation: Vector3Tuple; fov: number };
  cameraTarget: Vector3Tuple;
  selectedObjectId?: string;
  environment?: ProjectEnvironment;
}

interface HistoryEntry {
  label: string;
  snapshot: SceneSnapshot;
}

interface TransformTransaction {
  objectId: string;
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
  snapshot: SceneSnapshot;
}

const v3 = (value: Vector3Tuple) => new THREE.Vector3(...value);
const toTuple = (value: THREE.Vector3): Vector3Tuple => [value.x, value.y, value.z];
const rotationTuple = (value: THREE.Euler): Vector3Tuple => [value.x, value.y, value.z];
const sameVector = (a: Vector3Tuple, b: Vector3Tuple) => a.every((value, index) => Math.abs(value - b[index]) < 0.000001);
const readAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('无法读取文件。'));
  reader.onerror = () => reject(reader.error ?? new Error('无法读取文件。'));
  reader.readAsDataURL(file);
});

export class SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });

  private controls?: OrbitControls;
  private transformControls?: TransformControls;
  private transformHelper?: THREE.Object3D;
  private transformMode: TransformMode = 'translate';
  private transformTransaction?: TransformTransaction;
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly defaultBackground = new THREE.Color('#10131a');
  private cameraTarget = new THREE.Vector3(0, 0, 0);
  private selectedObjectId?: string;
  private environmentSource?: ProjectEnvironment;
  private environmentTexture?: THREE.Texture;
  private environmentRequestId = 0;

  constructor() {
    this.scene.name = 'Three Agent Studio Scene';
    this.scene.background = this.defaultBackground.clone();
    this.camera.position.set(5, 4, 7);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const grid = new THREE.GridHelper(20, 20, '#344155', '#1e293b');
    grid.name = 'EditorGrid';
    grid.userData.editorOnly = true;
    this.scene.add(grid);

    const ambient = new THREE.AmbientLight('#ffffff', 1.2);
    ambient.name = 'AmbientLight';
    this.scene.add(ambient);

    const key = new THREE.DirectionalLight('#ffffff', 2.5);
    key.position.set(5, 7, 4);
    key.name = 'KeyLight';
    this.scene.add(key);
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  mount(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.cameraTarget);
    this.controls.enableDamping = true;

    this.transformControls = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControls.setMode(this.transformMode);
    this.transformControls.setSpace('world');
    this.transformControls.addEventListener('dragging-changed', (event) => {
      if (this.controls) this.controls.enabled = !(event as { value?: boolean }).value;
    });
    this.transformControls.addEventListener('mouseDown', () => this.beginTransform());
    this.transformControls.addEventListener('objectChange', () => this.emitChange());
    this.transformControls.addEventListener('mouseUp', () => this.finishTransform());
    this.transformHelper = this.transformControls.getHelper();
    this.transformHelper.name = 'TransformGizmo';
    this.transformHelper.userData.editorOnly = true;
    this.scene.add(this.transformHelper);
    this.syncTransformTarget();

    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    const resize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height, false);
    };
    new ResizeObserver(resize).observe(container);
    resize();

    const loop = () => {
      this.controls?.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  setTransformMode(mode: TransformMode) {
    this.transformMode = mode;
    this.transformControls?.setMode(mode);
    this.emitChange();
    return mode;
  }

  getTransformMode(): TransformMode {
    return this.transformMode;
  }

  apply(input: SceneApplyInput) {
    const created = this.commit(input.label, () => {
      const ids: string[] = [];
      for (const op of input.ops) {
        const result = this.applyOperation(op);
        if (result) ids.push(result);
      }
      return ids;
    });
    return { label: input.label, created, summary: this.summary() };
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return { restored: false, message: '没有可撤销的场景事务。' };
    this.redoStack.push({ label: entry.label, snapshot: this.captureSnapshot() });
    this.restoreSnapshot(entry.snapshot);
    this.emitChange();
    return { restored: true, label: entry.label, summary: this.summary() };
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return { restored: false, message: '没有可重做的场景事务。' };
    this.undoStack.push({ label: entry.label, snapshot: this.captureSnapshot() });
    this.restoreSnapshot(entry.snapshot);
    this.emitChange();
    return { restored: true, label: entry.label, summary: this.summary() };
  }

  summary(): SceneSummary {
    let meshCount = 0;
    let lightCount = 0;
    let objectCount = 0;
    this.scene.traverse((object) => {
      if (object === this.scene || this.isEditorOnly(object)) return;
      objectCount += 1;
      if ((object as THREE.Mesh).isMesh) meshCount += 1;
      if ((object as THREE.Light).isLight) lightCount += 1;
    });
    return {
      objectCount,
      meshCount,
      lightCount,
      camera: { position: toTuple(this.camera.position), fov: this.camera.fov },
      renderer: 'WebGLRenderer'
    };
  }

  validate(): SceneValidationIssue[] {
    const issues: SceneValidationIssue[] = [];
    const summary = this.summary();
    if (summary.lightCount === 0) issues.push({ level: 'warning', code: 'NO_LIGHT', message: '场景中没有灯光，标准材质可能显示为黑色。' });
    if (summary.meshCount === 0) issues.push({ level: 'info', code: 'NO_MESH', message: '场景当前没有可渲染网格。' });
    if (summary.objectCount > 500) issues.push({ level: 'warning', code: 'HIGH_OBJECT_COUNT', message: `对象数量为 ${summary.objectCount}，建议合并静态网格或使用 InstancedMesh。` });
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh || this.isEditorOnly(mesh)) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((material) => !material.isMeshStandardMaterial)) {
        issues.push({ level: 'info', code: 'NON_STANDARD_MATERIAL', message: '发现非标准材质，部分自动调参能力不可用。', targetId: mesh.uuid });
      }
    });
    return issues;
  }

  capture() {
    this.renderer.render(this.scene, this.camera);
    return { dataUrl: this.renderer.domElement.toDataURL('image/png') };
  }

  getSceneTree(): SceneTreeItem[] {
    const result: SceneTreeItem[] = [];
    const visit = (object: THREE.Object3D, depth: number) => {
      if (this.isEditorOnly(object)) return;
      result.push({
        id: object.uuid,
        name: object.name || object.type,
        type: object.type,
        depth,
        visible: object.visible,
        selected: object.uuid === this.selectedObjectId,
        hasChildren: object.children.some((child) => !this.isEditorOnly(child))
      });
      object.children.forEach((child) => visit(child, depth + 1));
    };
    this.scene.children.forEach((child) => visit(child, 0));
    return result;
  }

  selectObject(id?: string) {
    if (id) {
      const object = this.scene.getObjectByProperty('uuid', id);
      this.selectedObjectId = object && !this.isEditorOnly(object) ? object.uuid : undefined;
    } else {
      this.selectedObjectId = undefined;
    }
    this.syncTransformTarget();
    this.emitChange();
    return this.getSelectedObjectInspector();
  }

  getSelectedObjectInspector(): SceneObjectInspector | undefined {
    if (!this.selectedObjectId) return undefined;
    const object = this.scene.getObjectByProperty('uuid', this.selectedObjectId);
    if (!object || this.isEditorOnly(object)) return undefined;

    const inspector: SceneObjectInspector = {
      id: object.uuid,
      name: object.name || object.type,
      type: object.type,
      visible: object.visible,
      position: toTuple(object.position),
      rotation: rotationTuple(object.rotation),
      scale: toTuple(object.scale)
    };
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (material?.isMeshStandardMaterial) {
        inspector.material = {
          color: `#${material.color.getHexString()}`,
          roughness: material.roughness,
          metalness: material.metalness,
          opacity: material.opacity
        };
      }
    }
    return inspector;
  }

  updateObject(id: string, patch: SceneObjectPatch) {
    return this.commit('修改对象属性', () => {
      const object = this.requireObject(id);
      if (patch.name !== undefined) object.name = patch.name.trim() || object.type;
      if (patch.visible !== undefined) object.visible = patch.visible;
      if (patch.position) object.position.copy(v3(patch.position));
      if (patch.rotation) object.rotation.set(...patch.rotation);
      if (patch.scale) object.scale.copy(v3(patch.scale));
      if (patch.material) {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) throw new Error('目标对象不是网格，无法设置材质。');
        const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        if (!material?.isMeshStandardMaterial) throw new Error('当前仅支持 MeshStandardMaterial。');
        if (patch.material.color) material.color.set(patch.material.color);
        if (patch.material.roughness !== undefined) material.roughness = THREE.MathUtils.clamp(patch.material.roughness, 0, 1);
        if (patch.material.metalness !== undefined) material.metalness = THREE.MathUtils.clamp(patch.material.metalness, 0, 1);
        if (patch.material.opacity !== undefined) {
          material.opacity = THREE.MathUtils.clamp(patch.material.opacity, 0, 1);
          material.transparent = material.opacity < 1;
        }
        material.needsUpdate = true;
      }
      this.syncTransformTarget();
      return this.getSelectedObjectInspector();
    });
  }

  deleteObject(id: string) {
    return this.commit('删除对象', () => {
      const target = this.requireObject(id);
      target.removeFromParent();
      this.disposeObject(target);
      if (this.selectedObjectId === id) this.selectedObjectId = undefined;
      this.syncTransformTarget();
      return { removed: id, summary: this.summary() };
    });
  }

  async importGltf(files: File[]) {
    const source = files.find((file) => /\.gl(?:b|tf)$/i.test(file.name));
    if (!source) throw new Error('请选择 .gltf 或 .glb 文件。');

    const filesByName = new Map(files.map((file) => [file.name, file]));
    const createdUrls: string[] = [];
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      const name = decodeURIComponent(url.split('/').pop() ?? '');
      const dependency = filesByName.get(name);
      if (!dependency) return url;
      const objectUrl = URL.createObjectURL(dependency);
      createdUrls.push(objectUrl);
      return objectUrl;
    });

    try {
      const buffer = await source.arrayBuffer();
      const model = await new Promise<THREE.Group>((resolve, reject) => {
        new GLTFLoader(manager).parse(buffer, '', (gltf) => resolve(gltf.scene), reject);
      });
      const baseName = source.name.replace(/\.gl(?:b|tf)$/i, '');
      return this.commit(`导入 ${source.name}`, () => {
        model.name = model.name || baseName || 'ImportedModel';
        model.userData.sourceFile = source.name;
        this.scene.add(model);
        this.selectedObjectId = model.uuid;
        this.syncTransformTarget();
        return { rootId: model.uuid, name: model.name, summary: this.summary() };
      });
    } finally {
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
    }
  }

  async exportGltf(binary: boolean) {
    const exportScene = new THREE.Scene();
    exportScene.name = this.scene.name;
    this.scene.children
      .filter((child) => !this.isEditorOnly(child))
      .forEach((child) => exportScene.add(child.clone(true)));

    const result = await new Promise<ArrayBuffer | Record<string, unknown>>((resolve, reject) => {
      new GLTFExporter().parse(
        exportScene,
        (value) => resolve(value as ArrayBuffer | Record<string, unknown>),
        (error) => reject(error),
        { binary, onlyVisible: true }
      );
    });

    if (binary) {
      if (!(result instanceof ArrayBuffer)) throw new Error('GLB 导出结果异常。');
      return new Blob([result], { type: 'model/gltf-binary' });
    }
    return new Blob([JSON.stringify(result, null, 2)], { type: 'model/gltf+json' });
  }

  async loadHdri(file: File) {
    if (!/\.hdr$/i.test(file.name)) throw new Error('HDRI 环境文件必须是 .hdr 格式。');
    const source: ProjectEnvironment = {
      name: file.name,
      dataUrl: await readAsDataUrl(file),
      showBackground: true
    };
    await this.applyEnvironmentSource(source);
    return this.getEnvironmentState();
  }

  setEnvironmentBackground(showBackground: boolean) {
    if (!this.environmentTexture || !this.environmentSource) return this.getEnvironmentState();
    this.environmentSource = { ...this.environmentSource, showBackground };
    this.scene.background = showBackground ? this.environmentTexture : this.defaultBackground.clone();
    this.emitChange();
    return this.getEnvironmentState();
  }

  clearEnvironment() {
    this.clearEnvironmentSilently();
    this.emitChange();
    return this.getEnvironmentState();
  }

  getEnvironmentState(): EnvironmentState {
    return {
      name: this.environmentSource?.name,
      showBackground: this.environmentSource?.showBackground ?? false
    };
  }

  exportProject() {
    const snapshot = this.captureSnapshot();
    const project: ProjectDocument = {
      format: 'three-agent-studio-project',
      version: 1,
      scene: snapshot.scene,
      camera: snapshot.camera,
      cameraTarget: snapshot.cameraTarget,
      selectedObjectId: snapshot.selectedObjectId,
      environment: snapshot.environment
    };
    return new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
  }

  async loadProject(file: File) {
    let project: ProjectDocument;
    try {
      project = JSON.parse(await file.text()) as ProjectDocument;
    } catch {
      throw new Error('项目文件不是有效的 JSON。');
    }
    if (project.format !== 'three-agent-studio-project' || project.version !== 1 || !project.scene?.object) {
      throw new Error('不是受支持的 Three Agent Studio 项目文件。');
    }

    const before = this.captureSnapshot();
    try {
      this.restoreScene(project.scene);
      this.camera.position.copy(v3(project.camera.position));
      this.camera.rotation.set(...project.camera.rotation);
      this.camera.fov = project.camera.fov;
      this.camera.updateProjectionMatrix();
      this.cameraTarget.copy(v3(project.cameraTarget));
      this.controls?.target.copy(this.cameraTarget);
      this.selectedObjectId = project.selectedObjectId && this.scene.getObjectByProperty('uuid', project.selectedObjectId)
        ? project.selectedObjectId
        : undefined;
      this.syncTransformTarget();
      if (project.environment) await this.applyEnvironmentSource(project.environment);
      else this.clearEnvironmentSilently();
      this.pushHistory('打开项目', before);
      this.redoStack.length = 0;
      this.emitChange();
      return { name: file.name, summary: this.summary() };
    } catch (error) {
      this.restoreSnapshot(before);
      throw error;
    }
  }

  private applyOperation(op: SceneOperation): string | undefined {
    if (op.type === 'addPrimitive') {
      const geometryMap = {
        box: () => new THREE.BoxGeometry(),
        sphere: () => new THREE.SphereGeometry(0.8, 32, 16),
        plane: () => new THREE.PlaneGeometry(2, 2),
        cylinder: () => new THREE.CylinderGeometry(0.7, 0.7, 1.5, 32),
        torus: () => new THREE.TorusGeometry(0.75, 0.25, 16, 48)
      };
      const mesh = new THREE.Mesh(
        geometryMap[op.primitive](),
        new THREE.MeshStandardMaterial({ color: op.color ?? '#5b8cff', roughness: 0.45, metalness: 0.15 })
      );
      mesh.name = op.name ?? `${op.primitive}-${this.scene.children.length}`;
      if (op.position) mesh.position.copy(v3(op.position));
      if (op.rotation) mesh.rotation.set(...op.rotation);
      if (op.scale) mesh.scale.copy(v3(op.scale));
      this.scene.add(mesh);
      return mesh.uuid;
    }
    if (op.type === 'removeObject') {
      this.deleteObjectWithoutHistory(op.targetId);
      return;
    }
    if (op.type === 'transformObject') {
      const target = this.requireObject(op.targetId);
      if (op.position) target.position.copy(v3(op.position));
      if (op.rotation) target.rotation.set(...op.rotation);
      if (op.scale) target.scale.copy(v3(op.scale));
      return;
    }
    if (op.type === 'setMaterial') {
      const target = this.requireObject(op.targetId) as THREE.Mesh;
      if (!target.isMesh) throw new Error('目标对象不是网格，无法设置材质。');
      const material = Array.isArray(target.material) ? target.material[0] : target.material;
      if (!material?.isMeshStandardMaterial) throw new Error('当前仅支持 MeshStandardMaterial。');
      if (op.color) material.color.set(op.color);
      if (op.roughness !== undefined) material.roughness = op.roughness;
      if (op.metalness !== undefined) material.metalness = op.metalness;
      if (op.opacity !== undefined) {
        material.opacity = op.opacity;
        material.transparent = op.opacity < 1;
      }
      material.needsUpdate = true;
      return;
    }
    if (op.type === 'addLight') {
      const light = op.light === 'ambient'
        ? new THREE.AmbientLight(op.color ?? '#ffffff', op.intensity ?? 1)
        : op.light === 'directional'
          ? new THREE.DirectionalLight(op.color ?? '#ffffff', op.intensity ?? 2)
          : new THREE.PointLight(op.color ?? '#ffffff', op.intensity ?? 10);
      light.name = op.name ?? `${op.light}-light-${this.scene.children.length}`;
      if (op.position) light.position.copy(v3(op.position));
      this.scene.add(light);
      return light.uuid;
    }
    if (op.type === 'setCamera') {
      if (op.position) this.camera.position.copy(v3(op.position));
      if (op.target) {
        this.cameraTarget.copy(v3(op.target));
        this.controls?.target.copy(this.cameraTarget);
      }
      if (op.fov !== undefined) {
        this.camera.fov = op.fov;
        this.camera.updateProjectionMatrix();
      }
    }
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (this.transformControls?.axis) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster
      .intersectObjects(this.scene.children, true)
      .find((intersection) => !this.isEditorOnly(intersection.object));
    this.selectObject(hit?.object.uuid);
  };

  private beginTransform() {
    const object = this.transformControls?.object;
    if (!object || this.isEditorOnly(object)) return;
    this.transformTransaction = {
      objectId: object.uuid,
      position: toTuple(object.position),
      rotation: rotationTuple(object.rotation),
      scale: toTuple(object.scale),
      snapshot: this.captureSnapshot()
    };
  }

  private finishTransform() {
    const transaction = this.transformTransaction;
    this.transformTransaction = undefined;
    if (!transaction) return;
    const object = this.scene.getObjectByProperty('uuid', transaction.objectId);
    if (!object || this.isEditorOnly(object)) return;
    const changed = !sameVector(transaction.position, toTuple(object.position))
      || !sameVector(transaction.rotation, rotationTuple(object.rotation))
      || !sameVector(transaction.scale, toTuple(object.scale));
    if (!changed) return;
    this.pushHistory('拖拽变换对象', transaction.snapshot);
    this.redoStack.length = 0;
    this.emitChange();
  }

  private commit<T>(label: string, work: () => T) {
    const before = this.captureSnapshot();
    try {
      const result = work();
      this.pushHistory(label, before);
      this.redoStack.length = 0;
      this.emitChange();
      return result;
    } catch (error) {
      this.restoreSnapshot(before);
      this.emitChange();
      throw error;
    }
  }

  private pushHistory(label: string, snapshot: SceneSnapshot) {
    this.undoStack.push({ label, snapshot });
    if (this.undoStack.length > 40) this.undoStack.shift();
  }

  private captureSnapshot(): SceneSnapshot {
    return {
      scene: this.serializeScene(),
      camera: {
        position: toTuple(this.camera.position),
        rotation: rotationTuple(this.camera.rotation),
        fov: this.camera.fov
      },
      cameraTarget: toTuple(this.cameraTarget),
      selectedObjectId: this.selectedObjectId,
      environment: this.environmentSource ? { ...this.environmentSource } : undefined
    };
  }

  private serializeScene(): THREE.Object3DJSON {
    const clone = this.scene.clone(true);
    [...clone.children]
      .filter((child) => child.userData.editorOnly)
      .forEach((child) => child.removeFromParent());
    clone.environment = null;
    clone.background = this.defaultBackground.clone();
    return clone.toJSON();
  }

  private restoreSnapshot(snapshot: SceneSnapshot) {
    this.restoreScene(snapshot.scene);
    this.camera.position.copy(v3(snapshot.camera.position));
    this.camera.rotation.set(...snapshot.camera.rotation);
    this.camera.fov = snapshot.camera.fov;
    this.camera.updateProjectionMatrix();
    this.cameraTarget.copy(v3(snapshot.cameraTarget));
    this.controls?.target.copy(this.cameraTarget);
    this.selectedObjectId = snapshot.selectedObjectId && this.scene.getObjectByProperty('uuid', snapshot.selectedObjectId)
      ? snapshot.selectedObjectId
      : undefined;
    this.syncTransformTarget();
    if (snapshot.environment) void this.applyEnvironmentSource(snapshot.environment);
    else this.clearEnvironmentSilently();
  }

  private restoreScene(data: THREE.Object3DJSON) {
    const restored = new THREE.ObjectLoader().parse(data) as THREE.Scene;
    for (const child of [...this.scene.children]) {
      if (child.userData.editorOnly) continue;
      this.scene.remove(child);
      this.disposeObject(child);
    }
    [...restored.children]
      .filter((child) => !child.userData.editorOnly)
      .forEach((child) => this.scene.add(child));
    this.scene.background = restored.background ?? this.defaultBackground.clone();
    this.scene.environment = restored.environment;
    this.scene.fog = restored.fog;
    this.scene.name = restored.name || 'Three Agent Studio Scene';
    this.scene.userData = restored.userData;
  }

  private async applyEnvironmentSource(source: ProjectEnvironment) {
    const requestId = ++this.environmentRequestId;
    const texture = await new RGBELoader().loadAsync(source.dataUrl);
    texture.mapping = THREE.EquirectangularReflectionMapping;
    if (requestId !== this.environmentRequestId) {
      texture.dispose();
      return;
    }
    this.environmentTexture?.dispose();
    this.environmentTexture = texture;
    this.environmentSource = { ...source };
    this.scene.environment = texture;
    this.scene.background = source.showBackground ? texture : this.defaultBackground.clone();
    this.emitChange();
  }

  private clearEnvironmentSilently() {
    this.environmentRequestId += 1;
    this.environmentTexture?.dispose();
    this.environmentTexture = undefined;
    this.environmentSource = undefined;
    this.scene.environment = null;
    this.scene.background = this.defaultBackground.clone();
  }

  private deleteObjectWithoutHistory(id: string) {
    const target = this.requireObject(id);
    target.removeFromParent();
    this.disposeObject(target);
    if (this.selectedObjectId === id) this.selectedObjectId = undefined;
    this.syncTransformTarget();
  }

  private requireObject(id: string) {
    const target = this.scene.getObjectByProperty('uuid', id);
    if (!target || this.isEditorOnly(target)) throw new Error(`找不到可编辑对象：${id}`);
    return target;
  }

  private syncTransformTarget() {
    if (!this.transformControls) return;
    const target = this.selectedObjectId ? this.scene.getObjectByProperty('uuid', this.selectedObjectId) : undefined;
    if (target && !this.isEditorOnly(target)) this.transformControls.attach(target);
    else this.transformControls.detach();
  }

  private isEditorOnly(object: THREE.Object3D) {
    let current: THREE.Object3D | null = object;
    while (current) {
      if (current.userData.editorOnly) return true;
      current = current.parent;
    }
    return false;
  }

  private emitChange() {
    this.listeners.forEach((listener) => listener());
  }

  private disposeObject(object: THREE.Object3D) {
    object.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}
