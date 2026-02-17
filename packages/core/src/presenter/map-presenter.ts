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
  Box3,
  BoxGeometry,
  Clock,
  Group,
  Mesh,
  MeshBasicMaterial,
  AxesHelper,
  Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import type { Entity } from '../ecs/entity.js';
import type { World } from '../ecs/world.js';
import { CoordinateAdapter, getProj4 } from './coordinate-adapter.js';
import {
  crsFromBBox,
  type CRSExtent,
  type FitToExtentOptions,
  type GeographicCoords,
  type IGISPresenter,
  type ProjectCRS,
} from './gis-presenter.js';
import { GISRootComponent } from './gis-root-component.js';
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
import { getComponent } from '../ecs/helpers.js';
import { MapDataSourceComponent, MapLayerComponent, MapLayerType, MapPresenterComponent, SourceType, getDataSourceType } from './map3d_components.js';
import { Giro3DSystem } from './giro3d_system.js';

// ============================================================================
// GIRO3D TYPES (dynamically loaded)
// ============================================================================

/** Giro3D Instance class */
let Instance: any;
/** Giro3D Extent class */
let Extent: any;
let WmsSource: any;
let WCSSource: any;
let Object3DLayer: any;
let Object3DSource: any;
let initializeCRS: any;
let CoordinateSystem: any; 
/** Giro3D Map class */
let Giro3DMap: any;
let ColorLayer: any;
let ElevationLayer: any;

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
    // giro3d.(core).picking.PickOptions.gpuPicking.gpuPicking = false; //(default: false)
    /*If disabled, picking will using CPU raycasting when possible (rather than GPU picking).
    Main differences between CPU raycasting and GPU picking:
    CPU raycasting is generally much faster to execute and does not require blocking the thread to wait for the GPU queue to complete.
    Disadvantages:

    CPU raycasting might give less accurate results in some specific cases,
    CPU raycasting might not return complete information, only the picked point coordinates.
    CPU raycasting does not ignore transparent pixels, whereas GPU picking does.
    It might be a disadvantage or advantage depending on the use case. */
    Instance = giro3d.Instance;
    Extent = giro3d.geographic.Extent;
    Giro3DMap = giro3d.Map;
    CoordinateSystem = giro3d.geographic.CoordinateSystem;
    initializeCRS = giro3d.geographic.initializeCRS;
    ColorLayer = giro3d.layer.ColorLayer;
    Object3DLayer = giro3d.layer.Object3DLayer;
    ElevationLayer = giro3d.layer.ElevationLayer;
    Object3DSource = giro3d.Object3DSource;
    WmsSource = giro3d.WmsSource;
    WCSSource = giro3d.WCSSource;

    giro3dLoaded = true;
    return true;
  } catch (err) {
    console.warn('Giro3D not available:', err);
    return false;
  }
}


// ============================================================================
// CUSTOM SUBDIVISION STRATEGY
// ============================================================================

/**
 * Custom subdivision strategy that allows Object3DLayers and ElevationLayers
 * to coexist without blocking tile subdivision.
 *
 * The default Giro3D strategy (`defaultMapSubdivisionStrategy`) blocks
 * subdivision until ALL layers pass a check:
 *   `!layer.visible || isColorLayer(layer) || (isElevationLayer(layer) && layer.isLoaded(tile.id))`
 *
 * Object3DLayers fail all three conditions (they're visible, not color layers,
 * and not elevation layers), so `every()` returns false and subdivision is
 * permanently blocked.
 *
 * This strategy fixes the issue by explicitly allowing Object3DLayers to pass
 * through. Object3DLayers don't affect tile bounding boxes, so there's no
 * reason to wait for them before subdividing.
 *
 * @internal
 */
function iwsdkSubdivisionStrategy(tile: any, context: any): boolean {
  if (!context.entity.terrain.enabled) {
    return true;
  }
  return context.layers.every((layer: any) => {
    // Invisible layers don't block subdivision
    if (!layer.visible) return true;
    // Color layers never block subdivision
    if (layer.isColorLayer) return true;
    // Object3D layers never block subdivision (they don't affect bounding boxes)
    if (layer.isObject3DLayer) return true;
    // Elevation layers block until their data is loaded for this tile
    // (needed for correct bounding box / terrain deformation)
    if (layer.isElevationLayer) return layer.isLoaded(tile.id);
    // Unknown layer types: don't block
    return true;
  });
}

// ============================================================================
// ENU GEOMETRY WRAPPER
// ============================================================================

