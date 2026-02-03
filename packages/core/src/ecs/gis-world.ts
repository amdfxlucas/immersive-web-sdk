/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file gis-world.ts
 * @brief GIS-aware World extension for coordinate-aware ECS applications
 *
 * GISWorld extends World with geographic/coordinate transformation capabilities.
 * Use GISWorld when working with geographic data (maps, geospatial features, etc.)
 * and ordinary World for standard XR/3D applications.
 *
 * Key differences from World:
 * - Requires IGISPresenter (MapPresenter or XRPresenter with GIS config)
 * - Provides coordinate transformation methods (geographicToScene, crsToScene, etc.)
 * - Supports flyTo and fitToExtent navigation
 * - Has a GIS root entity for managing geographic content
 *
 * @category Runtime
 */

import { Vector3 } from 'three';
import type { WorldOptions } from '../init/index.js';
import {
  isGISPresenter,
  type IGISPresenter,
  type GeographicCoords,
  type CRSExtent,
} from '../presenter/index.js';
import { World } from './world.js';

/**
 * GIS World options extending standard WorldOptions
 *
 * @category Runtime
 */
export interface GISWorldOptions extends WorldOptions {
  /**
   * GIS presenter configuration.
   * Required for GISWorld - must include CRS and origin.
   */
  /*presentation: PresenterConfig & {
    crs: { code: string; proj4: string };
    origin: GeographicCoords;
  };*/
}

/**
 * GISWorld extends World with geographic/coordinate transformation capabilities.
 *
 * Use GISWorld when building applications that work with geographic data:
 * - GIS/mapping applications
 * - Geospatial visualization
 * - Location-aware XR experiences
 *
 * @remarks
 * - Construct with {@link GISWorld.create} which ensures proper GIS presenter setup
 * - Provides coordinate transforms: {@link GISWorld.geographicToScene}, {@link GISWorld.crsToScene}, etc.
 * - Supports geographic navigation: {@link GISWorld.flyTo}, {@link GISWorld.fitToExtent}
 * - Access the GIS presenter via {@link GISWorld.gisPresenter}
 *
 * @category Runtime
 *
 * @example
 * ```ts
 * import { GISWorld, PresentationMode } from '@iwsdk/core';
 *
 * const container = document.getElementById('scene-container') as HTMLDivElement;
 * const world = await GISWorld.create(container, {
 *   presentation: {
 *     mode: PresentationMode.Map,
 *     crs: { code: 'EPSG:25833', proj4: '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs' },
 *     origin: { lat: 51.05, lon: 13.74 },
 *   }
 * });
 *
 * // Use GIS methods
 * const scenePos = world.geographicToScene({ lat: 51.06, lon: 13.75 });
 * await world.flyTo({ lat: 51.05, lon: 13.74 }, { altitude: 500 });
 * ```
 */
export class GISWorld extends World {
  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  constructor(entityCapacity: number, checksOn: boolean = false) {
    super(entityCapacity, checksOn);
  }

  // ============================================================================
  // GIS PRESENTER ACCESS
  // ============================================================================

  /**
   * Get the GIS presenter.
   *
   * Returns the presenter cast to IGISPresenter. Throws an error if the
   * presenter is not a GIS-enabled presenter.
   *
   * @throws Error if presenter is not GIS-enabled
   */
  get gisPresenter(): IGISPresenter {
    const presenter = this.presenter;
    if (!isGISPresenter(presenter)) {
      throw new Error(
        'GISWorld requires a GIS-enabled presenter (MapPresenter or XRPresenter with CRS config)',
      );
    }
    return presenter;
  }

  /**
   * Check if the current presenter supports GIS operations.
   *
   * @returns true if the presenter implements IGISPresenter
   */
  hasGISSupport(): boolean {
    return isGISPresenter(this.presenter);
  }

  // ============================================================================
  // COORDINATE TRANSFORMATIONS
  // ============================================================================

