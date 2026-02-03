/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file presenter.ts
 * @brief Presenter interface and types for IWSDK multi-mode rendering
 *
 * The Presenter abstraction allows the World to support multiple rendering modes:
 * - XR Mode: WebXR-based immersive AR/VR (existing IWSDK behavior)
 * - Map Mode: 2D/2.5D geographic map view (Giro3D-based)
 * - Inline Mode: Non-immersive 3D view in browser
 *
 * Systems interact with the presenter API rather than raw Three.js objects,
 * enabling seamless mode switching without changing system code.
 *
 * @example
 * ```ts
 * // In a System
 * update(delta: number) {
 *   // These work regardless of whether we're in XR or Map mode
 *   const scene = this.presenter.scene;
 *   const camera = this.presenter.camera;
 *
 *   // Geographic operations
 *   const scenePos = this.presenter.geographicToScene({ lat: 51.0, lon: 13.0 });
 * }
 * ```
 *
 * @category Runtime
 */

import type { Signal } from '@preact/signals-core';
import type {
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  Vector3,
} from 'three';
import type { GeographicCoords, ProjectCRS, CRSExtent } from './gis-presenter.js';

// Re-export GIS types for convenience
export type { GeographicCoords, ProjectCRS, CRSExtent };


import type { World } from '../ecs/world.js';
/**
 * Supported presentation modes
 *
 * @category Runtime
 */
export enum PresentationMode {
  /** WebXR immersive VR */
  ImmersiveVR = 'immersive-vr',
  /** WebXR immersive AR */
  ImmersiveAR = 'immersive-ar',
  /** 2D/2.5D Map view (Giro3D) */
  Map = 'map',
  /** Non-immersive inline 3D view */
  Inline = 'inline',
}

/**
 * Presenter configuration options
 *
 * @category Runtime
 */
export interface PresenterConfig {
  /** Project coordinate reference system (enables GIS features) */
  crs?: ProjectCRS;
  /** Geographic origin for ENU transforms */
  origin?: GeographicCoords;
  /** Project extent in CRS units */
  extent?: CRSExtent;
}

/**
 * Options for XR presenter
 *
 * @category Runtime
 */
export interface XRPresenterOptions extends PresenterConfig {
  /** Session mode (AR or VR) */
  sessionMode?: 'immersive-ar' | 'immersive-vr';
  /** Reference space type */
  referenceSpace?: string;
  /** XR feature flags */
  features?: Record<string, boolean | object>;
  /** Camera field of view in degrees */
  fov?: number;
  /** Near clipping plane */
  near?: number;
  /** Far clipping plane */
  far?: number;
}

/**
 * Options for Map presenter
 *
 * @category Runtime
 */
export interface MapPresenterOptions extends PresenterConfig {
  /** Background color */
  backgroundColor?: string;
  /** Enable terrain rendering */
  enableTerrain?: boolean;
  /** Basemap source configuration */
  basemapSource?: {
    url: string;
    params?: Record<string, string>;
  };
  /** Initial camera altitude in meters */
  initialAltitude?: number;
}

/**
 * Pointer/pick event data
 *
 * @category Runtime
 */
export interface PointerEventData {
  /** Intersection point in scene coordinates */
  point: Vector3;
  /** The intersected object */
  object: Object3D;
  /** For BatchedMesh, the instance ID */
  instanceId?: number;
  /** For BatchedMesh, the batch name */
  batchName?: string;
  /** Original DOM or XR event */
  originalEvent?: Event | XRInputSourceEvent;
}

/**
 * Camera animation options
 *
 * @category Runtime
 */
export interface FlyToOptions {
  /** Animation duration in milliseconds */
  duration?: number;
  /** Target zoom level (map mode) */
  zoom?: number;
  /** Target altitude in meters */
  altitude?: number;
  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Presenter lifecycle state
 *
 * @category Runtime
 */
export enum PresenterState {
  /** Not yet initialized */
  Uninitialized = 'uninitialized',
  /** Initialized but not running */
  Ready = 'ready',
  /** Active and rendering */
  Running = 'running',
  /** Paused (e.g., XR visibility hidden) */
  Paused = 'paused',
  /** Disposed */
  Disposed = 'disposed',
}

/**
 * Pointer event types supported by presenters
 *
 * @category Runtime
 */
export type PointerEventType = 'select' | 'hover' | 'pointerdown' | 'pointerup';

/**
 * Pointer event callback function type
 *
 * @category Runtime
 */
export type PointerCallback = (data: PointerEventData) => void;

/**
 * Presenter interface
 *
 * Defines the contract for rendering backends. The World delegates all
 * rendering concerns to the active presenter, which can be XR-based or
 * map-based.
 *
 * Key responsibilities:
 * - Manage Three.js scene, camera, and renderer
 * - Handle coordinate transformations between geographic/CRS/scene coordinates
 * - Provide content root for GIS/application geometry
 * - Handle input events and camera navigation
 * - Manage the render loop lifecycle
 *
 * @category Runtime
 */
export interface IPresenter {
  // ============================================================================
  // PROPERTIES
  // ============================================================================

