/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file map-presenter.ts
 * @brief Map Presenter implementation for Giro3D-based 2D/2.5D rendering
 *
 * This presenter provides a traditional GIS map view using Giro3D, which is
 * built on Three.js and supports geospatial data natively.
 *
 * Coordinate system: Project CRS (e.g., EPSG:25833 UTM)
 * - X = Easting
 * - Y = Up (height)
 * - Z = Northing
 *
 * ENU-centered GLB geometry is offset via wrapper groups to align with CRS coordinates.
 *
 * @category Runtime
 */

import { signal, Signal } from '@preact/signals-core';
import {
  Clock,
  Group,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { Entity } from '../ecs/entity.js';
import type { World } from '../ecs/world.js';
import { CoordinateAdapter } from './coordinate-adapter.js';
import type {
  CRSExtent,
  FitToExtentOptions,
  GeographicCoords,
  IGISPresenter,
  ProjectCRS,
} from './gis-presenter.js';
import { initGISRootEntity } from './gis-root-component.js';
import {
  FlyToOptions,
  IPresenter,
  MapPresenterOptions,
  PointerCallback,
  PointerEventData,
  PointerEventType,
  PresentationMode,
  PresenterConfig,
  PresenterState,
} from './presenter.js';

// ============================================================================
// GIRO3D TYPES (dynamically loaded)
// ============================================================================

/** Giro3D Instance class */
let Instance: any;
/** Giro3D Extent class */
let Extent: any;
/** Giro3D Map class */
let Map: any;
/** Giro3D ColorLayer class */
let ColorLayer: any;
/** Giro3D TiledImageSource class */
let TiledImageSource: any;

/** Whether Giro3D has been loaded */
let giro3dLoaded = false;

/**
 * Load Giro3D modules dynamically
 *
 * This allows the MapPresenter to be optional - if Giro3D is not installed,
 * the presenter will throw an error on initialization rather than at import time.
 *
 * @internal
 */
async function loadGiro3D(): Promise<boolean> {
  if (giro3dLoaded) return true;

  try {
    const giro3d = await import('@giro3d/giro3d');
    Instance = giro3d.Instance;
    Extent = giro3d.Extent;
    Map = giro3d.Map;
    ColorLayer = giro3d.ColorLayer;
    TiledImageSource = giro3d.TiledImageSource;
    giro3dLoaded = true;
    return true;
  } catch (err) {
    console.warn('Giro3D not available:', err);
    return false;
  }
}

// ============================================================================
// ENU GEOMETRY WRAPPER
// ============================================================================

/**
 * Wrapper for ENU-centered geometry in CRS space
 *
 * When working with glTF models that are centered at the ENU origin (0,0,0),
 * we need to offset them to their correct position in CRS space. This wrapper
 * creates a parent group that applies the offset transform.
 *
 * @internal
 */
class ENUGeometryWrapper {
  /** The wrapper group (positioned at CRS origin) */
  readonly wrapper: Group;
  /** The original object */
  readonly innerObject: Object3D;

  /**
   * Create a new ENU geometry wrapper
   *
   * @param object3D - The object to wrap
   * @param originCRS - CRS coordinates of the ENU origin
   */
  constructor(object3D: Object3D, originCRS: { x: number; y: number }) {
    this.wrapper = new Group();
    this.wrapper.name = `ENUWrapper_${object3D.name || 'unnamed'}`;
    this.wrapper.add(object3D);
    this.innerObject = object3D;

    // Position wrapper at CRS origin
    // Giro3D uses: X=Easting, Y=Up, Z=Northing
    this.wrapper.position.set(originCRS.x, 0, originCRS.y);
  }

  /**
   * Update the origin position
   *
   * @param originCRS - New CRS origin coordinates
   */
  updateOrigin(originCRS: { x: number; y: number }): void {
    this.wrapper.position.set(originCRS.x, 0, originCRS.y);
  }
}

// ============================================================================
// MAP PRESENTER
// ============================================================================

/**
 * Map Presenter
 *
 * Implements IPresenter for 2D/2.5D map visualization using Giro3D.
 * Provides traditional GIS map interaction while maintaining compatibility
 * with the ECS architecture.
 *
 * Features:
 * - Giro3D-based map rendering
 * - On-demand rendering (not continuous like XR)
 * - CRS-based coordinate system
 * - ENU geometry wrapper for XR-compatible assets
 * - Map controls for pan/zoom/orbit
 * - Basemap layer support (WMS)
 *
 * @example
 * ```ts
 * const presenter = new MapPresenter();
 * await presenter.initialize(container, {
 *   crs: { code: 'EPSG:25833', proj4: '+proj=utm +zone=33...' },
 *   origin: { lat: 51.05, lon: 13.74 },
 *   extent: { minX: 400000, maxX: 420000, minY: 5650000, maxY: 5670000 }
 * });
 * await presenter.start();
 * ```
 *
 * @category Runtime
 */
export class MapPresenter implements IPresenter, IGISPresenter {
  // ============================================================================
  // PRIVATE STATE
  // ============================================================================

  /** Presentation mode (always Map) */
  private _mode = PresentationMode.Map;

  /** Presenter state signal */
  private _state = signal<PresenterState>(PresenterState.Uninitialized);

  /** Giro3D Instance */
  private _instance: any = null;

  /** Giro3D Map entity */
  private _map: any = null;

  /** Three.js scene (from Giro3D) */
  private _scene!: Scene;

  /** Perspective camera (from Giro3D) */
  private _camera!: PerspectiveCamera;

  /** WebGL renderer (from Giro3D) */
  private _renderer!: WebGLRenderer;

  /** Content root for application geometry */
  private _contentRoot!: Group;

  /** GIS root entity (Transform Entity with GISRootComponent) */
  private _gisRootEntity: Entity | null = null;

  /** Reference to the World for entity creation */
  private _world!: World ;

  /** CRS configuration */
  private _crs: ProjectCRS | undefined;

  /** Geographic origin */
  private _origin: GeographicCoords | undefined;

  /** Map of ENU geometry wrappers by object UUID */
  private _enuWrappers = new Map<string, ENUGeometryWrapper>();

  /** Map controls */
  private _controls: MapControls | null = null;

  /** Coordinate adapter */
  private _coordAdapter: CoordinateAdapter | null = null;

  /** Clock for timing */
  private _clock = new Clock();

  /** Whether a render is needed */
  private _needsRender = true;

  /** Pointer event callbacks */
  private _pointerCallbacks = new Map<PointerEventType, Set<PointerCallback>>();

  /** Presenter configuration */
  private _config: MapPresenterOptions = {};

  /** Container element */
  private _container: HTMLDivElement | null = null;

  /** Whether Giro3D is loaded */
  private _giro3dLoaded = false;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  /**
   * Create a new Map Presenter
   */
  constructor() {
    // Map presenter is always in Map mode
  }

  // ============================================================================
  // PROPERTIES
  // ============================================================================

  /** Current presentation mode */
  get mode(): PresentationMode {
    return this._mode;
  }

  /** Current presenter state */
  get state(): Signal<PresenterState> {
    return this._state;
  }

  /** The Three.js scene */
  get scene(): Scene {
    return this._scene;
  }

  /** The active camera */
  get camera(): PerspectiveCamera {
    return this._camera;
  }

  /** The WebGL renderer */
  get renderer(): WebGLRenderer {
    return this._renderer;
  }

  /** Whether the presenter is initialized */
  get isInitialized(): boolean {
    return this._state.value !== PresenterState.Uninitialized;
  }

  /** Whether the presenter is currently running */
  get isRunning(): boolean {
    return this._state.value === PresenterState.Running;
  }

  /** The Giro3D Instance */
  get instance(): any {
    return this._instance;
  }

  /** The Giro3D Map entity */
  get map(): any {
    return this._map;
  }

  // ============================================================================
  // LIFECYCLE
  // ============================================================================

  /**
   * Initialize the presenter
   */
  async initialize(
    container: HTMLDivElement,
    config: PresenterConfig,
  ): Promise<void> {
    if (this._state.value !== PresenterState.Uninitialized) {
      console.warn('MapPresenter already initialized');
      return;
    }

    // Load Giro3D
    this._giro3dLoaded = await loadGiro3D();
    if (!this._giro3dLoaded) {
      throw new Error(
        'Giro3D is required for MapPresenter. Install it with: npm install @giro3d/giro3d',
      );
    }

    this._container = container;
    this._config = config as MapPresenterOptions;

    // Store GIS configuration
    this._crs = config.crs;
    this._origin = config.origin;

    // Initialize coordinate adapter
    if (config.crs && config.origin) {
      this._coordAdapter = new CoordinateAdapter(config.crs, config.origin);
      await this._coordAdapter.initialize();

      // Register CRS with Giro3D
      Instance.registerCRS(config.crs.code, config.crs.proj4);
    }

    // Create Giro3D instance
    this._instance = new Instance({
      target: container,
      crs: config.crs?.code || 'EPSG:3857',
      backgroundColor: this._config.backgroundColor || '#87CEEB',
    });

    // Get Three.js references from Giro3D
    this._scene = this._instance.scene;
    this._camera = this._instance.view.camera;
    this._renderer = this._instance.renderer;

    // Create map entity if extent provided
    if (config.extent && config.crs) {
      await this._createMap(config.extent, config.crs.code);
    }

    // Create content root
    this._contentRoot = new Group();
    this._contentRoot.name = 'ContentRoot';
    this._instance.add(this._contentRoot);

    // Setup controls
    this._setupControls();

    // Setup input handling
    this._setupInput();

    this._state.value = PresenterState.Ready;
  }

  /**
   * Start the presenter
   * @TODO cannot discard world's animation loop, because it drives the updates in the ECS systems
   */
  async start(_: any = null): Promise<void> {
    if (this._state.value !== PresenterState.Ready) {
      throw new Error('MapPresenter not ready to start');
    }

    this._clock.start();
    this._state.value = PresenterState.Running;
    this._needsRender = true;
    this._instance.notifyChange();

    // TODO this._renderer.setAnimationLoop( original Giro3D loop + Elics ECS render loop)
  }

  setWorld(world: World){
    this._world = world;
  }

  /**
   * Stop the presenter
   */
  async stop(): Promise<void> {
    this._clock.stop();
    this._state.value = PresenterState.Ready;
  }

  /**
   * Pause rendering
   */
  pause(): void {
    this._state.value = PresenterState.Paused;
  }

  /**
   * Resume rendering
   */
  resume(): void {
    if (this._state.value === PresenterState.Paused) {
      this._state.value = PresenterState.Running;
      this._instance.notifyChange();
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Dispose ENU wrappers
    for (const wrapper of this._enuWrappers.values()) {
      if (wrapper.wrapper.parent) {
        wrapper.wrapper.parent.remove(wrapper.wrapper);
      }
    }
    this._enuWrappers.clear();

    // Dispose controls
    if (this._controls) {
      this._controls.dispose();
      this._controls = null;
    }

    // Dispose Giro3D instance
    if (this._instance) {
      this._instance.dispose();
      this._instance = null;
    }

    this._pointerCallbacks.clear();
    this._state.value = PresenterState.Disposed;
  }

  // ============================================================================
  // SCENE GRAPH
  // ============================================================================

  /**
   * Get the content root
   */
  getContentRoot(): Object3D {
    return this._contentRoot;
  }

  /**
   * Add an object to the content root
   */
  addObject(object3D: Object3D, options?: { isENU?: boolean }): void {
    // Default to isENU=true for backward compatibility
    const isENU = options?.isENU !== false;

    if (isENU && this._coordAdapter) {
      // Wrap ENU geometry with offset transform
      const origin = this._coordAdapter.getOrigin();
      const wrapper = new ENUGeometryWrapper(object3D, origin.crs);
      this._enuWrappers.set(object3D.uuid, wrapper);
      this._contentRoot.add(wrapper.wrapper);
    } else {
      // Add directly (already in CRS coordinates)
      this._contentRoot.add(object3D);
    }

    this.notifyChange();
  }

  /**
   * Remove an object from the scene
   */
  removeObject(object3D: Object3D): void {
    // Check if it was wrapped
    const wrapper = this._enuWrappers.get(object3D.uuid);
    if (wrapper) {
      if (wrapper.wrapper.parent) {
        wrapper.wrapper.parent.remove(wrapper.wrapper);
      }
      this._enuWrappers.delete(object3D.uuid);
    } else {
      if (object3D.parent) {
        object3D.parent.remove(object3D);
      }
    }

    this.notifyChange();
  }

  /**
   * Notify that scene needs re-rendering
   */
  notifyChange(): void {
    this._needsRender = true;
    if (this._instance) {
      this._instance.notifyChange();
    }
  }

  // ============================================================================
  // COORDINATE TRANSFORMS
  // ============================================================================

  /**
   * Convert geographic coordinates to scene coordinates
   */
  geographicToScene(coords: GeographicCoords): Vector3 {
    if (!this._coordAdapter) {
      console.warn('No coordinate adapter configured for geographicToScene');
      return new Vector3(0, coords.h || 0, 0);
    }
    const crs = this._coordAdapter.geographicToCRS(coords.lat, coords.lon);
    // Giro3D: X=Easting, Y=Up, Z=Northing
    return new Vector3(crs.x, coords.h || 0, crs.y);
  }

  /**
   * Convert scene coordinates to geographic coordinates
   */
  sceneToGeographic(sceneCoords: Vector3): GeographicCoords {
    if (!this._coordAdapter) {
      console.warn('No coordinate adapter configured for sceneToGeographic');
      return { lat: 0, lon: 0, h: sceneCoords.y };
    }
    const geo = this._coordAdapter.crsToGeographic(
      sceneCoords.x,
      sceneCoords.z,
    );
    return { lat: geo.lat, lon: geo.lon, h: sceneCoords.y };
  }

  /**
   * Convert CRS coordinates to scene coordinates
   */
  crsToScene(x: number, y: number, z: number = 0): Vector3 {
    // In Map mode, CRS maps directly to scene
    // X=Easting, Y=Up, Z=Northing
    return new Vector3(x, z, y);
  }

  /**
   * Convert scene coordinates to CRS coordinates
   */
  sceneToCRS(sceneCoords: Vector3): { x: number; y: number; z: number } {
    return {
      x: sceneCoords.x, // Easting
      y: sceneCoords.z, // Northing
      z: sceneCoords.y, // Height
    };
  }

  // ============================================================================
  // GIS ROOT (IGISPresenter)
  // ============================================================================

  /**
   * Get the GIS root entity.
   *
   * Returns the Transform Entity with GISRootComponent that serves
   * as the parent for all GIS content.
   */
  getGISRootEntity(): Entity {
    if (!this._gisRootEntity) {
      throw new Error(
        'GIS root entity not initialized. Call initGISRoot() with a World reference first.',
      );
    }
    return this._gisRootEntity;
  }

  /**
   * Get the GIS root Object3D.
   *
   * Shorthand for `getGISRootEntity().object3D`.
   */
  getGISRoot(): Object3D {
    return this.getGISRootEntity().object3D!;
  }

  /**
   * Get the configured CRS.
   */
  getCRS(): ProjectCRS | undefined {
    return this._crs;
  }

  /**
   * Get the geographic origin.
   */
  getOrigin(): GeographicCoords | undefined {
    return this._origin;
  }

  /**
   * Initialize the GIS root entity.
   *
   * This creates a proper Transform Entity with GISRootComponent
   * to serve as the parent for all GIS content.
   *
   * @param world - World instance for entity creation
   * @internal Called by World when setting up presenter mode
   */
  initGISRoot(world: World): void {
    if (this._gisRootEntity) {
      console.warn('GIS root entity already initialized');
      return;
    }

    this._world = world;
    this._gisRootEntity = initGISRootEntity(world, this._contentRoot);
  }

  // ============================================================================
  // INPUT
  // ============================================================================

  /**
   * Register a pointer event callback
   */
  onPointerEvent(eventType: PointerEventType, callback: PointerCallback): void {
    if (!this._pointerCallbacks.has(eventType)) {
      this._pointerCallbacks.set(eventType, new Set());
    }
    this._pointerCallbacks.get(eventType)!.add(callback);
  }

  /**
   * Unregister a pointer event callback
   */
  offPointerEvent(
    eventType: PointerEventType,
    callback: PointerCallback,
  ): void {
    const callbacks = this._pointerCallbacks.get(eventType);
    if (callbacks) {
      callbacks.delete(callback);
    }
  }

  /**
   * Emit a pointer event
   * @internal
   */
  private _emitPointerEvent(
    eventType: PointerEventType,
    data: PointerEventData,
  ): void {
    const callbacks = this._pointerCallbacks.get(eventType);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(data);
        } catch (err) {
          console.error('Error in pointer event callback:', err);
        }
      }
    }
  }

  /**
   * Setup input event handlers
   * @internal
   */
  private _setupInput(): void {
    const domElement = this._instance.domElement;

    // Click → select event
    domElement.addEventListener('click', (event: MouseEvent) => {
      this._handlePointerEvent('select', event);
    });

    // Throttled hover events
    let hoverThrottle = false;
    domElement.addEventListener('pointermove', (event: PointerEvent) => {
      if (!hoverThrottle) {
        hoverThrottle = true;
        setTimeout(() => {
          hoverThrottle = false;
        }, 50);
        this._handlePointerEvent('hover', event);
      }
    });

    // Pointer down/up events
    domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      this._handlePointerEvent('pointerdown', event);
    });

    domElement.addEventListener('pointerup', (event: PointerEvent) => {
      this._handlePointerEvent('pointerup', event);
    });
  }

  /**
   * Handle a pointer event
   * @internal
   */
  private _handlePointerEvent(
    eventType: PointerEventType,
    event: MouseEvent,
  ): void {
    const callbacks = this._pointerCallbacks.get(eventType);
    if (!callbacks || callbacks.size === 0) return;

    // Use Giro3D's picking
    const picks = this._instance.pickObjectsAt(event, {
      radius: 2,
      sortByDistance: true,
    });

    if (picks.length > 0) {
      const pick = picks[0];
      const eventData: PointerEventData = {
        point: pick.point,
        object: pick.object,
        originalEvent: event,
      };

      // Handle BatchedMesh
      if (pick.object?.isBatchedMesh && pick.batchId !== undefined) {
        eventData.instanceId = pick.batchId;
        eventData.batchName = pick.object.name;
      }

      this._emitPointerEvent(eventType, eventData);
    }
  }

  // ============================================================================
  // CAMERA / NAVIGATION
  // ============================================================================

  /**
   * Animate camera to geographic coordinates
   */
  async flyTo(coords: GeographicCoords, options?: FlyToOptions): Promise<void> {
    if (!this._controls) {
      console.warn('Controls not initialized');
      return;
    }

    const target = this.geographicToScene(coords);
    const duration = options?.duration || 1000;
    const altitude = options?.altitude || this._config.initialAltitude || 500;

    const startPos = this._camera.position.clone();
    const startTarget = this._controls.target.clone();

    // End position: above target looking down
    const endPos = new Vector3(target.x, altitude, target.z + altitude * 0.2);
    const endTarget = target.clone();

    const startTime = performance.now();

    return new Promise((resolve) => {
      const animate = () => {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = this._easeInOutCubic(t);

        this._camera.position.lerpVectors(startPos, endPos, eased);
        this._controls!.target.lerpVectors(startTarget, endTarget, eased);

        this.notifyChange();

        if (t < 1) {
          requestAnimationFrame(animate);
        } else {
          this._controls!.saveState();
          options?.onComplete?.();
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Get current camera position in geographic coordinates
   */
  getCameraPosition(): GeographicCoords {
    return this.sceneToGeographic(this._camera.position);
  }

  /**
   * Fit view to extent.
   *
   * Animates the camera to show the specified CRS extent.
   */
  async fitToExtent(
    extent: CRSExtent,
    options?: FitToExtentOptions,
  ): Promise<void> {
    const duration = options?.duration || 500;

    // Calculate center
    const centerX = (extent.minX + extent.maxX) / 2;
    const centerY = (extent.minY + extent.maxY) / 2;
    const width = extent.maxX - extent.minX;
    const height = extent.maxY - extent.minY;

    // Calculate altitude to see full extent
    const fov = (this._camera.fov * Math.PI) / 180;
    const altitude = (Math.max(width, height) / (2 * Math.tan(fov / 2))) * 1.2;

    const geo = this._coordAdapter?.crsToGeographic(centerX, centerY) || {
      lat: 0,
      lon: 0,
    };

    return this.flyTo(
      { lat: geo.lat, lon: geo.lon, h: 0 },
      { duration, altitude },
    );
  }

  /**
   * Cubic ease in/out function
   * @internal
   */
  private _easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ============================================================================
  // RENDER LOOP
  // ============================================================================

  /**
   * Pre-update hook
   */
  preUpdate(_delta: number, _time: number): void {
    // Update controls
    if (this._controls) {
      this._controls.update();
    }
  }

  /**
   * Post-update hook
   */
  postUpdate(_delta: number, _time: number): void {
    // Nothing specific needed
  }

  /**
   * Perform the render
   */
  render(): void {
    // Giro3D handles its own rendering via notifyChange
    // This is called for consistency but Giro3D uses on-demand rendering
    if (this._needsRender) {
      this._instance.notifyChange();
      this._needsRender = false;
    }
  }

  // ============================================================================
  // PRIVATE SETUP
  // ============================================================================

  /**
   * Create the Giro3D map
   * @internal
   */
  private async _createMap(
    extent: { minX: number; maxX: number; minY: number; maxY: number },
    crsCode: string,
  ): Promise<void> {
    const giro3dExtent = new Extent(
      crsCode,
      extent.minX,
      extent.maxX,
      extent.minY,
      extent.maxY,
    );

    this._map = new Map({
      extent: giro3dExtent,
      backgroundColor: '#f0f0f0',
      backgroundOpacity: 1.0,
    });

    this._instance.add(this._map);

    // Add basemap if configured
    if (this._config.basemapSource) {
      await this._addBasemapLayer(this._config.basemapSource);
    }
  }

  /**
   * Add a basemap layer
   * @internal
   */
  private async _addBasemapLayer(sourceConfig: {
    url: string;
    params?: Record<string, string>;
  }): Promise<void> {
    try {
      const { default: TileWMS } = await import('ol/source/TileWMS.js');

      const source = new TiledImageSource({
        source: new TileWMS({
          url: sourceConfig.url,
          projection: this._coordAdapter?.getCRS() || 'EPSG:3857',
          params: sourceConfig.params || {},
          crossOrigin: 'anonymous',
        }),
      });

      const layer = new ColorLayer({
        name: 'basemap',
        source: source,
        extent: this._map.extent,
      });

      await this._map.addLayer(layer);
    } catch (err) {
      console.warn('Failed to add basemap layer:', err);
    }
  }

  /**
   * Setup map controls
   * @internal
   */
  private _setupControls(): void {
    this._controls = new MapControls(
      this._camera,
      this._instance.domElement,
    );
    this._controls.enableDamping = true;
    this._controls.dampingFactor = 0.2;
    this._controls.maxPolarAngle = Math.PI / 2.3;
    this._controls.minDistance = 10;
    this._controls.maxDistance = 50000;

    // Position camera at initial view
    if (this._coordAdapter) {
      const origin = this._coordAdapter.getOrigin();
      const altitude = this._config.initialAltitude || 500;

      this._camera.position.set(
        origin.crs.x,
        altitude,
        origin.crs.y + altitude * 0.2,
      );
      this._controls.target.set(origin.crs.x, 0, origin.crs.y);
      this._controls.saveState();
    }

    // Notify on control changes
    this._controls.addEventListener('change', () => {
      this.notifyChange();
    });
  }

  // ============================================================================
  // MAP-SPECIFIC METHODS
  // ============================================================================

  /**
   * Get the coordinate adapter
   */
  getCoordinateAdapter(): CoordinateAdapter | null {
    return this._coordAdapter;
  }

  /**
   * Update the geographic origin
   *
   * @param lat - New latitude in degrees
   * @param lon - New longitude in degrees
   * @param h - New height in meters
   */
  updateOrigin(lat: number, lon: number, h: number = 0): void {
    if (this._coordAdapter) {
      this._coordAdapter.setOrigin(lat, lon, h);

      // Update all ENU wrappers
      const origin = this._coordAdapter.getOrigin();
      for (const wrapper of this._enuWrappers.values()) {
        wrapper.updateOrigin(origin.crs);
      }

      this.notifyChange();
    }
  }

  /**
   * Add a layer to the map
   *
   * @param layer - Giro3D layer to add
   */
  async addLayer(layer: any): Promise<void> {
    if (this._map) {
      return this._map.addLayer(layer);
    }
  }

  /**
   * Remove a layer from the map
   *
   * @param layer - Giro3D layer to remove
   */
  removeLayer(layer: any): void {
    if (this._map) {
      this._map.removeLayer(layer);
    }
  }

  /**
   * Check if Giro3D is available
   */
  static async isSupported(): Promise<boolean> {
    return loadGiro3D();
  }
}
