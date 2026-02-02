/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file gis-root-component.ts
 * @brief GIS Root tag component for marking GIS content root entities
 *
 * This tag component is used to identify the GIS content root entity
 * within the ECS. Presenters that implement IGISPresenter create
 * a Transform Entity with this component attached.
 *
 * @category Runtime
 */

import type { Group } from 'three';
import { createComponent } from '../ecs/index.js';
import type { Entity } from '../ecs/entity.js';
import type { World } from '../ecs/world.js';

/**
 * GIS Root Component
 *
 * A tag component that marks an entity as the GIS content root.
 * This entity serves as the parent for all GIS/geographic content
 * and enables the presenter to manage coordinate transforms appropriately.
 *
 * The GIS root entity:
 * - Is a proper Transform Entity (has Transform component)
 * - Contains an Object3D that serves as the scene graph parent for GIS content
 * - May have a custom "added" event listener for coordinate baking (Map mode)
 *
 * @example
 * ```ts
 * // Query for GIS root entity
 * const gisRootQuery = world.queryManager.createQuery({
 *   required: [GISRootComponent, Transform]
 * });
 *
 * for (const entity of gisRootQuery.entities) {
 *   console.log('GIS root:', entity.object3D);
 * }
 * ```
 *
 * @category Runtime
 */
export const GISRootComponent = createComponent(
  'GISRootComponent',
  {},
  'Marker component for GIS content root entity',
);

/**
 * Type for GISRootComponent
 *
 * @category Runtime
 */
export type GISRootComponentType = typeof GISRootComponent;

/**
 * Initialize the GIS root entity for a presenter.
 *
 * This helper function creates a proper Transform Entity with GISRootComponent
 * to serve as the parent for all GIS content. It is used by both XRPresenter
 * and MapPresenter to avoid code duplication.
 *
 * @param world - World instance for entity creation
 * @param contentRoot - The Group object to use as the GIS root
 * @returns The created GIS root entity
 *
 * @internal Used by presenter implementations
 * @category Runtime
 */
export function initGISRootEntity(world: World, contentRoot: Group): Entity {
  // Create Transform Entity for GIS root
  const gisRootEntity = world.createEntity();
  gisRootEntity.object3D = contentRoot;
  contentRoot.name = 'GIS_ROOT';

  // Store entity index on the Object3D for ECS lookups
  (contentRoot as any).entityIdx = gisRootEntity.index;

  // Add GISRootComponent tag
  gisRootEntity.addComponent(GISRootComponent);

  // Store reference on world for queries
  (world as any).gisRootIndex = gisRootEntity.index;

  // Parent to active root (moves with XR)
  // FIXME this creates dependency on LevelSystem! 
  // It might be possible to insert under sceneEntity directly instead ?!
  world.getActiveRoot().add(gisRootEntity.object3D);

  return gisRootEntity;
}

/*
import * as elics from 'elics; 
import { DataType, TypedSchema, Component } from 'elics;

// patch
export function initializeComponentStorage<T extends DataType, S extends TypedSchema<T>>(
  component: Component<S>, 
  entityCapacity: number
): void {
  //  Add your custom logic here
  console.log(`Patching storage for component: ${component.name}`);
  if(component.name == "GISRootComponent"){
    entityCapacity = 1;
  }

  //  Call the original function
  elics.initializeComponentStorage(component, entityCapacity);

  // 3. Add any post-initialization logic
  console.log("Patch applied successfully.");
}

// 3. Re-export everything ELSE from the original library
export * from 'elics;
// OR -------------------------------------------------
If the library is truly global (meaning it attaches to window or globalThis 
and you want to trick other libraries into using your version),
 you need to combine the export with an assignment:

const original = window.initializeComponentStorage;

// Overwrite the global object
window.initializeComponentStorage = function<T extends DataType, S extends TypedSchema<T>>(
  component: Component<S>,
  entityCapacity: number
): void {
  // Your Patch logic
  console.log("Global hook intercepted!");
  return original(component, entityCapacity);
};

// Re-export for module-based users
export const initializeComponentStorage = window.initializeComponentStorage;
*/