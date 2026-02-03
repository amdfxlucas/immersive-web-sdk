/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file xr-presenter.ts
 * @brief XR Presenter implementation for WebXR-based rendering (AR/VR)
 *
 * This presenter handles immersive AR and VR rendering using WebXR.
 * It encapsulates the existing IWSDK rendering setup while conforming
 * to the IPresenter interface.
 *
 * Coordinate system: ENU (East-North-Up) centered on session origin
 * - X = East
 * - Y = Up
 * - Z = -North (toward camera)
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
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { Entity } from '../ecs/entity.js';
import type { World } from '../ecs/world.js';
import { ReferenceSpaceType } from '../init/xr.js';
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
  PointerCallback,
  PointerEventData,
  PointerEventType,
  PresentationMode,
  PresenterConfig,
  PresenterState,
  XRPresenterOptions,
} from './presenter.js';

/**
 * XR Presenter
 *
 * Implements IPresenter for WebXR-based immersive rendering.
 * When configured with CRS and origin, also implements IGISPresenter
 * for geographic coordinate support.
 *
 * This is the "traditional" IWSDK rendering path, now encapsulated
 * in the presenter abstraction.
 *
 * Features:
 * - WebXR session management
 * - Continuous render loop via requestAnimationFrame
 * - ENU coordinate system centered on XR session origin
 * - Optional geographic coordinate transforms via CoordinateAdapter
 * - GIS root entity for coordinate-aware content management
 *
 * @example
 * ```ts
 * const presenter = new XRPresenter(PresentationMode.ImmersiveVR);
 * await presenter.initialize(container, {
 *   crs: { code: 'EPSG:25833', proj4: '...' },
 *   origin: { lat: 51.05, lon: 13.74 }
 * });
 * await presenter.start();
 *
 * // Request XR session
 * const session = await presenter.requestSession();
 * ```
 *
 * @category Runtime
 */
export class XRPresenter implements IPresenter, IGISPresenter {
  // ============================================================================
  // PRIVATE STATE
  // ============================================================================

  /** Presentation mode (AR or VR) */
  private _mode: PresentationMode;

  /** Presenter state signal */
  private _state = signal<PresenterState>(PresenterState.Uninitialized);

  /** Three.js scene */
  private _scene!: Scene;

  /** Perspective camera */
  private _camera!: PerspectiveCamera;

  /** WebGL renderer */
  private _renderer!: WebGLRenderer;

  /** Content root for application geometry */
  private _contentRoot!: Group;

  /** GIS root entity (Transform Entity with GISRootComponent) */
  private _gisRootEntity: Entity | null = null;

  /** Reference to the World for entity creation */
  private _world: World | null = null;

  /** Coordinate adapter for geographic transforms */
  private _coordAdapter: CoordinateAdapter | null = null;

  /** CRS configuration */
  private _crs: ProjectCRS | undefined;

  /** Geographic origin */
  private _origin: GeographicCoords | undefined;

  /** Active XR session */
  private _session: XRSession | null = null;

  /** Clock for timing */
  private _clock = new Clock();

  /** Animation frame ID */
  private _animationFrameId: number | null = null;

  /** Pointer event callbacks */
  private _pointerCallbacks = new Map<PointerEventType, Set<PointerCallback>>();

  /** Presenter configuration */
  private _config: XRPresenterOptions = {};

  /** Container element */
  private _container: HTMLDivElement | null = null;

  /** Resize handler reference for cleanup */
  private _resizeHandler: (() => void) | null = null;

  // ============================================================================
  // CONSTRUCTOR
  // ============================================================================

  /**
   * Create a new XR Presenter
   *
   * @param mode - Presentation mode (ImmersiveAR, ImmersiveVR, or Inline)
   */
  constructor(
    mode:
      | PresentationMode.ImmersiveAR
      | PresentationMode.ImmersiveVR
      | PresentationMode.Inline,
  ) {
    this._mode = mode;
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

  /** Active XR session (if any) */
  get session(): XRSession | null {
    return this._session;
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
      console.warn('XRPresenter already initialized');
      return;
    }

    this._container = container;
    this._config = config as XRPresenterOptions;

    // Store GIS configuration
    this._crs = config.crs;
    this._origin = config.origin;

    // Initialize coordinate adapter if CRS provided
    if (config.crs && config.origin) {
      this._coordAdapter = new CoordinateAdapter(config.crs, config.origin);
      await this._coordAdapter.initialize();
    }

    // Setup camera
    const fov = this._config.fov ?? 50;
    const near = this._config.near ?? 0.1;
    const far = this._config.far ?? 200;

    this._camera = new PerspectiveCamera(
      fov,
      window.innerWidth / window.innerHeight,
      near,
      far,
    );
    this._camera.position.set(0, 1.7, 0); // Default eye height

    // Setup renderer
    this._renderer = new WebGLRenderer({
      antialias: true,
      alpha: this._mode === PresentationMode.ImmersiveAR,
      // @ts-ignore - multiviewStereo is a Quest-specific extension
      multiviewStereo: true,
    });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    this._renderer.outputColorSpace = SRGBColorSpace;
    this._renderer.xr.enabled = true;

    container.appendChild(this._renderer.domElement);

    // Setup scene
    this._scene = new Scene();

    // Create content root
    this._contentRoot = new Group();
    this._contentRoot.name = 'ContentRoot';
    this._scene.add(this._contentRoot);

    // Setup resize handling
    this._setupResizeHandling();

    // Setup XR session events
    this._setupXREvents();

    this._state.value = PresenterState.Ready;
  }

