import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { SceneApplyInput, SceneOperation, SceneSummary, SceneValidationIssue } from '@three-agent/scene-contract';

const v3 = (value: [number, number, number]) => new THREE.Vector3(...value);

export class SceneController {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  readonly renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  private controls?: OrbitControls;
  private readonly history: string[] = [];
  private cameraTarget = new THREE.Vector3(0, 0, 0);

  constructor() {
    this.scene.background = new THREE.Color('#10131a');
    this.camera.position.set(5, 4, 7);
    this.scene.add(new THREE.GridHelper(20, 20, '#344155', '#1e293b'));
    this.scene.add(new THREE.AmbientLight('#ffffff', 1.2));
    const key = new THREE.DirectionalLight('#ffffff', 2.5);
    key.position.set(5, 7, 4);
    key.name = 'KeyLight';
    this.scene.add(key);
  }

  mount(container: HTMLElement) {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(this.cameraTarget);
    this.controls.enableDamping = true;
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

  apply(input: SceneApplyInput) {
    this.history.push(JSON.stringify(this.serialize()));
    const created: string[] = [];
    for (const op of input.ops) {
      const result = this.applyOperation(op);
      if (result) created.push(result);
    }
    return { label: input.label, created, summary: this.summary() };
  }

  undo() {
    const snapshot = this.history.pop();
    if (!snapshot) return { restored: false, message: '没有可撤销的场景事务。' };
    this.restore(JSON.parse(snapshot));
    return { restored: true, summary: this.summary() };
  }

  summary(): SceneSummary {
    let meshCount = 0;
    let lightCount = 0;
    let objectCount = 0;
    this.scene.traverse((object) => {
      if (object === this.scene) return;
      objectCount += 1;
      if ((object as THREE.Mesh).isMesh) meshCount += 1;
      if ((object as THREE.Light).isLight) lightCount += 1;
    });
    return {
      objectCount,
      meshCount,
      lightCount,
      camera: { position: this.camera.position.toArray() as [number, number, number], fov: this.camera.fov },
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
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      if (!material || !material.isMeshStandardMaterial) {
        issues.push({ level: 'info', code: 'NON_STANDARD_MATERIAL', message: '发现非标准材质，部分自动调参能力不可用。', targetId: mesh.uuid });
      }
    });
    return issues;
  }

  capture() {
    this.renderer.render(this.scene, this.camera);
    return { dataUrl: this.renderer.domElement.toDataURL('image/png') };
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
      const mesh = new THREE.Mesh(geometryMap[op.primitive](), new THREE.MeshStandardMaterial({ color: op.color ?? '#5b8cff', roughness: 0.45, metalness: 0.15 }));
      mesh.name = op.name ?? `${op.primitive}-${this.scene.children.length}`;
      if (op.position) mesh.position.copy(v3(op.position));
      if (op.rotation) mesh.rotation.set(...op.rotation);
      if (op.scale) mesh.scale.copy(v3(op.scale));
      this.scene.add(mesh);
      return mesh.uuid;
    }
    if (op.type === 'removeObject') {
      const target = this.scene.getObjectByProperty('uuid', op.targetId);
      if (!target || target === this.scene) throw new Error(`找不到对象：${op.targetId}`);
      target.removeFromParent();
      this.disposeObject(target);
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
      const material = target.material as THREE.MeshStandardMaterial;
      if (!material.isMeshStandardMaterial) throw new Error('当前仅支持 MeshStandardMaterial。');
      if (op.color) material.color.set(op.color);
      if (op.roughness !== undefined) material.roughness = op.roughness;
      if (op.metalness !== undefined) material.metalness = op.metalness;
      if (op.opacity !== undefined) { material.opacity = op.opacity; material.transparent = op.opacity < 1; }
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
      if (op.target) { this.cameraTarget.copy(v3(op.target)); this.controls?.target.copy(this.cameraTarget); }
      if (op.fov) { this.camera.fov = op.fov; this.camera.updateProjectionMatrix(); }
    }
  }

  private requireObject(id: string) {
    const target = this.scene.getObjectByProperty('uuid', id);
    if (!target) throw new Error(`找不到对象：${id}`);
    return target;
  }

  private serialize() {
    return this.scene.toJSON();
  }

  private restore(data: THREE.Object3DJSON) {
    const loader = new THREE.ObjectLoader();
    const restored = loader.parse(data);
    for (const child of [...this.scene.children]) { this.scene.remove(child); this.disposeObject(child); }
    for (const child of [...restored.children]) this.scene.add(child);
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
