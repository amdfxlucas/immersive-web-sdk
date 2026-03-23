/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

export {
  BatchedInstanceComponent,
  hasBatchedInstances,
  getBatchedInstances,
  setBatchInstanceVisibility,
  forEachBatchedInstance,
} from './batched-instance.js';
export type { BatchEntry, BatchedInstanceRef } from './batched-instance.js';
export { BatchInstanceRegistry } from './batch-instance-registry.js';