  /**
   * Start the render loop
   */
  async start(loop: any): Promise<void> {
    if (this._state.value !== PresenterState.Ready) {
      throw new Error('XRPresenter not ready to start');
    }

    // Start the render loop
    this._clock.start();
  //  this._renderer.setAnimationLoop(this._renderLoop.bind(this));
    //  store and start the world's render loop here 
    this._renderer.setAnimationLoop(loop);

    this._state.value = PresenterState.Running;
  }

  /**
   * Stop the render loop
   */
  async stop(): Promise<void> {
    if (this._session) {
      try {
        await this._session.end();
      } catch (e) {
        // Session may already be ended
      }
    }

 //   this._renderer.setAnimationLoop(null);  // done by world ?!
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
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    this.stop();

    // Remove resize handler
    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
      this._resizeHandler = null;
    }

    // Clear content root
    while (this._contentRoot.children.length > 0) {
      this._contentRoot.remove(this._contentRoot.children[0]);
    }

    // Dispose renderer
    this._renderer.dispose();

    // Remove canvas from container
    if (this._container && this._renderer.domElement.parentNode) {
      this._container.removeChild(this._renderer.domElement);
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
  addObject(object3D: Object3D, _options?: { isENU?: boolean }): void {
    // In XR mode, ENU objects are added directly (no offset needed)
    // The scene coordinates ARE ENU coordinates
    this._contentRoot.add(object3D);
  }

  /**
   * Remove an object from the scene
   */
  removeObject(object3D: Object3D): void {
    if (object3D.parent) {
      object3D.parent.remove(object3D);
    }
  }

  /**
   * Notify that scene needs re-rendering
   */
  notifyChange(): void {
    // XR uses continuous rendering, so this is a no-op
  }

  // ============================================================================
  // COORDINATE TRANSFORMS
  // ============================================================================

  /**
   * Convert geographic coordinates to scene coordinates
   */
  geographicToScene(coords: GeographicCoords): Vector3 {
    if (!this._coordAdapter) {
      // Without coordinate adapter, return a placeholder
      console.warn('No coordinate adapter configured for geographicToScene');
      return new Vector3(0, coords.h || 0, 0);
    }
    return this._coordAdapter.geographicToENU(
      coords.lat,
      coords.lon,
      coords.h || 0,
    );
  }

  /**
   * Convert scene coordinates to geographic coordinates
   */
  sceneToGeographic(sceneCoords: Vector3): GeographicCoords {
    if (!this._coordAdapter) {
      console.warn('No coordinate adapter configured for sceneToGeographic');
      return { lat: 0, lon: 0, h: sceneCoords.y };
    }
    return this._coordAdapter.enuToGeographic(sceneCoords);
  }

  /**
   * Convert CRS coordinates to scene coordinates
   */
  crsToScene(x: number, y: number, z: number = 0): Vector3 {
    if (!this._coordAdapter) {
      console.warn('No coordinate adapter configured for crsToScene');
      // Simple fallback mapping
      return new Vector3(x, z, -y);
    }
    return this._coordAdapter.crsToENU(x, y, z);
  }

  /**
   * Convert scene coordinates to CRS coordinates
   */
  sceneToCRS(sceneCoords: Vector3): { x: number; y: number; z: number } {
    if (!this._coordAdapter) {
      console.warn('No coordinate adapter configured for sceneToCRS');
      return { x: sceneCoords.x, y: -sceneCoords.z, z: sceneCoords.y };
    }
    return this._coordAdapter.enuToCRS(sceneCoords);
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
   * @internal Called by World when setting up presenter mode.
   * Only call after presenter was initialized
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
   * Emit a pointer event to registered callbacks
   * @internal
   */
  emitPointerEvent(eventType: PointerEventType, data: PointerEventData): void {
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

  // ============================================================================
  // CAMERA / NAVIGATION
  // ============================================================================

  /**
   * Animate camera to geographic coordinates
   */
  async flyTo(coords: GeographicCoords, options?: FlyToOptions): Promise<void> {
    // In XR mode, we can't move the user's physical position
    // This could be implemented by offsetting the content root
    console.warn(
      'flyTo in XR mode offsets content rather than moving the user',
    );

    const targetScene = this.geographicToScene(coords);

    // Emit a select event at the target for systems to react to
    this.emitPointerEvent('select', {
      point: targetScene,
      object: this._contentRoot,
    });

    options?.onComplete?.();
  }

  /**
   * Get current camera position in geographic coordinates
   */
  getCameraPosition(): GeographicCoords {
    const worldPos = new Vector3();
    this._camera.getWorldPosition(worldPos);
    return this.sceneToGeographic(worldPos);
  }

  /**
   * Fit view to extent.
   *
   * Not directly supported in XR mode since the user controls their view.
   */
  async fitToExtent(
    _extent: CRSExtent,
    _options?: FitToExtentOptions,
  ): Promise<void> {
    // Not directly applicable in XR mode
    console.warn('fitToExtent not supported in XR mode');
  }

  // ============================================================================
  // RENDER LOOP
  // ============================================================================

  /**
   * Pre-update hook (called before ECS systems)
   */
  preUpdate(_delta: number, _time: number): void {
    // Called before ECS systems update
  }

  /**
   * Post-update hook (called after ECS systems)
   */
  postUpdate(_delta: number, _time: number): void {
    // Called after ECS systems update
  }

  /**
   * Perform the actual render
   */
  render(): void {
    this._renderer.render(this._scene, this._camera);
  }

  /**
   * Internal render loop
   * @internal
   */
  private _renderLoop(): void {
    // Clock delta/time used by World's render loop, not here
    this._clock.getDelta();

    if (this._state.value === PresenterState.Running) {
      // Note: preUpdate/update/postUpdate/render are called by World
      // This loop just keeps the animation running
    }
  }

  // ============================================================================
  // XR SESSION MANAGEMENT
  // ============================================================================

  /**
   * Request an XR session
   *
   * @param options - Session options
   * @returns The created XR session
   * @internal Used by World.launch()
   */
  async requestSession(options?: {
    requiredFeatures?: string[];
    optionalFeatures?: string[];
  }): Promise<XRSession> {
    if (!navigator.xr) {
      throw new Error('WebXR not supported');
    }

    const sessionMode =
      this._mode === PresentationMode.ImmersiveAR
        ? 'immersive-ar'
        : 'immersive-vr';

    const sessionInit: XRSessionInit = {
      requiredFeatures: options?.requiredFeatures || ['local-floor'],
      optionalFeatures: options?.optionalFeatures || [
        'bounded-floor',
        'hand-tracking',
      ],
    };

    const session = await navigator.xr.requestSession(sessionMode, sessionInit);
    await this._onSessionStart(session);

    return session;
  }

  /**
   * Handle XR session start
   * @internal
   */
  private async _onSessionStart(session: XRSession): Promise<void> {
    session.addEventListener('end', this._onSessionEnd.bind(this));

    try {
      // Set reference space type
      this._renderer.xr.setReferenceSpaceType(
        ReferenceSpaceType.LocalFloor as unknown as XRReferenceSpaceType,
      );
      await this._renderer.xr.setSession(session);
      this._session = session;
    } catch (err) {
      console.error('Failed to start XR session:', err);
      throw err;
    }
  }

  /**
   * Handle XR session end
   * @internal
   */
  private _onSessionEnd(): void {
    this._session?.removeEventListener('end', this._onSessionEnd.bind(this));
    this._session = null;
  }

  /**
   * Setup XR event listeners
   * @internal
   */
  private _setupXREvents(): void {
    this._renderer.xr.addEventListener('sessionstart', () => {
      // Session started
    });

    this._renderer.xr.addEventListener('sessionend', () => {
      this._session = null;
    });
  }

  /**
   * Setup window resize handling
   * @internal
   */
  private _setupResizeHandling(): void {
    this._resizeHandler = () => {
      this._camera.aspect = window.innerWidth / window.innerHeight;
      this._camera.updateProjectionMatrix();
      this._renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', this._resizeHandler);
  }

  // ============================================================================
  // XR-SPECIFIC METHODS
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
    }
  }

  /**
   * Check if WebXR is supported for a given mode
   *
   * @param mode - Presentation mode to check
   * @returns Whether the mode is supported
   */
  static async isSupported(
    mode: PresentationMode.ImmersiveAR | PresentationMode.ImmersiveVR,
  ): Promise<boolean> {
    if (!navigator.xr) return false;

    const sessionMode =
      mode === PresentationMode.ImmersiveAR ? 'immersive-ar' : 'immersive-vr';

    try {
      return await navigator.xr.isSessionSupported(sessionMode);
    } catch {
      return false;
    }
  }
}
