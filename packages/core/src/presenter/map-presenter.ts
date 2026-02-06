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
import { CoordinateAdapter } from './coordinate-adapter.js';
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
import { AnySchema, ComponentRegistry } from 'elics';
import { getComponent } from '../ecs/helpers.js';

// ============================================================================
// GIRO3D TYPES (dynamically loaded)
// ============================================================================

/** Giro3D Instance class */
let Instance: any;
/** Giro3D Extent class */
let Extent: any;
let ElevationLayer: any;
let Object3DLayer: any;
let Object3DSource: any;
let CoordinateSystem: any; 
/** Giro3D Map class */
let Giro3DMap: any;
/** Giro3D ColorLayer class */
let ColorLayer: any;
/** Giro3D TiledImageSource class */
let TiledImageSource: any;

/** Whether Giro3D has been loaded */
let giro3dLoaded = false;

/** FeatureSource class (created dynamically after Giro3D loads) */
let FeatureSourceClass: any = null;

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
    ColorLayer = giro3d.layer.ColorLayer;
    Object3DLayer = giro3d.layer.Object3DLayer;
    ElevationLayer = giro3d.layer.ElevationLayer;
    Object3DSource = giro3d.Object3DSource;
    TiledImageSource = giro3d.TiledImageSource;

    // Define FeatureSource class after Object3DSource is loaded
    FeatureSourceClass = createFeatureSourceClass();

    giro3dLoaded = true;
    return true;
  } catch (err) {
    console.warn('Giro3D not available:', err);
    return false;
  }
}

export interface FeatureSourceOptions {
  crs: typeof CoordinateSystem;
  crs_name?: string; // i.e. 'EPSG:4326' crs of query's bbox
  config: any; // datasource configuration object from project file
  extent: typeof Extent;
  fetcher: any;
  featureclass_name: string;
}

/**
 * Factory function to create FeatureSource class after Giro3D is loaded.
 * This is necessary because Object3DSource is dynamically imported.
 * @internal
 */
