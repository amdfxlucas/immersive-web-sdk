/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRInputManager, XROrigin } from '@iwsdk/xr-input';
import { Signal, signal } from '@preact/signals-core';
import {
  System as ElicsSystem,
  Query,
  SystemConstructor,
  SystemQueries,
  SystemSchema,
  TypeValueToType,
} from 'elics';
import type { QueryManager } from 'elics/lib/query-manager.js';
import { Object3D, Vector3 } from 'three';
import { isGISPresenter, type IPresenter, type IGISPresenter, type GeographicCoords } from '../presenter/index.js';
import {
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebXRManager,
} from '../runtime/index.js';
import { Entity } from './entity.js';
import type { VisibilityState, World } from './world';

type SystemConfigSignals<S extends SystemSchema> = {
  [K in keyof S]: Signal<TypeValueToType<S[K]['type']>>;
};

/**
 * System base interface wired to the IWSDK World, renderer, and XR runtime.
 *
 * @remarks
 * - `createSystem(queries, schema)` returns a class that implements this interface.
 * - Config values are exposed as reactive Signals on `this.config.<key>`.
 * - Common world resources are available as readonly properties (`player`, `input`,
 *   `scene`, `camera`, `renderer`, `visibilityState`).
 * - When using presenter mode, additional methods are available for coordinate
 *   transforms and content root management.
 * - Use `cleanupFuncs.push(() => ...)` to register teardown callbacks.
 *
 * @category ECS
 */
export interface System<S extends SystemSchema, Q extends SystemQueries>
  extends ElicsSystem<S, Q> {
  isPaused: boolean;
  config: SystemConfigSignals<S>;
  queries: Record<keyof Q, Query>;
  world: World;
  queryManager: QueryManager;
  priority: number;
  globals: Record<string, any>;
  xrManager: WebXRManager;
  xrFrame: XRFrame;

  readonly player: XROrigin;
  readonly input: XRInputManager;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;
  readonly visibilityState: Signal<VisibilityState>;
  readonly cleanupFuncs: Array<() => void>;

  /** The active presenter (if using presenter mode) */
  readonly presenter: IPresenter | undefined;

  /** The GIS presenter (if presenter supports GIS operations) */
  readonly gisPresenter: IGISPresenter | undefined;

  init(): void;
  update(delta: number, time: number): void;
  play(): void;
  stop(): void;
  createEntity: () => Entity;

  // Presenter-mode methods
  /** Get the content root for GIS/application content */
  getContentRoot(): Object3D;
  /** Add an object to the content root */
  addToContentRoot(object3D: Object3D, isENU?: boolean): void;
  /** Notify presenter that scene needs re-rendering (Map mode) */
  notifyChange(): void;
  /** Convert geographic coordinates to scene coordinates */
  geographicToScene(coords: GeographicCoords): Vector3;
  /** Convert scene coordinates to geographic coordinates */
  sceneToGeographic(sceneCoords: Vector3): GeographicCoords;
  /** Convert CRS coordinates to scene coordinates */
  crsToScene(x: number, y: number, z?: number): Vector3;
  /** Convert scene coordinates to CRS coordinates */
  sceneToCRS(sceneCoords: Vector3): { x: number; y: number; z: number };
}

/**
 * Create a strongly-typed System class with query bindings and reactive config.
 *
 * @param queries Elics query descriptors keyed by name.
 * @param schema Option map of config defaults and Types.
 * @returns A System constructor to `export class MySystem extends createSystem(...) { ... }`.
 *
 * @example
 * export class Rotator extends createSystem({ items: { required: [Transform] } }, {
 *   speed: { type: Types.Float32, default: 1 }
 * }) {
 *   update(dt:number){ this.queries.items.entities.forEach(e=> e.object3D.rotateY(dt*this.config.speed.value)) }
 * }
 *
 * @category ECS
 */
