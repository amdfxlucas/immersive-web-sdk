/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBatchedBoundsTree,
  computeBoundsTree,
  disposeBatchedBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

THREE.BatchedMesh.prototype.computeBoundsTree = computeBatchedBoundsTree;
THREE.BatchedMesh.prototype.disposeBoundsTree = disposeBatchedBoundsTree;
THREE.BatchedMesh.prototype.raycast = acceleratedRaycast;

/*
THREE.BatchedMesh.prototype.deleteInstance = (instanceId) => {
    this.validateInstanceId(instanceId);
    this._instanceInfo[instanceId].active = false;
    this._availableInstanceIds.push(instanceId);
    this._visibilityChanged = true;
    return this;
}*/

// wrongly called by three-mesh-bvh for every instance, even deleted ones ! -> BUG
// getVisibleAt and validateInstanceId are patched to not trigger the bug
(
  THREE.BatchedMesh.prototype as unknown as {
    getVisibleAt: (instanceId: number) => boolean;
  }
).getVisibleAt = isVisibleAt;
function isVisibleAt(this: THREE.BatchedMesh, instanceId: number) {
  const instanceInfo = (
    this as unknown as {
      _instanceInfo: { active: boolean; visible: boolean }[];
    }
  )._instanceInfo;
  (
    this as unknown as { validateInstanceId: (instanceId: number) => void }
  ).validateInstanceId(instanceId); // THREE upstream impl. throws for deleted instances
  return instanceInfo[instanceId].active && instanceInfo[instanceId].visible;
}

(
  THREE.BatchedMesh.prototype as unknown as {
    validateInstanceId: (instanceId: number) => void;
  }
).validateInstanceId = isValidInstanceId;

function isValidInstanceId(this: THREE.BatchedMesh, instanceId: number) {
  const instanceInfo = (this as unknown as { _instanceInfo: unknown[] })
    ._instanceInfo;
  if (instanceId < 0 || instanceId >= instanceInfo.length) {
    // || instanceInfo[instanceId].active === false
    throw new Error(
      `THREE.BatchedMesh: Invalid instanceId ${instanceId}. Instance is either out of range or has been deleted.`,
    );
  }
}

/* // three-mesh-bvh
function acceleratedBatchedMeshRaycast(raycaster, intersects) {
  if (this.boundsTrees) {
    const boundsTrees = this.boundsTrees;
    const drawInfo = this._drawInfo || this._instanceInfo;
      ....
    for (let i2 = 0, l2 = drawInfo.length; i2 < l2; i2++) {  
    // BUG: only test visibility if drawInfo[i2].active==true
      if (!this.getVisibleAt(i2)) {
        continue;
      }
*/

export * from 'three';

// export * as Addons from 'three/examples/jsm/Addons.js';