function createFeatureSourceClass() {
  /**
   * FeatureSource - extends Giro3D's Object3DSource for ECS feature loading
   *
   * IMPORTANT: The fetcher returns geometries in ENU coordinates (centered at geo-origin 0,0,0).
   * These need to be wrapped with an offset to position them correctly in CRS space (UTM meters).
   */
  return class FeatureSource extends Object3DSource {
    _config: any;
    _fetcher: any;
    featureclass_name: string;
    crs: any;
    crs_name!: string;
    extent: any;
    /** CRS coordinates of the ENU origin (for transforming ENU geometry to CRS) */
    originCRS: { x: number; y: number };

    constructor(opts: FeatureSourceOptions & { originCRS: { x: number; y: number } }) {
      super();
      this._config = opts.config;
      this._fetcher = opts.fetcher;
      this.featureclass_name = opts.featureclass_name;
      this.crs_name = opts.crs_name as string;
      this.crs = opts.crs;
      this.extent = opts.extent;
      this.originCRS = opts.originCRS;
    }

    /**
     * Called by Giro3D's Object3DLayer when it needs objects for a tile.
     *
     * The fetcher returns ENU-centered geometry (origin at 0,0,0 at the geo-origin).
     * We wrap it in a Group positioned at the CRS origin to transform it to CRS coordinates.
     *
     * @param { GetObjectsOptions } param0
     * @returns { objects: Object3D[], id: string } - Array of Object3D instances in CRS coordinates
     */
    async getObjects({ id, extent, signal }: { id: string; extent: any; signal?: AbortSignal }) {
      console.log(`[FeatureSource] getObjects called for ${this.featureclass_name}, tile: ${id}`);
      console.log(`[FeatureSource] extent:`, extent.west, extent.south, extent.east, extent.north);
      console.log(`[FeatureSource] ENU origin in CRS:`, this.originCRS);

      const bbox = `${extent.west},${extent.south},${extent.east},${extent.north},${this.crs_name}`; // extent.crs.name -> "ETRS_1989_UTM_Zone_32N"
      const opts = {
        bbox: bbox,
        dataSource: this._config,
        // tile_index: tile_desc.id, z-x-y
        // origin:
        // parent: .. tile that triggered the load
      };

      try {
        console.log(`[FeatureSource] called fetcher with bbox: ${bbox}`);
        const features = await this._fetcher(this.featureclass_name, opts);
        console.log(`[FeatureSource] fetcher returned:`, features);

        // Normalize return value to array
        let rawObjects: any[];
        if (Array.isArray(features)) {
          rawObjects = features;
        } else if (features && features.isObject3D) {
          rawObjects = [features];
        } else {
          console.warn(`[FeatureSource] fetcher returned unexpected value:`, features);
          rawObjects = [];
        }

        // Wrap geometry and transform to Giro3D Map coordinate system
        // Giro3D Map: X=Easting, Y=Northing, Z=Up (Y-up=false)
        //
        // Two cases:
        // 1. ENU geometry (centered near 0,0,0) - needs offset to CRS origin + rotation
        // 2. CRS geometry (already at ~726000, 5746000) - needs only rotation, no offset
        //
        // We detect by checking if object bounds are near origin (ENU) or far (CRS)
        const CRS_THRESHOLD = 10000; // Objects with coords > 10km are likely in CRS already

        const wrappedObjects = rawObjects.map(obj => {
          // Check if object is in ENU (near origin) or CRS (far from origin)
          const bbox = new Box3().setFromObject(obj);
          const isValidBBox = bbox.min.x !== Infinity && bbox.max.x !== -Infinity;
          const maxCoord = isValidBBox ? Math.max(
            Math.abs(bbox.min.x), Math.abs(bbox.max.x),
            Math.abs(bbox.min.y), Math.abs(bbox.max.y),
            Math.abs(bbox.min.z), Math.abs(bbox.max.z)
          ) : 0;

          const isAlreadyCRS = maxCoord > CRS_THRESHOLD;
          console.log(`[FeatureSource] Object ${obj.name} bbox:`, bbox.min, bbox.max,
            `maxCoord: ${maxCoord}, isAlreadyCRS: ${isAlreadyCRS}`);

          const wrapper = new Group();
          wrapper.name = `ENUWrapper_${obj.name || this.featureclass_name}`;

          // Rotate from Y-up (ENU/Three.js) to Z-up (Giro3D Map) coordinate system
          // rotation.x = +π/2 rotates: Y(up)->+Z(up), Z(north)->-Y
          // Note: This may flip north/south - if so, we'll need scale.y = -1
          wrapper.rotation.x = Math.PI / 2;

          wrapper.add(obj);

          // IMPORTANT: Object3DLayer adds objects as children of tile Groups.
          // Tiles are already positioned in CRS space, so adding a CRS offset
          // would DOUBLE the coordinates. We only need to handle the offset
          // between the ENU origin and the object's local center.
          //
          // For ENU objects: The ENU origin (device position) maps to CRS origin.
          //   Objects at ENU (0,0,0) should appear at the ENU origin in CRS space.
          //   But since we're adding to a tile that covers a geographic area,
          //   we need the offset from tile center to ENU origin.
          //
          // For simplicity: Objects in ENU are centered around the geographic origin.
          //   If the tile center ≈ ENU origin, objects should appear correctly.
          //   We add the ENU origin offset so objects appear at the right CRS location.
          //
          // Wait - the issue is tiles ARE the parents. Let's check if tiles have transforms...
          // Actually, looking at Giro3D: tiles don't transform children, they're just containers.
          // The Map.object3d is at world origin, tiles are at world origin too.
          // So we DO need the CRS offset!
          //
          // The doubling issue must be elsewhere... Let's NOT add offset and debug.
          console.log(`[FeatureSource] Object ${isAlreadyCRS ? 'in CRS' : 'in ENU'} coords, wrapper at origin (debug)`);
          wrapper.position.set(0, 0, 0);

          return wrapper;
        });

        console.log(`[FeatureSource] returning ${wrappedObjects.length} wrapped objects for tile ${id}`);
        return { objects: wrappedObjects, id };
      } catch (err) {
        console.error(`[FeatureSource] Error fetching ${this.featureclass_name}:`, err);
        return { objects: [], id };
      }
    }

    /**
     * Returns the CRS of this source.
     * @returns The coordinate reference system.
     */
    getCrs() {
      return this.crs;
    }

    /**
     * Returns the extent of this source, or undefined if unbounded.
     * @returns The extent of the source data.
     */
    getExtent() {
      return this.extent;
    }
  };
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

     // NOTE: Giro3d requires WKT definition not proj4
    const crs = CoordinateSystem.register(config.crs.code, config.crs.proj4);

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
    this._contentRoot = this._map.object3d;
    if(!this._contentRoot){throw "implementation error";}
    
    this._setupControls();
    this._setupInput();

    this._state.value = PresenterState.Ready;
  }

  async _setupSources(fetcher: any) {
    console.log('[MapPresenter] _setupSources called');

    const dsc = ComponentRegistry.getById('DataSource');
    if (!dsc) {
      console.warn('[MapPresenter] DataSource component not registered - no sources to setup');
      return;
    }

    // Find all datasource entities in this._world
    const sources_query = this._world.queryManager.registerQuery({
      required: [dsc]
    });

    const entityCount = sources_query.entities.size;
    console.log(`[MapPresenter] Found ${entityCount} DataSource entities`);

    if (entityCount === 0) {
      console.warn('[MapPresenter] No DataSource entities found. Call setupSources() after creating DataSource entities.');
      return;
    }

    // Create a source-layer pair for each feature of each datasource
    await Promise.all(Array.from(sources_query.entities).map(async (s) => {
      let src_config = getComponent(dsc, s);
      if (!src_config) {
        throw `implementation error: invalid datasource with index: ${s.index}`;
      }
      // src_config.srsname = this._config.crs?.code; // crs of features in response // NO!! They're always ENU (centered at origin)

      const features = (src_config.feature_types as string).split?.(',');
      if (features.length == 0) {
        console.warn("No feature-classes for DataSource ");
      }
      await Promise.all(features.map(async (fc, i, _) => {

        const fdef = (src_config.feature_definition as unknown[])?.[i];
        if (!fdef) {
          throw "ImplementationError";
        }
        // Ensure extent is a Giro3D Extent object in CRS coordinates
        let sourceExtent = this._map.extent; // Default to map extent (already a Giro3D Extent)
        if (src_config?.extent) {
          const ext = src_config.extent as any;
          if (ext.crs && ext.west !== undefined) {
            // Already a Giro3D Extent-like object
            sourceExtent = ext;
          } else if (ext.minX !== undefined) {
            let minX = ext.minX;
            let maxX = ext.maxX;
            let minY = ext.minY;
            let maxY = ext.maxY;

            // Check if extent is in geographic coordinates and convert if needed
            const isGeographic = Math.abs(minX) < 180 && Math.abs(maxX) < 180 &&
                                 Math.abs(minY) < 90 && Math.abs(maxY) < 90;

            if (isGeographic && this._coordAdapter) {
              console.log(`[MapPresenter] Source extent for ${fc} is in geographic coords, converting...`);
              const sw = this._coordAdapter.geographicToCRS(minY, minX);
              const ne = this._coordAdapter.geographicToCRS(maxY, maxX);
              minX = sw.x;
              maxX = ne.x;
              minY = sw.y;
              maxY = ne.y;
              console.log(`[MapPresenter] Converted source extent:`, minX, maxX, minY, maxY);
            }

            sourceExtent = new Extent(this._map.extent.crs, minX, maxX, minY, maxY);
          }
        }

        // Get CRS coordinates of the ENU origin for transforming geometry
        const originCRS = this._coordAdapter?.getOrigin()?.crs || { x: 0, y: 0 };

        console.log(`[MapPresenter] Creating layer for feature: ${fc} of src: ${src_config.name}`);
        console.log(`[MapPresenter] Source extent:`, sourceExtent);
        console.log(`[MapPresenter] Map extent:`, this._map.extent);
        console.log(`[MapPresenter] Map extent CRS:`, this._map.extent.crs);
        console.log(`[MapPresenter] ENU origin CRS:`, originCRS);

        const source = new FeatureSourceClass({
          fetcher: fetcher,
          crs_name: this._config.crs?.code, // the CRS of the query's bbox //(src_config.srsname as string),
          config: src_config,
          featureclass_name: fc,
          crs: this._map.extent.crs, // Use map extent's CRS (properly initialized) // NOTE: same as crs_name
          extent: sourceExtent,
          originCRS: originCRS, // Pass ENU origin for coordinate transform
        });

        // Create layer - extent is important for Giro3D to know when to query the source
        const layer = new Object3DLayer({
          source: source,
          name: fc,
          // minLevel: ...
          // maxLevel: ...
          extent: sourceExtent, // Giro3D Extent object
          /*
          // Use map's elevation to place objects on terrain
          elevationProvider: (coords: Coordinates) => {
              const result = map.getElevation({ coordinates: coords });
              return result.samples?.[0]?.elevation;
          },*/
        });

        console.log(`[MapPresenter] Adding layer ${fc} to map...`);
        await this._map.addLayer(layer);
        console.log(`[MapPresenter] Layer added: ${fc}, map now has ${this._map.layerCount} layers`);
        console.log(`[MapPresenter] Layer visible:`, layer.visible, 'Layer frozen:', layer.frozen);
        console.log(`[MapPresenter] Layer ready:`, (layer as any).ready);

        // Debug: Check if source contains the map extent
        const mapExt = this._map.extent;
        const sourceContains = source.contains ? source.contains(mapExt) : 'no contains method';
        console.log(`[MapPresenter] Source contains map extent:`, sourceContains);
        console.log(`[MapPresenter] Source extent:`, source.getExtent());
        console.log(`[MapPresenter] Source CRS:`, source.getCrs());
      }));
    }));

    // Notify Giro3D that it needs to update after adding layers
    console.log(`[MapPresenter] All layers added. Notifying Giro3D to update...`);
    console.log(`[MapPresenter] Camera position:`, this._camera.position);
    console.log(`[MapPresenter] Map extent:`, this._map.extent);

    // Debug: Check map tiles
    console.log(`[MapPresenter] Map object3d children:`, this._map.object3d?.children?.length);
    if (this._map.object3d?.children?.[0]) {
      const firstChild = this._map.object3d.children[0];
      console.log(`[MapPresenter] First map child:`, firstChild.name, 'visible:', firstChild.visible);
      if (firstChild.children?.[0]) {
        const tile = firstChild.children[0];
        console.log(`[MapPresenter] First tile:`, tile.name, 'visible:', tile.visible);
      }
    }

    this._instance.notifyChange();
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
   */
  setWorld(world: World){
    this._world = world;
    // Don't call _setupSources here - DataSource entities may not exist yet!
    // The app should call setupSources() after creating DataSource entities.
  }

  /**
   * Set up Object3DLayers for all DataSource entities in the world.
   *
   * This queries for DataSource entities and creates corresponding Giro3D
   * Object3DLayers with FeatureSources. Call this AFTER DataSource entities
   * have been created (e.g., after projectManager.init()).
   *
   * @param fetcher - Optional fetcher callback. If not provided, uses the one from config.
   * @returns Promise that resolves when all layers are set up
   *
   * @example
   * ```ts
   * // After creating DataSource entities
   * await projectManager.init();
   * await mapPresenter.setupSources();
   * ```
   */
  async setupSources(fetcher?: any): Promise<void> {
    const actualFetcher = fetcher ?? this._config.fetcher;
    if (!actualFetcher) {
      console.warn('MapPresenter.setupSources: No fetcher provided');
      return;
    }
    return this._setupSources(actualFetcher);
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

    this._world = world;

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

    console.log('[MapPresenter] Creating map with extent:', giro3dExtent);

    this._map = new Giro3DMap({
      name: this._config.name || "giro3d_map",
      extent: giro3dExtent,
      backgroundColor: this._config.backgroundColor, //  || '#f0f0f0'
      backgroundOpacity: this._config.backgroundOpacity || 1.0,
    });

    /*Add THREE object or Entity to the instance.
    If the object or entity has no parent, it will be added to the default tree 
    (i.e under .scene for entities and under .threeObjects for regular Object3Ds.).
    If the object or entity already has a parent, then it will not be changed.
    Check that this parent is present in the scene graph
   (i.e has the .scene object as ancestor), otherwise it will never be displayed. */
    const _maplayer = await this._instance.add(this._map);

    // Add basemap if configured
    if (this._config.basemapSource) {
      await this._addBasemapLayer(this._config.basemapSource);
    }

    // Force initial tile generation by notifying change
    console.log('[MapPresenter] Map created, triggering initial update');
    this._instance.notifyChange();
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

    // Position camera at initial view (hovering above device origin)
    // Giro3D Map uses: X=Easting, Y=Northing, Z=Up (Y-up=false)
    if (false && this._coordAdapter) {
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
    } else {
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
