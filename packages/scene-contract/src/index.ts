import { z } from 'zod';

const vector3 = z.tuple([z.number(), z.number(), z.number()]);

export const sceneOperationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('addPrimitive'),
    primitive: z.enum(['box', 'sphere', 'plane', 'cylinder', 'torus']),
    name: z.string().min(1).max(80).optional(),
    position: vector3.optional(),
    rotation: vector3.optional(),
    scale: vector3.optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional()
  }),
  z.object({
    type: z.literal('removeObject'),
    targetId: z.string().min(1)
  }),
  z.object({
    type: z.literal('transformObject'),
    targetId: z.string().min(1),
    position: vector3.optional(),
    rotation: vector3.optional(),
    scale: vector3.optional()
  }),
  z.object({
    type: z.literal('setMaterial'),
    targetId: z.string().min(1),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0).max(1).optional()
  }),
  z.object({
    type: z.literal('addLight'),
    light: z.enum(['ambient', 'directional', 'point']),
    name: z.string().min(1).max(80).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    intensity: z.number().min(0).max(20).optional(),
    position: vector3.optional()
  }),
  z.object({
    type: z.literal('setCamera'),
    position: vector3.optional(),
    target: vector3.optional(),
    fov: z.number().min(10).max(120).optional()
  })
]);

export const sceneApplyInputSchema = z.object({
  label: z.string().min(1).max(100),
  ops: z.array(sceneOperationSchema).min(1).max(20)
});

export type SceneOperation = z.infer<typeof sceneOperationSchema>;
export type SceneApplyInput = z.infer<typeof sceneApplyInputSchema>;

export interface SceneSummary {
  objectCount: number;
  meshCount: number;
  lightCount: number;
  camera: { position: [number, number, number]; fov: number };
  renderer: 'WebGLRenderer';
}

export interface SceneValidationIssue {
  level: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  targetId?: string;
}