  /**
   * Convert geographic coordinates (WGS84) to scene coordinates.
   *
   * The transformation depends on the presentation mode:
   * - XR Mode: Returns ENU (East-North-Up) coordinates centered on origin
   * - Map Mode: Returns CRS coordinates mapped to Three.js scene space
   *
   * @param coords - Geographic coordinates (lat/lon/height)
   * @returns Scene coordinates as Vector3
   *
   * @example
   * ```ts
   * const scenePos = world.geographicToScene({ lat: 51.05, lon: 13.74, h: 100 });
   * mesh.position.copy(scenePos);
   * ```
   */
  geographicToScene(coords: GeographicCoords): Vector3 {
    return this.gisPresenter.geographicToScene(coords);
  }

  /**
   * Convert scene coordinates to geographic coordinates (WGS84).
   *
   * @param sceneCoords - Scene coordinates
   * @returns Geographic coordinates (lat/lon/h)
   *
   * @example
   * ```ts
   * const geo = world.sceneToGeographic(mesh.position);
   * console.log(`Mesh at ${geo.lat}, ${geo.lon}`);
   * ```
   */
  sceneToGeographic(sceneCoords: Vector3): GeographicCoords {
    return this.gisPresenter.sceneToGeographic(sceneCoords);
  }

  /**
   * Convert project CRS coordinates to scene coordinates.
   *
   * CRS coordinates are typically in meters (e.g., UTM Easting/Northing).
   *
   * @param x - CRS X coordinate (Easting)
   * @param y - CRS Y coordinate (Northing)
   * @param z - CRS Z coordinate (Height), defaults to 0
   * @returns Scene coordinates as Vector3
   *
   * @example
   * ```ts
   * // UTM coordinates
   * const scenePos = world.crsToScene(411234.5, 5657890.1, 120);
   * ```
   */
  crsToScene(x: number, y: number, z: number = 0): Vector3 {
    return this.gisPresenter.crsToScene(x, y, z);
  }

  /**
   * Convert scene coordinates to project CRS coordinates.
   *
   * @param sceneCoords - Scene coordinates
   * @returns CRS coordinates { x: Easting, y: Northing, z: Height }
   *
   * @example
   * ```ts
   * const crs = world.sceneToCRS(mesh.position);
   * console.log(`CRS: ${crs.x}, ${crs.y}`);
   * ```
   */
  sceneToCRS(sceneCoords: Vector3): { x: number; y: number; z: number } {
    return this.gisPresenter.sceneToCRS(sceneCoords);
  }

  // ============================================================================
  // GIS ROOT ACCESS
  // ============================================================================

  /**
   * Get the GIS root entity.
   *
   * The GIS root is a Transform Entity with GISRootComponent that serves
   * as the parent for all GIS content. This provides a clear separation
   * between GIS content and other scene content.
   *
   * @returns The GIS root entity
   */
  getGISRootEntity() {
    return this.gisPresenter.getGISRootEntity();
  }

  /**
   * Get the GIS root Object3D.
   *
   * Shorthand for `getGISRootEntity().object3D`.
   *
   * @returns The GIS root Object3D
   */
  getGISRoot() {
    return this.gisPresenter.getGISRoot();
  }

  // ============================================================================
  // GIS CONFIGURATION
  // ============================================================================

  /**
   * Get the configured CRS (Coordinate Reference System).
   *
   * @returns The CRS configuration, or undefined if not set
   */
  getCRS() {
    return this.gisPresenter.getCRS();
  }

  /**
   * Get the geographic origin.
   *
   * The origin is the reference point for ENU/scene coordinate transforms.
   *
   * @returns The geographic origin, or undefined if not set
   */
  getOrigin() {
    return this.gisPresenter.getOrigin();
  }

  /**
   * Update the geographic origin.
   *
   * This shifts the coordinate system origin, which can be useful for
   * maintaining precision when working in different geographic areas.
   *
   * @param lat - New latitude in degrees
   * @param lon - New longitude in degrees
   * @param h - New height in meters (optional)
   */
  updateOrigin(lat: number, lon: number, h?: number): void {
    this.gisPresenter.updateOrigin(lat, lon, h);
  }

