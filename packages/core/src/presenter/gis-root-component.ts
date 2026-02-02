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

import { createComponent } from '../ecs/index.js';

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
