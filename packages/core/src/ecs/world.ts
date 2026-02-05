/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRInputManager, XROrigin } from '@iwsdk/xr-input';
import type { PointerEventsMap } from '@pmndrs/pointer-events';
import { Signal, signal } from '@preact/signals-core';
import { AnyComponent, World as ElicsWorld } from 'elics';
import { AssetManager } from '../asset/index.js';
// Environment is driven by components/systems; no world helpers
import {
  WorldOptions,
  initializeWorld,
  XROptions,
  launchXR,
} from '../init/index.js';
import { LevelTag } from '../level/index.js';
import {
  type IPresenter,
  type PresentationMode,
  type PresenterConfig,
} from '../presenter/index.js';
import type { Object3DEventMap } from '../runtime/index.js';
import {
  Material,
  Object3D,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from '../runtime/index.js';
import { Transform } from '../transform/index.js';
import { Entity } from './entity.js';

export enum VisibilityState {
  NonImmersive = 'non-immersive',
  Hidden = 'hidden',
  Visible = 'visible',
  VisibleBlurred = 'visible-blurred',
}

/**
 * Constructor type for World and its subclasses.
 *
 * Used by initializeWorld to create instances of World or GISWorld.
 *
 * @category Runtime
 */
export type WorldConstructor<T extends World = World> = new (
  entityCapacity: number,
  checksOn?: boolean,
) => T;

export type GradientColors = {
  sky: number;
  equator: number;
  ground: number;
};

/**
 * World is the root ECS container, Three.js scene/renderer owner, and XR session gateway.
 *
 * @remarks
 * - Construct a world with {@link World.create} (recommended) which wires the renderer, scene, default systems
 *   (Input, UI, Audio, Level) and starts the render loop.
 * - The world exposes convenience handles like {@link World.input | input} (XRInputManager),
 *   {@link World.player | player} (XROrigin), and {@link World.assetManager}.
 * - Feature systems (Grabbing, Locomotion) are opt‑in via {@link WorldOptions.features}.
 *
 * @category Runtime
 * @example
 * ```ts
 * import { World, SessionMode } from '@iwsdk/core';
 *
 * const container = document.getElementById('scene-container') as HTMLDivElement;
 * const world = await World.create(container, {
 *   xr: { sessionMode: SessionMode.ImmersiveVR },
 *   features: { enableLocomotion: true, enableGrabbing: true },
 *   level: '/glxf/Composition.glxf'
 * });
 * ```
 */
export class World extends ElicsWorld {
  public input!: XRInputManager;
  public player!: XROrigin;
  public assetManager!: typeof AssetManager;
  public scene!: Scene;
  public sceneEntity!: Entity;
  public activeLevel!: Signal<Entity>;
  public activeLevelId: string = 'level:default';
  public camera!: PerspectiveCamera;
  public renderer!: WebGLRenderer;
  public session: XRSession | undefined;
  public visibilityState = signal(VisibilityState.NonImmersive);
  public requestedLevelUrl: string | undefined;
  public _resolveLevelLoad: (() => void) | undefined;
  /** Default XR options used when calling {@link World.launchXR} without overrides. */
  public xrDefaults: import('../init/xr.js').XROptions | undefined;
  public onSetPresenter: any;
  // ============================================================================
  // PRESENTER ABSTRACTION
  // ============================================================================

  /**
   * The active presenter (if using presenter mode).
   * When a presenter is active, scene/camera/renderer proxy through it.
   * @internal
   */
  private _presenter: IPresenter | undefined;

  /**
   * Container element (stored for mode switching)
   * @internal
   */
  private _container: HTMLDivElement | undefined;

  /**
   * Presenter configuration (stored for mode switching)
   * @internal
   */
  private _presenterConfig: PresenterConfig | undefined;

  /**
   * Get the active presenter (if any).
   *
   * When using presenter mode, this returns the current presenter instance.
   * In legacy XR-only mode, this returns undefined.
   */
  get presenter(): IPresenter | undefined {
    return this._presenter;
  }

  /**
   * Get the current presentation mode.
   *
   * Returns undefined if not using presenter mode (legacy XR-only).
   */
  get presentationMode(): PresentationMode | undefined {
    return this._presenter?.mode;
  }

  /**
   * Set the presenter for this world.
   *
   * This is typically called by the world initializer when presenter mode is enabled.
   * @internal
   */
  setPresenter(presenter: IPresenter, container: HTMLDivElement, config?: PresenterConfig): void {
    this._presenter = presenter;
    this._container = container;
    this._presenterConfig = config;
   
//    presenter.setWorld(this);
    if(this.onSetPresenter)
    {
      this.onSetPresenter(this, presenter, config);
    }
    presenter.setWorld(this);
  }

  constructor(entityCapacity: number, checksOn: boolean = false) {
    super({ entityCapacity, checksOn });
    const originalReleaseFunc = this.entityManager.releaseEntityInstance.bind(
      this.entityManager,
    );
    this.entityManager.releaseEntityInstance = (entity: Entity) => {
      originalReleaseFunc(entity);
      const obj = entity.object3D;
      if (obj) {
        // Check if entity was marked for resource disposal
        if ((entity as any)._disposeResources) {
          this.disposeObject3DResources(obj);
          delete (entity as any)._disposeResources;
        }
        obj.removeFromParent();
        delete entity.object3D;
      }
    };
  }

  /**
   * Dispose of an Object3D's GPU resources (geometry, materials, textures).
   * Traverses all descendants and cleans up disposable resources.
   *
   * @remarks
   * This is called automatically when an entity is destroyed with `disposeResources: true`.
   * Use with caution when resources may be shared across multiple entities.
   */
  private disposeObject3DResources(object: Object3D): void {
    object.traverse((child: any) => {
      // Dispose geometry
      if (child.geometry) {
        child.geometry.dispose();
      }

      // Dispose materials (can be single or array)
      if (child.material) {
        const materials: Material[] = Array.isArray(child.material)
          ? child.material
          : [child.material];

        for (const material of materials) {
          // Dispose textures attached to the material
          for (const key of Object.keys(material)) {
            const value = (material as any)[key];
            if (value && typeof value.dispose === 'function') {
              // Check if it's a texture (has isTexture property)
              if (value.isTexture) {
                value.dispose();
              }
            }
          }
          material.dispose();
        }
      }
    });
  }

  createEntity(): Entity {
    return super.createEntity() as Entity;
  }

  createTransformEntity(
    object?: Object3D,
    parentOrOptions?: Entity | { parent?: Entity; persistent?: boolean },
  ): Entity {
    const entity = super.createEntity() as Entity;
    const obj = object ?? new Object3D();
    // Cast to pointer-events-capable Object3D event map for downstream typing
    entity.object3D = obj as unknown as Object3D<
      Object3DEventMap & PointerEventsMap
    >;

    let parent: Entity | undefined = undefined;
    let persistent = false;

    if (parentOrOptions) {
      if (typeof (parentOrOptions as any).index === 'number') {
        parent = parentOrOptions as Entity;
      } else {
        const opts = parentOrOptions as {
          parent?: Entity;
          persistent?: boolean;
        };
        parent = opts.parent;
        persistent = !!opts.persistent;
      }
    }

    if (!parent) {
      // Avoid self-parenting for the Scene root
      const isSceneObject = (obj: Object3D) => (obj as any).isScene === true;
      if (object && isSceneObject(object)) {
        parent = undefined;
        persistent = true;
      } else {
        parent = persistent
          ? this.sceneEntity
          : (this.activeLevel?.value ?? this.sceneEntity);
      }
    }

    entity.addComponent(Transform, { parent });

    // Tag entity with current level, unless persistent
    if (!persistent) {
      entity.addComponent(LevelTag, { id: this.activeLevelId });
    }
    return entity;
  }

  launchXR(xrOptions?: Partial<XROptions>) {
    launchXR(this, xrOptions);
  }

  /** Request a level change; LevelSystem performs the work and resolves. */
  async loadLevel(url?: string): Promise<void> {
    this.requestedLevelUrl = url ?? '';
    return new Promise<void>((resolve) => {
      this._resolveLevelLoad = resolve;
    });
  }

  exitXR() {
    this.session?.end();
  }

  update(delta: number, time: number): void {
    super.update(delta, time);
  }

  registerComponent(component: AnyComponent): this {
    return super.registerComponent(component);
  }

  // Level root helpers
  getActiveRoot(): Object3D {
    return this.activeLevel?.value?.object3D ?? this.scene;
  }

  getPersistentRoot(): Object3D {
    return this.scene;
  }

  // ============================================================================
  // PRESENTER MODE METHODS
  // ============================================================================

  /**
   * Get the content root for GIS/application content.
   *
   * When using presenter mode, returns the presenter's content root.
   * Otherwise returns the active level root.
   */
  getContentRoot(): Object3D {
    if (this._presenter) {
      return this._presenter.getContentRoot();
    }
    return this.getActiveRoot();
  }

  /**
   * Launch a specific presentation mode.
   *
   * This is an alternative to launchXR() that supports all presentation modes
   * including Map mode. Requires presenter mode to be enabled.
   *
   * @param mode - The presentation mode to launch
   * @param options - Mode-specific options
   *
   * @example
   * ```ts
   * // Launch AR mode
   * await world.launch(PresentationMode.ImmersiveAR);
   *
   * // Launch Map mode
   * await world.launch(PresentationMode.Map);
   * ```
   */
  async launch(mode: PresentationMode, options?: Partial<PresenterConfig>): Promise<void> {
    if (!this._presenter) {
      throw new Error(
        'Presenter mode not enabled. Use WorldOptions.presentation to enable presenter mode.',
      );
    }

    // If mode differs, switch to it
    if (mode !== this._presenter.mode) {
      await this.switchMode(mode, options);
    }

    // Start the presenter
   //  await this._presenter.start(); // already done in setupRenderLoop()

    // For XR modes, request a session
    if (mode === 'immersive-ar' || mode === 'immersive-vr') {
      const xrPresenter = this._presenter as any;
      if (xrPresenter.requestSession) {
        this.session = await xrPresenter.requestSession(options);
        this.visibilityState.value = VisibilityState.Visible;
      }
    }
  }

  /**
   * Switch to a different presentation mode at runtime.
   *
   * Objects in the content root are preserved across mode switches.
   * Requires presenter mode to be enabled.
   *
   * @param mode - The new presentation mode
   * @param options - Mode-specific options
   *
   * @example
   * ```ts
   * // Switch from Map to AR
   * await world.switchMode(PresentationMode.ImmersiveAR);
   * ```
   */
  async switchMode(mode: PresentationMode, options?: Partial<PresenterConfig>): Promise<void> {
    if (!this._presenter || !this._container) {
      throw new Error(
        'Presenter mode not enabled. Use WorldOptions.presentation to enable presenter mode.',
      );
    }

    if (mode === this._presenter.mode) {
      return;
    }

    // Dynamically import presenter factory to avoid circular dependency
    const { createPresenter } = await import('../presenter/index.js');

    // Collect objects from current content root
    const contentRoot = this._presenter.getContentRoot();
    const objects: Object3D[] = [];
    while (contentRoot.children.length > 0) {
      const child = contentRoot.children[0];
      contentRoot.remove(child);
      objects.push(child);
    }

    // Stop current presenter
    await this._presenter.stop();

    // Create new presenter
    const config = { ...this._presenterConfig, ...options };
    this._presenter = createPresenter(mode, config);
    await this._presenter.initialize(this._container, config as PresenterConfig);

    // Update world references to use new presenter
    this.scene = this._presenter.scene;
    this.camera = this._presenter.camera;
    this.renderer = this._presenter.renderer;

    // Restore objects to new content root
    for (const obj of objects) {
      this._presenter.addObject(obj, { isENU: true });
    }

    // Re-setup XR input if needed
    if (mode === 'immersive-ar' || mode === 'immersive-vr') {
      this._setupXRInputForPresenter();
    }

    // Start the new presenter
    // Note: When switching modes, the render loop is already managed by the world
    // The presenter.start() receives null here as the loop continues from the previous state
    await this._presenter.start(null);
  }

  /**
   * Setup XR input management for presenter mode.
   * @internal
   */
  private _setupXRInputForPresenter(): void {
    if (!this.input) {
      this.input = new XRInputManager({
        camera: this.camera,
        scene: this.scene,
        assetLoader: AssetManager,
      });
    }
    this.scene.add(this.input.xrOrigin);
    this.input.xrOrigin.add(this.camera);
    this.player = this.input.xrOrigin;
  }

  /**
   * Initialize a new WebXR world with all required systems and setup
   *
   * @param sceneContainer - HTML container for the renderer canvas
   * @param assets - Asset manifest for preloading
   * @param options - Configuration options for the world
   * @returns Promise that resolves to the initialized World instance
   */
  /**
   * Initialize a new WebXR world with renderer, scene, default systems, and optional level.
   *
   * @param container HTML container to which the renderer canvas will be appended.
   * @param options Runtime configuration, see {@link WorldOptions}.
   * @returns A promise that resolves to the initialized {@link World}.
   *
   * @remarks
   * - This call enables the Input, UI and Audio systems by default.
   * - Use {@link WorldOptions.features} to enable Locomotion or Grabbing.
   * - If {@link WorldOptions.level} is provided, the LevelSystem will load it after assets are preloaded.
   * @see /getting-started/01-hello-xr
   */
  static create(
    container: HTMLDivElement,
    options?: WorldOptions,
  ): Promise<World> {
    return initializeWorld(container, options);
  }
}