  // ============================================================================
  // CAMERA / NAVIGATION
  // ============================================================================

  /**
   * Animate camera to geographic coordinates.
   *
   * Behavior varies by presentation mode:
   * - Map Mode: Smoothly animates the camera to the target position
   * - XR Mode: May offset content rather than moving the user
   *
   * @param coords - Target geographic coordinates
   * @param options - Animation options
   *
   * @example
   * ```ts
   * // Fly to a location
   * await world.flyTo({ lat: 51.05, lon: 13.74 });
   *
   * // Fly to a location at specific altitude
   * await world.flyTo({ lat: 51.05, lon: 13.74 }, { altitude: 1000, duration: 2000 });
   * ```
   */
  async flyTo(
    coords: GeographicCoords,
    options?: { duration?: number; altitude?: number },
  ): Promise<void> {
    return this.gisPresenter.flyTo(coords, options);
  }

  /**
   * Fit view to show an extent in CRS coordinates.
   *
   * Animates the camera to show the entire specified extent.
   *
   * Behavior varies by mode:
   * - Map Mode: Adjusts camera altitude and position to show extent
   * - XR Mode: May not be fully supported (user controls their view)
   *
   * @param extent - CRS extent to fit (minX, maxX, minY, maxY)
   * @param options - Animation options
   *
   * @example
   * ```ts
   * // Show a rectangular area
   * await world.fitToExtent({
   *   minX: 410000, maxX: 412000,
   *   minY: 5656000, maxY: 5658000
   * });
   * ```
   */
  async fitToExtent(
    extent: CRSExtent,
    options?: { duration?: number },
  ): Promise<void> {
    return this.gisPresenter.fitToExtent(extent, options);
  }

  /**
   * Get current camera position in geographic coordinates.
   *
   * @returns Geographic coordinates of the camera
   */
  getCameraPosition(): GeographicCoords {
    return this.gisPresenter.getCameraPosition();
  }

  // ============================================================================
  // FACTORY METHOD
  // ============================================================================

  /**
   * Create a new GIS-enabled World with all required systems and GIS presenter.
   *
   * This factory ensures the world is properly configured with a GIS-capable
   * presenter. If the presenter doesn't support GIS operations, an error is thrown.
   *
   * @param container - HTML container for the renderer canvas
   * @param options - GIS World configuration options (must include CRS and origin)
   * @returns Promise that resolves to the initialized GISWorld instance
   *
   * @example
   * ```ts
   * const world = await GISWorld.create(container, {
   *   presentation: {
   *     mode: PresentationMode.Map,
   *     crs: {
   *       code: 'EPSG:25833',
   *       proj4: '+proj=utm +zone=33 +ellps=GRS80 +units=m +no_defs'
   *     },
   *     origin: { lat: 51.05, lon: 13.74 },
   *     extent: { minX: 400000, maxX: 420000, minY: 5650000, maxY: 5670000 }
   *   }
   * });
   * ```
   */
  static override async create(
    container: HTMLDivElement,
    options: GISWorldOptions,
  ): Promise<GISWorld> {
    // Validate that GIS configuration is provided
   /* if (!options.presentation?.crs || !options.presentation?.origin) {
      throw new Error(
        'GISWorld requires presentation.crs and presentation.origin to be configured',
      );
    }*/

    // Use dynamic import to avoid circular dependency:
    // ecs/index -> gis-world -> init/index -> world-initializer -> environment/index -> environment-system -> ecs/index
    const { initializeWorld } = await import('../init/index.js');

    // Use the standard world initializer but create a GISWorld instance
    const world = (await initializeWorld(container, options, GISWorld)) as GISWorld;

    // Verify the presenter supports GIS operations
   /* if (!isGISPresenter(world.presenter)) {
      throw new Error(
        'GISWorld creation failed: presenter does not support GIS operations. ' +
        'Ensure presentation mode and CRS/origin are properly configured.',
      );
    } */

    return world;
  }
}
