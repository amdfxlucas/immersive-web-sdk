/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Types, createComponent, Entity } from '../ecs/index.js';
import { BatchedMesh } from '../runtime/index.js';

/**
 * Entry describing a set of instances within a single BatchedMesh.
 *
 * @category Batching
 */
export interface BatchEntry {
  /** The Three.js BatchedMesh containing the instances. */
  mesh: BatchedMesh;
  /** Instance indices within the BatchedMesh (multiple for multipolygon features). */
  instanceIds: number[];
}

/**
 * Flattened instance reference returned by {@link getBatchedInstances}.
 *
 * @category Batching
 */
export interface BatchedInstanceRef {
  batchName: string;
  instanceId: number;
  mesh: BatchedMesh;
}

/**
 * Links an entity to one or more instances within {@link https://threejs.org/docs/#api/en/objects/BatchedMesh | BatchedMesh} objects.
 *
 * @remarks
 * The `instances` field stores a `Map<string, BatchEntry>` at runtime, keyed by batch name.
 * Each entry holds a reference to the BatchedMesh and the array of instance IDs that belong
 * to this entity. Multipolygon features map to multiple instance IDs within a single batch.
 *
 * @category Batching
 * @example Add a batched instance to an entity
 * ```ts
 * entity.addComponent(BatchedInstanceComponent, {
 *   instances: new Map([
 *     ['BatchedMesh_parcel_0', { mesh: batchedMesh, instanceIds: [42, 43] }],
 *   ]),
 * });
 * ```
 */
export const BatchedInstanceComponent = createComponent(
  'BatchedInstance',
  {
    instances: { type: Types.Object, default: null },
  },
  'Links an entity to one or more instances within BatchedMesh objects',
);

/**
 * Returns `true` if the entity has a {@link BatchedInstanceComponent} with at least one instance.
 *
 * @category Batching
 */
export function hasBatchedInstances(entity: Entity): boolean {
  if (!entity.hasComponent(BatchedInstanceComponent)) {
    return false;
  }
  const instances = entity.getValue(
    BatchedInstanceComponent,
    'instances',
  ) as Map<string, BatchEntry> | null;
  return instances != null && instances.size > 0;
}

/**
 * Returns a flat array of all batched instance references on the entity.
 *
 * @remarks
 * For a multipolygon entity with instance IDs `[42, 43]` in batch `"BatchedMesh_parcel_0"`,
 * this returns two entries — one per instance ID.
 *
 * @category Batching
 */
export function getBatchedInstances(entity: Entity): BatchedInstanceRef[] {
  if (!entity.hasComponent(BatchedInstanceComponent)) {
    return [];
  }
  const instances = entity.getValue(
    BatchedInstanceComponent,
    'instances',
  ) as Map<string, BatchEntry> | null;
  if (!instances) return [];

  const result: BatchedInstanceRef[] = [];
  for (const [batchName, entry] of instances) {
    for (const instanceId of entry.instanceIds) {
      result.push({ batchName, instanceId, mesh: entry.mesh });
    }
  }
  return result;
}

/**
 * Sets visibility on all batched instances of the entity via
 * {@link https://threejs.org/docs/#api/en/objects/BatchedMesh.setVisibleAt | BatchedMesh.setVisibleAt}.
 *
 * @category Batching
 */
export function setBatchInstanceVisibility(
  entity: Entity,
  visible: boolean,
): void {
  forEachBatchedInstance(entity, (_batchName, instanceId, mesh) => {
    mesh.setVisibleAt(instanceId, visible);
  });
}

/**
 * Iterates over every batched instance on the entity, invoking `fn` for each.
 *
 * @category Batching
 */
export function forEachBatchedInstance(
  entity: Entity,
  fn: (batchName: string, instanceId: number, mesh: BatchedMesh) => void,
): void {
  if (!entity.hasComponent(BatchedInstanceComponent)) return;
  const instances = entity.getValue(
    BatchedInstanceComponent,
    'instances',
  ) as Map<string, BatchEntry> | null;
  if (!instances) return;

  for (const [batchName, entry] of instances) {
    for (const instanceId of entry.instanceIds) {
      fn(batchName, instanceId, entry.mesh);
    }
  }
}