  /** Current presentation mode */
  readonly mode: PresentationMode;

  /** Current presenter state (reactive signal) */
  readonly state: Signal<PresenterState>;

  /** The Three.js scene */
  readonly scene: Scene;

  /** The active camera */
  readonly camera: PerspectiveCamera;

  /** The WebGL renderer */
  readonly renderer: WebGLRenderer;

  /** Whether the presenter is initialized */
  readonly isInitialized: boolean;

  /** Whether the presenter is currently running */
  readonly isRunning: boolean;

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the presenter with a DOM container and configuration
   *
   * @param container - The HTML element to render into
   * @param config - Presenter configuration options
   */
  initialize(container: HTMLDivElement, config: PresenterConfig): Promise<void>;

  /**
   * Start the render loop
   * @param loop (time, frame) =>{} WebGLRenderer animation loop, for renderer.setAnimationLoop(loop)
   *          installed by World on Presenter
   */
  start(loop: any): Promise<void>;


  setWorld(world: World): void;
  /**
   * Stop the render loop
   */
  stop(): Promise<void>;

  /**
   * Pause rendering (e.g., when XR visibility is hidden)
   */
  pause(): void;

  /**
   * Resume rendering after pause
   */
  resume(): void;

  /**
   * Dispose all resources and cleanup
   */
  dispose(): void;

  // ============================================================================
  // SCENE GRAPH
  // ============================================================================

  /**
   * Get the root object for GIS/application content
   *
   * All feature geometry should be added as children of this object.
   * This allows the presenter to manage coordinate transforms and
   * mode-specific handling.
   */
  getContentRoot(): Object3D;

  /**
   * Add an Object3D to the content root
   *
   * @param object3D - Object to add
   * @param options - Add options
   * @param options.isENU - Whether object is in ENU coordinates (Map mode will offset it)
   */
  addObject(object3D: Object3D, options?: { isENU?: boolean }): void;

  /**
   * Remove an Object3D from the scene
   *
   * @param object3D - Object to remove
   */
  removeObject(object3D: Object3D): void;

  /**
   * Notify presenter that scene needs re-rendering
   *
   * For on-demand renderers (like Map mode), this triggers a render.
   * For continuous renderers (like XR), this is a no-op.
   */
  notifyChange(): void;

  // ============================================================================
  // INPUT
  // ============================================================================

  /**
   * Register a pointer event callback
   *
   * @param eventType - Event type to listen for
   * @param callback - Callback function
   */
  onPointerEvent(eventType: PointerEventType, callback: PointerCallback): void;

  /**
   * Unregister a pointer event callback
   *
   * @param eventType - Event type
   * @param callback - Callback function to remove
   */
  offPointerEvent(eventType: PointerEventType, callback: PointerCallback): void;

  // ============================================================================
  // CAMERA / NAVIGATION
  // ============================================================================

  /**
   * Animate camera to geographic coordinates
   *
   * @param coords - Target geographic coordinates
   * @param options - Animation options
   */
  flyTo(coords: GeographicCoords, options?: FlyToOptions): Promise<void>;

  /**
   * Get current camera position in geographic coordinates
   *
   * @returns Geographic coordinates of camera
   */
  getCameraPosition(): GeographicCoords;


  // ============================================================================
  // RENDER LOOP INTEGRATION
  // ============================================================================

  /**
   * Called by World's update loop before ECS system updates
   *
   * @param delta - Time since last frame in seconds
   * @param time - Total elapsed time in seconds
   */
  preUpdate(delta: number, time: number): void;

  /**
   * Called by World's update loop after ECS system updates
   *
   * @param delta - Time since last frame in seconds
   * @param time - Total elapsed time in seconds
   */
  postUpdate(delta: number, time: number): void;

  /**
   * Perform the actual render
   *
   * Called by World after all updates are complete.
   */
  render(): void;
}

/**
 * Presenter factory function type
 *
 * @category Runtime
 */
export type PresenterFactory = (
  mode: PresentationMode,
  options?: PresenterConfig,
) => IPresenter;