/**
 * Wrapper for ENU-centered geometry in CRS space
 *
 * When working with glTF models that are centered at the ENU origin (0,0,0),
 * we need to offset them to their correct position in CRS space. This wrapper
 * creates a parent group that applies the offset transform AND rotation from
 * Y-up (ENU/Three.js) to Z-up (Giro3D Map).
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
   * @param originCRS - CRS coordinates of the ENU origin (x=Easting, y=Northing)
   */
  constructor(object3D: Object3D, originCRS: { x: number; y: number }) {
    this.wrapper = new Group();
    this.wrapper.name = `ENUWrapper_${object3D.name || 'unnamed'}`;

    // Rotate from Y-up (ENU) to Z-up (Giro3D Map) coordinate system
    // +π/2 maps: Y(up)->Z(up), Z(north)->-Y (may need scale.y=-1 to fix north)
    this.wrapper.rotation.x = Math.PI / 2;

    this.wrapper.add(object3D);
    this.innerObject = object3D;

    // Position wrapper at CRS origin
    // Giro3D Map uses: X=Easting, Y=Northing, Z=Up (Y-up=false)
    this.wrapper.position.set(originCRS.x, originCRS.y, 0);
  }

  /**
   * Update the origin position
   *
   * @param originCRS - New CRS origin coordinates (x=Easting, y=Northing)
   */
  updateOrigin(originCRS: { x: number; y: number }): void {
    this.wrapper.position.set(originCRS.x, originCRS.y, 0);
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
 * Scene Graph Structure
 *  ```
 *  Instance.scene (THREE.Scene)
 *  └── map.object3d (THREE.Group)
 *      ├── TileMesh (LOD 0, tile 0)
 *      │   ├── TileMesh (LOD 1, child 0)
 *      │   │   └── ... (deeper tiles - higher zoom)
 *      │   ├── TileMesh (LOD 1, child 1)
 *      │   └── ...
 *      └── TileMesh (LOD 0, tile 1)
 *          └── ...
 *  ```
 * 
 * In the context of Object3DLayer, when objects are attached to tiles, the hierarchy becomes:

  ```
  . . . 
  :
  └── TileMesh
      └── Group (object3d-layer-{layerId}-tile-{tileId})
          ├── BuildingMesh1
          :
          ├── BuildingMesh2
          └── BatchedMesh (if batching enabled)
  ```
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
  // center of the Map's extent in Map CRS
  private center!: any;
  

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

  /** Animation frame ID for the ECS update loop */
  private _animationFrameId: number | null = null;

  /** External loop callback (ECS update) */
  private _externalLoop: ((time: number, frame?: XRFrame) => void) | null = null;

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
    if(!container){
      throw "No target container for Giro3d MapPresenter specified";
    }
    if(!config.crs){
      throw "Not CRS for MapPresenter specified";
    }
    if (!config.extent) {
      throw `No extent specified for MapPresenter`;
    }

    this._container = container;
    this._config = config as MapPresenterOptions;

    // Store GIS configuration
    this._crs = config.crs;
    this._origin = config.origin;

    let crs = null;
    let crs_def = config.crs.proj4;
     // NOTE: Giro3d requires WKT definition not proj4 
    if(crs_def)
    { // definition provided by user in project file
       crs = CoordinateSystem.register(config.crs.code, crs_def);
    }else{
      // otherwise use giro-epsg-helper to fetch the definition
      crs = initializeCRS(config.crs.code);
    }

    // Initialize coordinate adapter
    if (config.origin) {
      this._coordAdapter = new CoordinateAdapter(config.crs, config.origin);
      await this._coordAdapter.initialize();
    }

    this._instance = new Instance({
      target: container,
      // TODO reuse THREE context between presenters -> PresenterContext abstraction
      //  camera: config.camera,
      //  renderer: config.renderer,
      //  scene3D: config.scene
      crs: crs,
      backgroundColor: this._config.backgroundColor, // || '#87CEEB'
    });

    // const axesHelper = new AxesHelper(100000); // ONLY for debugging
    // this._instance.add(axesHelper);

    // CRITICAL: Disable Giro3D's automatic near/far plane computation
    // It computes Infinity when the scene is empty, breaking frustum culling
    // The property is on instance.mainLoop, not instance.view
    const mainLoop = (this._instance as any).mainLoop;
    if (mainLoop && typeof mainLoop.automaticCameraPlaneComputation !== 'undefined') {
      mainLoop.automaticCameraPlaneComputation = false;
      console.log('[MapPresenter] Disabled automatic near/far plane computation');
    } else {
      console.warn('[MapPresenter] Could not access mainLoop.automaticCameraPlaneComputation');
    }

    // Set explicit near/far planes
    const camera = this._instance.view.camera as PerspectiveCamera;
    // TODO add to presenter config
    camera.near = 1;
    camera.far = 100000;
    camera.updateProjectionMatrix();
    console.log('[MapPresenter] Set camera near/far:', camera.near, camera.far);

    // Position camera at CRS origin (will be repositioned in _setupControls after map is created)
    // DON'T set to (0, 0, 0) - that's outside the UTM extent!
    // Giro3D Map uses: X=Easting, Y=Northing, Z=Up (Y-up=false)
    if (this._coordAdapter) {
      const origin = this._coordAdapter.getOrigin();
      const altitude = this._config?.initialAltitude || 500;
      camera.position.set(origin.crs.x, origin.crs.y, altitude);
      console.log('[MapPresenter] Initial camera position (X=E, Y=N, Z=alt):', origin.crs.x, origin.crs.y, altitude);
    } else {
      // Fallback - will be corrected when map extent is known
      camera.position.set(0, 0, this._config?.initialAltitude || 1000);
    }

    // Get Three.js references from Giro3D
    this._scene = this._instance.scene;
    this._camera = this._instance.view.camera;
    this._renderer = this._instance.renderer;

    // Giro3D Map uses: X=Easting, Y=Northing, Z=Up (Y-up=false)

    // Create map entity if extent provided
    await this._createMap(config.extent, crs);
    // root group that contains tiles at root of hierarchy (LOD 0) as children
    //this._contentRoot = this._map.object3d;
    // Root TileMesh of Giro3D Map
    this._contentRoot = this._map.object3d?.children[0];
    if(!this._contentRoot && this._map.object3d?.children?.length!=1)
    {throw "implementation error";}
    
    this._setupControls();
    this._setupInput();

    this._state.value = PresenterState.Ready;
  }

  // successor of setupSources
  async _addECSLayers(){
    // TODO  register queries for MapLayerComponents, and search the assigned source (MapDataSourceComponents)
    // then create Giro3D Layers and Sources according to their specifications
    // connect them and finally add layers to this._map

    for ( let layer of this._world.queryManager.registerQuery({required: [MapLayerComponent]}).entities) //.values().find(layer => {});
    {
      this._addECSLayerImpl(layer);
    }
  }

  _addECSLayerImpl(layer: Entity) {
      const lname = layer.getValue(MapLayerComponent, 'name');
      if(!lname){
        console.warn(`Invalid Layer with empty name`);
        return;
      }
      let src = this._world.queryManager.registerQuery({required: [MapDataSourceComponent]}).entities.values().find((s)=>{
        return s.getValue(MapDataSourceComponent, 'layer_name')==lname;
      });
      if(!src){
        console.warn(`No datasource for layer: ${lname}`);
        return;
      }
      const layerconfig = getComponent(MapLayerComponent, layer);
      if(!layerconfig){
        throw "implementation error";
      }
      const source_options = getComponent(MapDataSourceComponent, src);
      if(!source_options){
        throw "implementation error";
      }

      let crs = null;
      try{
        crs = CoordinateSystem.get(source_options.crs);
      }catch(err){
        try{
            crs = initializeCRS(source_options.crs);
          }catch(e){
          console.error(`Failed to register MapDataSource ${source_options.name}: Failed to init CRS ${source_options.crs} - ${e}`);
       }
      }

       // Ensure extent is a Giro3D Extent object in CRS coordinates
      let sourceExtent = this._map.extent; // Default to map extent (already a Giro3D Extent)
      if(source_options?.extent){
            let box = (source_options.extent as string).split(',');
            let bbox = box.slice(0,4).map((n)=>Number(n));
            if(bbox[4] && source_options.srsname && box[4]!=source_options.srsname){
                throw "configuration error";
            }
            // FIXME actually we had to create CRS from source's bbox[5] EPSG code
            // const crs = CoordinateSystem.register(bbox[5], <proj4 definition>)
            if(crs.id != bbox[5]){
                throw `Implementation Error: datasource ${source_options.name} has CRS ${bbox[5]} which is deviating from project's ${crs.id}`;
            }
            sourceExtent = new Extent(crs, bbox[0], bbox[2], bbox[1], bbox[3]);
        
      }
      // currently source is always proxied through CEC backend, if layer-type is Object3D.
      // But this doesnt necessarily hold in general!
      //const isProxied = layerconfig.type == "object3d"; // TODO add boolean flag to MapDataSourceComponent, and query it here
      const isProxied = getDataSourceType(lname)!=null;

      const type = isProxied ? "OBJECT3D" : src?.getValue(MapDataSourceComponent, 'type');

      let ds: any = null; // datasource instance
      let maplayer: any = null;
      switch(type)
      {
        case SourceType.OBJECT3D:
          let t = getDataSourceType(lname);
          if(!t)
          {
            throw `No Object3DSource implemetation provided for layer: ${lname}`;
          }
                // Get CRS coordinates of the ENU origin for transforming geometry
          const originCRS = this._coordAdapter?.getOrigin()?.crs || { x: 0, y: 0 };
          const centerLon = (sourceExtent.west + sourceExtent.east) / 2;
          const centerLat = (sourceExtent.south + sourceExtent.north) / 2;
          // TODO add ctor-options field to MapDataSourceComponent
          // where user can provide ctor options for its custom registered datasource impl.
          ds = new t({
            crs: crs,
            config: source_options.config,
            crs_name: source_options.crs, // this._config.crs?.code, // the CRS of the query's bbox //(src_config.srsname as string),
            extent: sourceExtent,
            center: {lat: centerLat, lon: centerLon},
            featureclass_name: lname,
            originCRS: originCRS
          });
          
          break;
        case SourceType.WMS:
          ds = new WmsSource({
            url:source_options.url,
             projection: source_options.crs,
             layer: lname, 
             extent: sourceExtent,
             imageFormat: source_options.format
            });
          break;
        case SourceType.WCS:
          ds = new WCSSource({
            // extent is determined with GetCapabilities request
            url: source_options.url,
            coverageId: lname,
             format: source_options.format,
              crs: source_options.crs,
               // For elevation data: use 32-bit floats for better precision
               is8bit: false
              });
          break;
        // TODO handle other cases
        default:
          throw `Unimplemented MapDataSource type: ${type}`;
          
      };
      const lopts = {
           ...layerconfig,
        source: ds,
        name: lname,
        extent: sourceExtent       
        };
      const ltype = layer.getValue(MapLayerComponent,'type')?.toLowerCase();
      switch(ltype)
      {
        case MapLayerType.COLOR:
          maplayer = new ColorLayer({...lopts});
          break;
        case MapLayerType.ELEVATION:
          maplayer = new ElevationLayer({...lopts});
          break;
        case MapLayerType.OBJECT3D:
          maplayer = new Object3DLayer({...lopts});
          break;
        // TODO handle other cases
        default:
          throw `Unimplemented MapLayerType: ${ltype}`;
      }
      this._map.addLayer(maplayer);
  }

  /**
   * Start the presenter
   *
   * IMPORTANT: Unlike XRPresenter, MapPresenter does NOT use renderer.setAnimationLoop().
   * Giro3D manages its own render loop internally via requestAnimationFrame and on-demand
   * rendering triggered by notifyChange(). Calling setAnimationLoop() would override
   * Giro3D's internal frame management, breaking tile subdivision, layer updates,
   * and source queries (like FeatureSource).
   *
   * Instead, we run our own rAF loop for ECS updates and let Giro3D handle rendering.
   */
  async start(loop: any = null): Promise<void> {
    if (this._state.value !== PresenterState.Ready) {
      throw new Error('MapPresenter not ready to start');
    }

    this._clock.start();
    this._state.value = PresenterState.Running;
    this._externalLoop = loop;
    this._needsRender = true;

    // Start our own animation frame loop for ECS updates
    // This runs alongside Giro3D's internal render loop
    const ecsLoop = (time: number) => {
      if (this._state.value !== PresenterState.Running) {
        return;
      }

      // Call the external loop (ECS update from World)
      if (this._externalLoop) {
        this._externalLoop(time);
      }

      // Continue the loop
      this._animationFrameId = requestAnimationFrame(ecsLoop);
    };

    this._animationFrameId = requestAnimationFrame(ecsLoop);

    // Trigger initial Giro3D render
    this._instance.notifyChange();
  }

  /**
   * Called by World on setPresenter()
   *
   * NOTE: This does NOT automatically set up sources/layers. Call setupSources()
   * separately after DataSource entities have been created in the ECS world.
   * Must be called after MapPresenter was initialized.
   */
  setWorld(world: World){
    this._world = world;
    const me = this._world.createEntity();
    me.addComponent(MapPresenterComponent, {map: this._map});

    this._world.registerSystem(Giro3DSystem);
    const g3ds = this._world.getSystem(Giro3DSystem);
    g3ds?.setPresenter(this);
  }

  /**
   * Stop the presenter
   */
  async stop(): Promise<void> {
    // Cancel the ECS update loop
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
    this._externalLoop = null;
    this._clock.stop();
    this._state.value = PresenterState.Ready;
  }

  /**
   * Pause rendering
   */
  pause(): void {
    // Cancel the ECS update loop (it will check state and not reschedule)
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
    this._state.value = PresenterState.Paused;
  }

  /**
   * Resume rendering
   */
  resume(): void {
    if (this._state.value === PresenterState.Paused) {
      this._state.value = PresenterState.Running;

      // Restart the ECS update loop
      const ecsLoop = (time: number) => {
        if (this._state.value !== PresenterState.Running) {
          return;
        }
        if (this._externalLoop) {
          this._externalLoop(time);
        }
        this._animationFrameId = requestAnimationFrame(ecsLoop);
      };
      this._animationFrameId = requestAnimationFrame(ecsLoop);

      this._instance.notifyChange();
    }
  }

  /**
   * Dispose all resources
   */
  dispose(): void {
    // Cancel the ECS update loop
    if (this._animationFrameId !== null) {
      cancelAnimationFrame(this._animationFrameId);
      this._animationFrameId = null;
    }
    this._externalLoop = null;

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
      this._instance.notifyChange(this._camera);
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
      return new Vector3(0, 0, coords.h || 0);
    }
    const crs = this._coordAdapter.geographicToCRS(coords.lat, coords.lon);
    // Giro3D Map: X=Easting, Y=Northing, Z=Up (Y-up=false)
    return new Vector3(crs.x, crs.y, coords.h || 0);
  }

  /**
   * Convert scene coordinates to geographic coordinates
   */
  sceneToGeographic(sceneCoords: Vector3): GeographicCoords {
    if (!this._coordAdapter) {
      console.warn('No coordinate adapter configured for sceneToGeographic');
      return { lat: 0, lon: 0, h: sceneCoords.z };
    }
    // Giro3D Map: X=Easting, Y=Northing, Z=Up (Y-up=false)
    const geo = this._coordAdapter.crsToGeographic(
      sceneCoords.x,
      sceneCoords.y,
    );
    return { lat: geo.lat, lon: geo.lon, h: sceneCoords.z };
  }

  /**
   * Convert CRS coordinates to scene coordinates
   */
  crsToScene(x: number, y: number, z: number = 0): Vector3 {
    // In Map mode, CRS maps directly to scene
    // Giro3D Map: X=Easting, Y=Northing, Z=Up (Y-up=false)
    // Input: x=Easting, y=Northing, z=elevation
    return new Vector3(x, y, z);
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
   * Initialize the GIS root entity for MapPresenter.
   *
   * IMPORTANT: Unlike XRPresenter, MapPresenter does NOT reparent the GIS root
   * under LevelRoot. The Map's object3d must stay in Giro3D's scene hierarchy
   * for tile traversal to work. Reparenting would break Object3DLayer's
   * ability to find and update tiles.
   *
   * @param world - World instance for entity creation
   * @internal Called by World when setting up presenter mode
   */
  initGISRoot(world: World): void {
    if (this._gisRootEntity) {
      console.warn('GIS root entity already initialized');
      return;
    }

    this._world = world; // FIXME actually thats done in presenter.setWorld(..)
                        // should better check that world == this._world here and throw if not

    // Create GIS root entity WITHOUT reparenting (unlike initGISRootEntity)
    // The Map's object3d must stay in Giro3D's scene for tiles to work
    const gisRootEntity = world.createEntity();
    gisRootEntity.object3D = this._contentRoot;
    this._contentRoot.name = 'GIS_ROOT';

    // Store entity index on the Object3D for ECS lookups
    (this._contentRoot as any).entityIdx = gisRootEntity.index;

    // Add GISRootComponent tag
    gisRootEntity.addComponent(GISRootComponent);

    // Store reference on world for queries
    (world as any).gisRootIndex = gisRootEntity.index;

    // DO NOT reparent to activeRoot - the Map must stay in Giro3D's scene!
    // world.getActiveRoot().add(gisRootEntity.object3D); // <-- This breaks Giro3D!

    console.log('[MapPresenter] GIS root entity created (NOT reparented to LevelRoot)');
    console.log('[MapPresenter] Map object3d parent:', this._contentRoot.parent?.name);

    this._gisRootEntity = gisRootEntity;
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

    // =========================================================================
    // PRIMARY POINTER EVENTS
    // =========================================================================

    // Click → select event
    domElement.addEventListener('click', (event: MouseEvent) => {
      this._handlePointerEvent('select', event);
    });

    // Double click
    domElement.addEventListener('dblclick', (event: MouseEvent) => {
      this._handlePointerEvent('dblclick', event);
    });

    // Context menu (right click / long press)
    domElement.addEventListener('contextmenu', (event: MouseEvent) => {
      this._handlePointerEvent('contextmenu', event);
    });

    // Pointer down/up events
    domElement.addEventListener('pointerdown', (event: PointerEvent) => {
      this._handlePointerEvent('pointerdown', event);
    });

    domElement.addEventListener('pointerup', (event: PointerEvent) => {
      this._handlePointerEvent('pointerup', event);
    });

    // Pointer cancel (e.g., touch cancelled, pointer lost)
    domElement.addEventListener('pointercancel', (event: PointerEvent) => {
      this._handlePointerEvent('pointercancel', event);
    });

    // =========================================================================
    // MOVE EVENTS (throttled hover + raw pointermove)
    // =========================================================================

    let hoverThrottle = false;
    domElement.addEventListener('pointermove', (event: PointerEvent) => {
      // Always emit raw pointermove for subscribers that need it
      this._handlePointerEvent('pointermove', event);

      // Throttled hover for efficiency (50ms = ~20Hz)
      if (!hoverThrottle) {
        hoverThrottle = true;
        setTimeout(() => {
          hoverThrottle = false;
        }, 50);
        this._handlePointerEvent('hover', event);
      }
    });

    // =========================================================================
    // ENTER/LEAVE EVENTS (canvas boundary, not object-level)
    // =========================================================================

    domElement.addEventListener('pointerenter', (event: PointerEvent) => {
      this._handlePointerEvent('pointerenter', event);
    });

    domElement.addEventListener('pointerleave', (event: PointerEvent) => {
      this._handlePointerEvent('pointerleave', event);
    });

    // =========================================================================
    // WHEEL EVENT
    // =========================================================================

    domElement.addEventListener('wheel', (event: WheelEvent) => {
      this._handleWheelEvent(event);
    });
  }

  /**
   * Handle wheel events
   * @internal
   */
  private _handleWheelEvent(event: WheelEvent): void {
    const callbacks = this._pointerCallbacks.get('wheel');
    if (!callbacks || callbacks.size === 0) return;

    // Use Giro3D's picking to find object under cursor
    const picks = this._instance.pickObjectsAt(event, {
      radius: 2,
      sortByDistance: true,
    });

    const pointerId = 0; // Wheel doesn't have pointerId
    const pick = picks[0];

    const eventData: PointerEventData = {
      point: pick?.point ?? null,
      object: pick?.object ?? null,
      originalEvent: event,
      pointerId: pointerId,
      distance: pick?.distance,
      // Wheel-specific data
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
    };

    // Handle BatchedMesh
    if (pick?.object?.isBatchedMesh && pick?.batchId !== undefined) {
      eventData.instanceId = pick.batchId;
      eventData.batchName = pick.object.name;
    }

    this._emitPointerEvent('wheel', eventData);
  }

  /**
   * Handle a pointer event
   * @internal
   */
  private _handlePointerEvent(
    eventType: PointerEventType,
    event: MouseEvent | PointerEvent,
  ): void {
    console.log(`Giro3D PointerEvent: ${eventType}`);
    const callbacks = this._pointerCallbacks.get(eventType);
    if (!callbacks || callbacks.size === 0) return;

    // Get pointerId from PointerEvent, default to 0 for MouseEvent
    const pointerId = (event as PointerEvent).pointerId ?? 0;

    // Events that don't need picking (canvas-level, not object-level)
    if (eventType === 'pointerenter' || eventType === 'pointerleave' || eventType === 'pointercancel') {
      this._emitPointerEvent(eventType, {
        point: null,
        object: null,
        originalEvent: event,
        pointerId: pointerId,
      });
      return;
    }

    // Use Giro3D's picking for object-level events
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
        pointerId: pointerId,
        distance: pick.distance,
      };

      // Handle BatchedMesh
      if (pick.object?.isBatchedMesh && pick.batchId !== undefined) {
        eventData.instanceId = pick.batchId;
        eventData.batchName = pick.object.name;
      }

      this._emitPointerEvent(eventType, eventData);
    } else {
      // Emit event even with no pick for certain event types
      // These need to fire even when not over an object (e.g., for leave detection)
      const emitWithoutPick = ['hover', 'pointermove', 'pointerup', 'contextmenu'];
      if (emitWithoutPick.includes(eventType)) {
        this._emitPointerEvent(eventType, {
          point: null,
          object: null,
          originalEvent: event,
          pointerId: pointerId,
        });
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
    // Giro3D Map: X=Easting, Y=Northing, Z=Up (Y-up=false)
    // Offset camera slightly south (negative Y) for angled view
    const endPos = new Vector3(target.x, target.y - altitude * 0.2, altitude);
    const endTarget = new Vector3(target.x, target.y, 0); // Target at ground level

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
    extent: CRSExtent|{ minX: number; maxX: number; minY: number; maxY: number }|string,
    crsCode: any, //|CoordinateSystem,
  ): Promise<void>
  {
    if(typeof extent=='string'){
      extent = crsFromBBox(extent);
    }

    // Check if extent is in geographic coordinates (lat/lon) and convert to CRS if needed
    // Geographic coords are typically: lon in [-180, 180], lat in [-90, 90]
    // CRS coords (like UTM) are typically in meters: easting 100,000-900,000, northing millions
    let minX = extent.minX;
    let maxX = extent.maxX;
    let minY = extent.minY;
    let maxY = extent.maxY;

    const isGeographic = Math.abs(minX) < 180 && Math.abs(maxX) < 180 &&
                         Math.abs(minY) < 90 && Math.abs(maxY) < 90;

    if (isGeographic && this._coordAdapter) {
      console.log('[MapPresenter] Extent appears to be in geographic coordinates, converting to CRS...');
      console.log('[MapPresenter] Geographic extent:', minX, maxX, minY, maxY);

      // Convert corners from geographic to CRS
      // Note: minX/maxX are longitudes, minY/maxY are latitudes
      const sw = this._coordAdapter.geographicToCRS(minY, minX); // lat, lon
      const ne = this._coordAdapter.geographicToCRS(maxY, maxX);

      minX = sw.x;
      maxX = ne.x;
      minY = sw.y;
      maxY = ne.y;

      console.log('[MapPresenter] Converted CRS extent:', minX, maxX, minY, maxY);
    }

    const giro3dExtent = new Extent(
      crsCode,
      minX,
      maxX,
      minY,
      maxY,
    );

    // compute center of Map's extent. (TODO would be good if it aligned with 'this.origin' to avoid confusion)
    this.center = {lon: (giro3dExtent.west + giro3dExtent.east) / 2,
                   lat: (giro3dExtent.south + giro3dExtent.north) / 2 };

    console.log('[MapPresenter] Creating map with extent:', giro3dExtent);

    this._map = new Giro3DMap({
      name: this._config.name || "giro3d_map",
      extent: giro3dExtent,
      discardNoData: this._config.discardNoData ?? false,
      backgroundColor: this._config.backgroundColor, //  || '#f0f0f0'
      backgroundOpacity: this._config.backgroundOpacity,
      subdivisionThreshold: this._config.subdivisionThreshold, // default: 1.5
      maxSubdivisionLevel: this._config.maxSubdivisionLevel, // by default its 30
      showOutline: this._config.showOutline,
      outlineColor: this._config.outlineColor,
      side: this._config.side,
      depthTest: this._config.depthTest,
      // Use our custom subdivision strategy that allows Object3DLayers
      // to coexist with ElevationLayers without blocking tile subdivision.
      // The default Giro3D strategy blocks on Object3DLayers (see iwsdkSubdivisionStrategy).
      subdivisionStrategy: iwsdkSubdivisionStrategy,
      terrain: this._config.terrain,
      // by default lighting is disabled in giro3d
      castShadow: this._config.castShadow || false,
      receiveShadow: this._config.receiveShadow || false
    });


    /*Add THREE object or Entity to the instance.
    If the object or entity has no parent, it will be added to the default tree 
    (i.e under .scene for entities and under .threeObjects for regular Object3Ds.).
    If the object or entity already has a parent, then it will not be changed.
    Check that this parent is present in the scene graph
   (i.e has the .scene object as ancestor), otherwise it will never be displayed. */
    const _maplayer = await this._instance.add(this._map);

    // Force initial tile generation by notifying change
    console.log('[MapPresenter] Map created, triggering initial update');
    this._instance.notifyChange();
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

    // Position camera at initial view (hovering above device origin)
    // Giro3D Map uses: X=Easting, Y=Northing, Z=Up (Y-up=false)
   /* if (false && this._coordAdapter) {
      const origin = this._coordAdapter.getOrigin();
      const altitude = this._config.initialAltitude || 500;

      console.log(`[MapPresenter] Setting camera position from origin:`, origin);
      console.log(`[MapPresenter] Camera will be at CRS (X=E, Y=N, Z=alt):`, origin.crs.x, origin.crs.y + altitude * 0.2, altitude);

      this._camera.position.set(
        origin.crs.x,
        origin.crs.y + altitude * 0.2, // Offset northward slightly for angled view
        altitude,
      );
      this._controls.target.set(origin.crs.x, origin.crs.y, 0);
      this._controls.saveState();
    } else {*/
      // No coordinate adapter - position camera at center of map extent
      console.log(`[MapPresenter] No coordinate adapter, positioning camera at map extent center`);
      const ext = this._map.extent;
      const centerX = (ext.west + ext.east) / 2;
      const centerY = (ext.south + ext.north) / 2;
      const altitude = this._config.initialAltitude || 500;

      console.log(`[MapPresenter] Map extent center (X=E, Y=N):`, centerX, centerY);
      // X=Easting, Y=Northing (offset south for angled view), Z=altitude
      this._camera.position.set(centerX, centerY - altitude * 0.2, altitude);
      this._controls.target.set(centerX, centerY, 0);
      this._controls.saveState();
  //  }

    // Notify on control changes
    // this._controls.addEventListener('change', () => {
    //    this.notifyChange();    });
    this._instance.view.setControls(this._controls);

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
   * Diagnostic method: dump tile tree state and intercept subdivision logic.
   *
   * Call this AFTER the map is initialized and has had at least one frame.
   * It logs all relevant state and monkey-patches Giro3D's Map methods
   * to trace why tiles are (or aren't) subdividing.
   *
   * @example
   * ```ts
   * mapPresenter.debugSubdivision();
   * // Then zoom in and check the console
   * ```
   */
  debugSubdivision(): void {
    if (!this._map || !this._instance) {
      console.error('[DEBUG] Map or Instance not initialized');
      return;
    }

    const map = this._map;
    const view = this._instance.view;
    const camera = view.camera;

    // ── 1. Static state ──────────────────────────────────────
    console.group('[DEBUG] ═══ Map Subdivision Diagnostics ═══');

    console.log('Map.frozen:', map.frozen);
    console.log('Map.maxSubdivisionLevel:', map.maxSubdivisionLevel);
    console.log('Map.subdivisionThreshold:', map.subdivisionThreshold);
    console.log('Map.terrain.enabled:', map.terrain?.enabled);
    console.log('Map.visible:', map.visible);
    console.log('Map.ready:', (map as any)._ready);
    console.log('Map.layerCount:', map.layerCount);
    console.log('Map.extent:', map.extent?.toString?.() || map.extent);

    console.log('View.width:', view.width, 'View.height:', view.height);
    console.log('Camera.type:', camera.type);
    console.log('Camera.position:', camera.position.toArray());
    console.log('Camera.near:', camera.near, 'Camera.far:', camera.far);
    console.log('Camera.fov:', (camera as any).fov);
    console.log('Camera.matrixWorldNeedsUpdate:', camera.matrixWorldNeedsUpdate);
    console.log('Camera.up:', camera.up.toArray());

    const mainLoop = (this._instance as any).mainLoop || (this._instance as any)._mainLoop;
    if (mainLoop) {
      console.log('MainLoop.automaticCameraPlaneComputation:', mainLoop.automaticCameraPlaneComputation);
    }

    // ── 2. Tile tree ─────────────────────────────────────────
    const tiles: any[] = [];
    const collectTiles = (obj: any, depth = 0) => {
      // TileMesh has .extent and .lod or .coordinate
      if (obj.isTileMesh || obj.coordinate !== undefined || (obj.extent && obj.lod !== undefined)) {
        tiles.push({
          name: obj.name,
          lod: obj.coordinate?.z ?? obj.lod ?? '?',
          visible: obj.visible,
          materialVisible: obj.material?.visible,
          parent: obj.parent?.name,
          childCount: obj.children?.length,
          depth,
        });
      }
      if (obj.children) {
        for (const child of obj.children) {
          collectTiles(child, depth + 1);
        }
      }
    };
    collectTiles(map.object3d);
    console.log('Tile tree (' + tiles.length + ' tiles):');
    console.table(tiles);

    // ── 3. Root tile bounding boxes ──────────────────────────
    const rootTiles = (map as any)._rootTiles;
    if (rootTiles) {
      console.log('Root tiles:', rootTiles.length);
      for (const tile of rootTiles) {
        const bbox = new Box3();
        if (tile.getWorldSpaceBoundingBox) {
          tile.getWorldSpaceBoundingBox(bbox);
          const size = new Vector3();
          bbox.getSize(size);
          const center = new Vector3();
          bbox.getCenter(center);
          console.log(`  Tile "${tile.name}" LOD=${tile.coordinate?.z}:`,
            '\n    worldBox center:', center.toArray(),
            '\n    worldBox size:', size.toArray(),
            '\n    worldBox min:', bbox.min.toArray(),
            '\n    worldBox max:', bbox.max.toArray(),
            '\n    position:', tile.position.toArray(),
            '\n    visible:', tile.visible,
            '\n    materialVisible:', tile.material?.visible,
            '\n    textureSize:', tile.textureSize?.toArray?.(),
          );

          // Compute distance from camera to box
          const geometricError = Math.max(size.x, size.y);
          const camInLocal = camera.position.clone();
          const dist = bbox.distanceToPoint(camInLocal);
          console.log(`    geometricError: ${geometricError}, cameraDist: ${dist}`,
            `\n    dist <= geoError? ${dist <= geometricError} (→ null SSE → should subdivide)`);
        }
      }
    } else {
      console.warn('Could not access _rootTiles');
    }

    console.groupEnd();

    // ── 4. Monkey-patch: intercept update cycle ──────────────
    // Listen to Giro3D instance events to see if updates are running
    let updateCount = 0;
    this._instance.addEventListener('update-start', () => {
      updateCount++;
      if (updateCount <= 5) {
        console.log(`[DEBUG] Giro3D update-start (frame #${updateCount})`);
      }
    });
    this._instance.addEventListener('before-entity-update', (e: any) => {
      if (e.entity === map && updateCount <= 5) {
        console.log(`[DEBUG] Map entity about to update (frame #${updateCount})`);
      }
    });
    this._instance.addEventListener('after-entity-update', (e: any) => {
      if (e.entity === map && updateCount <= 5) {
        // Re-count tiles after update
        let tileCount = 0;
        let visibleCount = 0;
        const countTiles = (obj: any) => {
          if (obj.isTileMesh || obj.coordinate !== undefined) {
            tileCount++;
            if (obj.visible) visibleCount++;
          }
          if (obj.children) obj.children.forEach(countTiles);
        };
        countTiles(map.object3d);
        console.log(`[DEBUG] After Map update: ${tileCount} tiles (${visibleCount} visible)`);
      }
    });

    // ── 5. Monkey-patch Map.shouldSubdivide (if accessible) ──
    const proto = Object.getPrototypeOf(map);
    const origShouldSubdivide = proto.shouldSubdivide;
    if (origShouldSubdivide) {
      let patchCallCount = 0;
      proto.shouldSubdivide = function(context: any, node: any) {
        const result = origShouldSubdivide.call(this, context, node);
        patchCallCount++;
        if (patchCallCount <= 20) {
          const wb = new Box3();
          node.getWorldSpaceBoundingBox(wb);
          const sz = new Vector3();
          wb.getSize(sz);
          console.log(`[DEBUG] shouldSubdivide LOD=${node.coordinate?.z} → ${result}`,
            `worldBoxSize=[${sz.x.toFixed(0)},${sz.y.toFixed(0)},${sz.z.toFixed(1)}]`,
            `cam=[${context.view.camera.position.x.toFixed(0)},${context.view.camera.position.y.toFixed(0)},${context.view.camera.position.z.toFixed(0)}]`,
            `viewSize=${context.view.width}x${context.view.height}`);
        }
        return result;
      };
      console.log('[DEBUG] Patched Map.shouldSubdivide — zoom in and check console');
    } else {
      console.warn('[DEBUG] Could not patch shouldSubdivide (not on prototype)');
    }

    // Also patch testVisibility
    const origTestVis = proto.testVisibility;
    if (origTestVis) {
      let visCallCount = 0;
      proto.testVisibility = function(node: any, context: any) {
        const result = origTestVis.call(this, node, context);
        visCallCount++;
        if (visCallCount <= 20) {
          console.log(`[DEBUG] testVisibility LOD=${node.coordinate?.z} → ${result}`);
        }
        return result;
      };
    }

    // Trigger one update to see the output
    console.log('[DEBUG] Triggering notifyChange(camera) now...');
    this._instance.notifyChange(this._camera);
  }

  /**
   * Check if Giro3D is available
   */
  static async isSupported(): Promise<boolean> {
    return loadGiro3D();
  }
}
