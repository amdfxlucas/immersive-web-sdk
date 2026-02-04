/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file gis-presenter.ts
 * @brief GIS Presenter interface and types for coordinate-aware presenters
 *
 * This module defines the IGISPresenter interface that extends IPresenter
 * with GIS/coordinate transformation capabilities. Not all presenters need
 * GIS support - for example, a simple inline 3D viewer wouldn't need
 * coordinate transforms.
 *
 * Presenters that support GIS should implement IGISPresenter.
 *
 * @category Runtime
 */

import type { Object3D, Vector3 } from 'three';
import type { Entity } from '../ecs/entity.js';
import type { IPresenter } from './presenter.js';
import type {World} from '../ecs/index.js';

/**
 * Geographic coordinates (WGS84)
 *
 * @category Runtime
 */
export interface GeographicCoords {
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lon: number;
  /** Height/altitude in meters (optional) */
  h?: number;
}

/**
 * Project Coordinate Reference System configuration
 *
 * @category Runtime
 */
export interface ProjectCRS {
  /** EPSG code (e.g., 'EPSG:25833') */
  code: string;
  /** Proj4 definition string */
  proj4: string;
}

/**
 * CRS extent (bounding box)
 *
 * @category Runtime
 */
export interface CRSExtent {
  minX: number; // bottom-left lon
  maxX: number; // bottom-left lat
  minY: number; // top-right lon
  maxY: number; // top-right lat
  crs?: string; // EPSG CRS code
}

export function crsFromBBox(bbox: string): CRSExtent {
  const tkn = bbox.split(',');
  const box = tkn.slice(0,4)?.map(s => Number(s.trim()));

  let extent: CRSExtent = {minX: box[0], minY: box[1], maxX: box[2], maxY: box[3]};
  if(box.length==5){
    extent.crs = tkn[4];
  }
  return extent;
}

/**
 * Animation options for fitToExtent
 *
 * @category Runtime
 */
export interface FitToExtentOptions {
  /** Animation duration in milliseconds */
  duration?: number;
}

/**
 * GIS Presenter Interface
 *
 * Extends IPresenter with geographic/coordinate transformation capabilities.
 * Implement this interface for presenters that need to work with geographic data.
 *
 * Key responsibilities:
 * - Coordinate transformations between geographic (WGS84), CRS, and scene coordinates
 * - GIS content root management (as a proper Transform Entity)
 * - Extent-based camera fitting
 *
 * @example
 * ```ts
 * // Check if presenter supports GIS
 * function hasGIS(p: IPresenter): p is IGISPresenter {
 *   return 'geographicToScene' in p;
 * }
 *
 * if (hasGIS(presenter)) {
 *   const scenePos = presenter.geographicToScene({ lat: 51.05, lon: 13.74 });
 * }
 * ```
 *
 * @category Runtime
 */
export interface IGISPresenter extends IPresenter {
  // ============================================================================
  // GIS ROOT
  // ============================================================================


  /**
   * Initialize the GIS root entity.
   *
   * This creates a proper Transform Entity with GISRootComponent
   * to serve as the parent for all GIS content.
   *
   * @param world - World instance for entity creation
   * @internal Called by World when setting up presenter mode
   */
  initGISRoot(world: World): void;
  /**
   * Get the GIS content root entity.
   *
   * This is a proper Transform Entity with GISRootComponent attached.
   * All GIS content should be added as children of this entity's object3D.
   */
  getGISRootEntity(): Entity;

  /**
   * Get the GIS content root Object3D.
   *
   * Shorthand for `getGISRootEntity().object3D`.
   */
  getGISRoot(): Object3D;

  // ============================================================================
  // COORDINATE TRANSFORMS
  // ============================================================================

  /**
   * Convert geographic coordinates (WGS84) to scene coordinates.
   *
   * The transformation depends on the presentation mode:
   * - XR Mode: Returns ENU (East-North-Up) coordinates
   * - Map Mode: Returns CRS coordinates mapped to Three.js
   *
   * @param coords - Geographic coordinates (lat/lon/height)
   * @returns Scene coordinates as Vector3
   */
  geographicToScene(coords: GeographicCoords): Vector3;

  /**
   * Convert scene coordinates to geographic coordinates (WGS84).
   *
   * @param sceneCoords - Scene coordinates
   * @returns Geographic coordinates
   */
  sceneToGeographic(sceneCoords: Vector3): GeographicCoords;

  /**
   * Convert project CRS coordinates to scene coordinates.
   *
   * @param x - CRS X coordinate (Easting)
   * @param y - CRS Y coordinate (Northing)
   * @param z - CRS Z coordinate (Height), defaults to 0
   * @returns Scene coordinates as Vector3
   */
  crsToScene(x: number, y: number, z?: number): Vector3;

  /**
   * Convert scene coordinates to project CRS coordinates.
   *
   * @param sceneCoords - Scene coordinates
   * @returns CRS coordinates { x: Easting, y: Northing, z: Height }
   */
  sceneToCRS(sceneCoords: Vector3): { x: number; y: number; z: number };

  // ============================================================================
  // EXTENT OPERATIONS
  // ============================================================================

  /**
   * Fit view to show an extent in CRS coordinates.
   *
   * Animates the camera to show the specified extent.
   * Behavior varies by mode:
   * - Map Mode: Adjusts camera altitude and position
   * - XR Mode: May not be supported (user controls their view)
   *
   * @param extent - Extent to fit (CRS coordinates)
   * @param options - Animation options
   */
  fitToExtent(extent: CRSExtent, options?: FitToExtentOptions): Promise<void>;

  // ============================================================================
  // GIS CONFIGURATION
  // ============================================================================

  /**
   * Get the configured CRS.
   */
  getCRS(): ProjectCRS | undefined;

  /**
   * Get the geographic origin.
   */
  getOrigin(): GeographicCoords | undefined;

  /**
   * Update the geographic origin.
   *
   * This shifts the coordinate system origin, which may be useful
   * for maintaining precision when working in different geographic areas.
   *
   * @param lat - New latitude in degrees
   * @param lon - New longitude in degrees
   * @param h - New height in meters
   */
  updateOrigin(lat: number, lon: number, h?: number): void;
}

/**
 * Type guard to check if a presenter implements IGISPresenter.
 *
 * @param presenter - Presenter to check
 * @returns True if presenter implements IGISPresenter
 *
 * @example
 * ```ts
 * if (isGISPresenter(world.presenter)) {
 *   const scenePos = world.presenter.geographicToScene(coords);
 * }
 * ```
 *
 * @category Runtime
 */
export function isGISPresenter(
  presenter: IPresenter | undefined,
): presenter is IGISPresenter {
  return presenter !== undefined && 'geographicToScene' in presenter;
}
