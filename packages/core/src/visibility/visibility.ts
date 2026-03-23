/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import {
  setBatchInstanceVisibility,
  hasBatchedInstances,
} from '../batching/batched-instance.js';
import { Types, createComponent, Entity, createSystem } from '../ecs/index.js';
import { MapLayerComponent } from '../presenter/map3d_components.js';

export const Visibility = createComponent(
  'Visibility',
  {
    isVisible: { type: Types.Boolean, default: true },
  },
  'Component to control if an entity object is visible',
  // @ts-ignore - 4th argument is parsed by vite-plugin-metaspatial for XML generation
  { hideInEditor: true },
);

function attachToEntity(entity: Entity): void {
  const object3D = entity.object3D;
  // Object3D visibility binding (hybrid entities may also have batched instances)
  if (object3D) {
    Object.defineProperty(object3D, 'visible', {
      get: () => {
        return entity.getValue(Visibility, 'isVisible');
      },
      set: (value: boolean) => {
        entity.setValue(Visibility, 'isVisible', value);
      },
      enumerable: true,
      configurable: true,
    });
  }

  // MapLayerComponent visibility binding
  if (!object3D && entity.hasComponent(MapLayerComponent)) {
    const layer = entity.getValue(MapLayerComponent, 'layer');
    if (layer) {
      Object.defineProperty(layer, 'visible', {
        get: () => {
          return entity.getValue(Visibility, 'isVisible');
        },
        set: (value: boolean) => {
          entity.setValue(Visibility, 'isVisible', value);
        },
        enumerable: true,
        configurable: true,
      });
    }
  }

  // BatchedMesh per-instance visibility
  if (hasBatchedInstances(entity)) {
    const visible = entity.getValue(Visibility, 'isVisible') ?? true;
    setBatchInstanceVisibility(entity, visible);
  }
}

function detachFromEntity(entity: Entity): void {
  const object3D = entity.object3D;
  if (object3D) {
    Object.defineProperty(object3D, 'visible', {
      value: object3D.visible,
      enumerable: true,
      configurable: true,
    });
  }

  if (!object3D && entity.hasComponent(MapLayerComponent)) {
    const layer = entity.getValue(MapLayerComponent, 'layer') as {
      visible: boolean;
    };
    if (layer) {
      Object.defineProperty(layer, 'visible', {
        value: layer.visible,
        enumerable: true,
        configurable: true,
      });
    }
  }

  // Restore batched instance visibility to current state (no property to unbind)
  if (hasBatchedInstances(entity)) {
    const visible = entity.getValue(Visibility, 'isVisible') ?? true;
    setBatchInstanceVisibility(entity, visible);
  }
}

export class VisibilitySystem extends createSystem({
  visibility: { required: [Visibility] },
}) {
  init(): void {
    this.queries.visibility.subscribe('qualify', attachToEntity);
    this.queries.visibility.subscribe('disqualify', detachFromEntity);
  }
}
