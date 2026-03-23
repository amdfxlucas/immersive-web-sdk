/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { Entity } from '../ecs/index.js';
import { BatchedMesh } from '../runtime/index.js';
import {
  BatchedInstanceComponent,
  type BatchEntry,
} from './batched-instance.js';

/**
 * A registry that maintains the reverse mapping from (batchName, instanceId) to Entity.
 *
 * @remarks
 * This is a plain utility class — not an ECS System — because it has no per-frame
 * update logic. Application code or systems instantiate it and call
 * {@link register}/{@link unregister} as entities qualify/disqualify.
 *
 * Use {@link resolve} during picking to map a raycast hit on a BatchedMesh
 * (which returns a `batchId`/`instanceId`) back to the owning Entity.
 *
 * @category Batching
 * @example Typical usage in a system
 * ```ts
 * class MyInputSystem extends createSystem({ batched: { required: [BatchedInstanceComponent] } }) {
 *   registry = new BatchInstanceRegistry();
 *
 *   init() {
 *     this.queries.batched.subscribe('qualify', (entity) => this.registry.register(entity));
 *     this.queries.batched.subscribe('disqualify', (entity) => this.registry.unregister(entity));
 *   }
 *
 *   onPick(batchName: string, instanceId: number) {
 *     const entity = this.registry.resolve(batchName, instanceId);
 *     if (entity) { entity.addComponent(Pressed); }
 *   }
 * }
 * ```
 */
export class BatchInstanceRegistry {
  /** batchName → (instanceId → Entity) */
  private _map = new Map<string, Map<number, Entity>>();
  /** batchName → BatchedMesh */
  private _meshes = new Map<string, BatchedMesh>();

  /**
   * Register all batched instances of an entity.
   * Reads {@link BatchedInstanceComponent} and populates the internal lookup maps.
   */
  register(entity: Entity): void {
    if (!entity.hasComponent(BatchedInstanceComponent)) {
      return;
    }

    const instances = entity.getValue(
      BatchedInstanceComponent,
      'instances',
    ) as Map<string, BatchEntry> | null;
    if (!instances) return;

    for (const [batchName, entry] of instances) {
      if (!this._map.has(batchName)) {
        this._map.set(batchName, new Map());
      }
      this._meshes.set(batchName, entry.mesh);

      const instanceMap = this._map.get(batchName)!;
      for (const instanceId of entry.instanceIds) {
        instanceMap.set(instanceId, entity);
      }
    }
  }

  /**
   * Unregister all batched instances of an entity.
   * Removes all entries from the lookup maps that point to this entity.
   */
  unregister(entity: Entity): void {
    if (!entity.hasComponent(BatchedInstanceComponent)) {
      return;
    }

    const instances = entity.getValue(
      BatchedInstanceComponent,
      'instances',
    ) as Map<string, BatchEntry> | null;
    if (!instances) return;

    for (const [batchName, entry] of instances) {
      const instanceMap = this._map.get(batchName);
      if (!instanceMap) continue;

      for (const instanceId of entry.instanceIds) {
        instanceMap.delete(instanceId);
      }

      // Clean up empty batch entries
      if (instanceMap.size === 0) {
        this._map.delete(batchName);
        this._meshes.delete(batchName);
      }
    }
  }

  /**
   * Resolve a (batchName, instanceId) pair to the owning Entity.
   * Returns `undefined` if no entity is registered for that instance.
   *
   * This is the critical path for pick resolution — O(1) via two nested Map lookups.
   */
  resolve(batchName: string, instanceId: number): Entity | undefined {
    return this._map.get(batchName)?.get(instanceId);
  }

  /**
   * Get the BatchedMesh associated with a batch name.
   */
  getMesh(batchName: string): BatchedMesh | undefined {
    return this._meshes.get(batchName);
  }

  /**
   * Iterate over all registered (batchName, BatchedMesh) pairs.
   */
  getRegisteredMeshes(): IterableIterator<[string, BatchedMesh]> {
    return this._meshes.entries();
  }

  /**
   * Remove all entries from the registry.
   */
  clear(): void {
    this._map.clear();
    this._meshes.clear();
  }
}