export function createSystem<S extends SystemSchema, Q extends SystemQueries>(
  queries: Q = {} as Q,
  schema: S = {} as S,
): SystemConstructor<S, Q, World, System<S, Q>> {
  return class implements System<S, Q> {
    static schema = schema;
    static isSystem = true;
    static queries = queries;

    public isPaused: boolean = false;
    public queries!: Record<keyof Q, Query>;
    public config = {} as SystemConfigSignals<S>;

    public readonly player: XROrigin;
    public readonly input: XRInputManager;
    public readonly scene: Scene;
    public readonly camera: PerspectiveCamera;
    public readonly renderer: WebGLRenderer;
    public readonly visibilityState: Signal<VisibilityState>;
    public readonly cleanupFuncs: Array<() => void> = [];

    constructor(
      public readonly world: World,
      public queryManager: QueryManager,
      public priority: number,
    ) {
      for (const key in schema) {
        this.config[key] = signal(schema[key].default as any);
      }
      this.player = world.player;
      this.input = world.input;
      this.scene = world.scene;
      this.camera = world.camera;
      this.renderer = world.renderer;
      this.visibilityState = world.visibilityState;
    }

    get globals() {
      return this.world.globals;
    }

    get xrManager() {
      return this.world.renderer.xr;
    }

    get xrFrame() {
      return this.xrManager.getFrame();
    }

    /**
     * Get the active presenter (if using presenter mode)
     */
    get presenter(): IPresenter | undefined {
      return this.world.presenter;
    }

    /**
     * Get the GIS presenter (if presenter supports GIS operations)
     */
    get gisPresenter(): IGISPresenter | undefined {
      return isGISPresenter(this.presenter) ? this.presenter : undefined;
    }

    createEntity(): Entity {
      return this.world.createEntity();
    }

    createTransformEntity(object?: Object3D, parent?: Entity): Entity {
      return this.world.createTransformEntity(object, parent);
    }

    init(): void {}

    update(_delta: number, _time: number): void {}

    play(): void {
      this.isPaused = false;
    }

    stop(): void {
      this.isPaused = true;
    }

    destroy(): void {
      this.cleanupFuncs.forEach((func) => func());
    }

    // ========================================================================
    // PRESENTER-MODE METHODS
    // ========================================================================

    /**
     * Get the content root for GIS/application content.
     *
     * When using presenter mode, returns the presenter's content root.
     * Otherwise returns the world's active root.
     */
    getContentRoot(): Object3D {
      return this.world.getContentRoot();
    }

    /**
     * Add an object to the content root.
     *
     * When using presenter mode, this ensures proper handling of
     * ENU-coordinate geometry (automatic wrapping in Map mode).
     *
     * @param object3D - Object to add
     * @param isENU - Whether object is in ENU coordinates (default true)
     */
    addToContentRoot(object3D: Object3D, isENU: boolean = true): void {
      if (this.presenter) {
        this.presenter.addObject(object3D, { isENU });
      } else {
        this.getContentRoot().add(object3D);
      }
    }

    /**
     * Notify presenter that scene needs re-rendering.
     *
     * For Map mode's on-demand rendering, this triggers a render.
     * For XR mode's continuous rendering, this is a no-op.
     */
    notifyChange(): void {
      this.presenter?.notifyChange();
    }

    /**
     * Convert geographic coordinates to scene coordinates.
     *
     * Works in both XR (ENU) and Map (CRS) modes when a GIS presenter is active.
     * Returns a zero-height vector if no GIS presenter is available.
     */
    geographicToScene(coords: GeographicCoords): Vector3 {
      const gis = this.gisPresenter;
      if (!gis) {
        console.warn('geographicToScene requires a GIS-enabled presenter');
        return new Vector3(0, coords.h || 0, 0);
      }
      return gis.geographicToScene(coords);
    }

    /**
     * Convert scene coordinates to geographic coordinates.
     *
     * Returns null coordinates if no GIS presenter is available.
     */
    sceneToGeographic(sceneCoords: Vector3): GeographicCoords {
      const gis = this.gisPresenter;
      if (!gis) {
        console.warn('sceneToGeographic requires a GIS-enabled presenter');
        return { lat: 0, lon: 0, h: sceneCoords.y };
      }
      return gis.sceneToGeographic(sceneCoords);
    }

    /**
     * Convert CRS coordinates to scene coordinates.
     *
     * Returns a simple mapping if no GIS presenter is available.
     */
    crsToScene(x: number, y: number, z: number = 0): Vector3 {
      const gis = this.gisPresenter;
      if (!gis) {
        console.warn('crsToScene requires a GIS-enabled presenter');
        return new Vector3(x, z, -y);
      }
      return gis.crsToScene(x, y, z);
    }

    /**
     * Convert scene coordinates to CRS coordinates.
     *
     * Returns a simple mapping if no GIS presenter is available.
     */
    sceneToCRS(sceneCoords: Vector3): { x: number; y: number; z: number } {
      const gis = this.gisPresenter;
      if (!gis) {
        console.warn('sceneToCRS requires a GIS-enabled presenter');
        return { x: sceneCoords.x, y: -sceneCoords.z, z: sceneCoords.y };
      }
      return gis.sceneToCRS(sceneCoords);
    }
  };
}
