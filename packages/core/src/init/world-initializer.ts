/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { XRInputManager } from '@iwsdk/xr-input';
import { AssetManager, AssetManifest } from '../asset/index.js';
import { AudioSource, AudioSystem } from '../audio/index.js';
import { CameraSource, CameraSystem } from '../camera/index.js';
import { World, VisibilityState, type WorldConstructor } from '../ecs/index.js';
import {
  DomeTexture,
  DomeGradient,
  IBLTexture,
  IBLGradient,
  EnvironmentSystem,
} from '../environment/index.js';
import {
  EnvironmentRaycastSystem,
  EnvironmentRaycastTarget,
} from '../environment-raycast/index.js';
import { GrabSystem } from '../grab/index.js';
import { Interactable, Hovered, Pressed } from '../grab/index.js';
import { InputSystem } from '../input/index.js';
import { LevelTag, LevelRoot } from '../level/index.js';
import { LevelSystem } from '../level/index.js';
import { LocomotionSystem } from '../locomotion/index.js';
import {
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsSystem,
} from '../physics/index.js';
import {
  PresentationMode,
  PresenterConfig,
  isGISPresenter,
  IPresenter,
} from '../presenter/index.js';
import { XRPresenter } from '../presenter/xr-presenter.js';
import { Clock, WebGLRenderer } from '../runtime/index.js';
import {
  SceneUnderstandingSystem,
  XRAnchor,
  XRMesh,
  XRPlane,
} from '../scene-understanding/index.js';
import { Transform, TransformSystem } from '../transform/index.js';
import {
  FollowSystem,
  Follower,
  ScreenSpace,
  ScreenSpaceUISystem,
  PanelUI,
  PanelUISystem,
  ColorScheme,
} from '../ui/index.js';
import { Visibility, VisibilitySystem } from '../visibility/index.js';
import {
  ReferenceSpaceType,
  SessionMode,
  XROptions,
  normalizeReferenceSpec,
  resolveReferenceSpaceType,
  buildSessionInit,
} from './index.js';
import { IGISPresenter } from '../presenter/gis-presenter.js';

/** Options for {@link initializeWorld} / {@link World.create}.
 *
 * @category Runtime
 * @remarks
 * Defaults are tuned for VR; you can override camera frustum and default lighting via {@link WorldOptions.render}.
 */
export type WorldOptions = {
  presenter?: {mode?: PresentationMode,
              options?: PresenterConfig
  },
  /** Asset manifest to preload before the first frame. */
  assets?: AssetManifest;
  /** Size of preallocated Elics-ECS  ComponentStorage */
  entityCapacity?: Number;
  /** Enables runtime validations for debugging purposes (default is true). It's recommended to disable checks in production for better performance. */
  checksOn?: Boolean;
  /** Level to load after initialization. Accepts a GLXF URL string or an object with a `url` field. */
  level?: { url?: string } | string;

  /** XR session options and offer behavior. */
  xr?: XROptions & { offer?: 'none' | 'once' | 'always' };

  /** Renderer & camera configuration. */
  render?: {
    /** Camera field of view in degrees. @defaultValue 50 */
    fov?: number;
    /** Near clipping plane. @defaultValue 0.1 */
    near?: number;
    /** Far clipping plane. @defaultValue 200 */
    far?: number;
    /** Generate a default gradient environment and background. @defaultValue true */
    defaultLighting?: boolean;
    /** Enable stencil buffer. @defaultValue false */
    stencil?: boolean;
  };

  /** Opt‑in feature systems. */
  features?: {
    /** Locomotion (teleport/slide/turn). Boolean or config. @defaultValue false */
    locomotion?: boolean | { useWorker?: boolean };
    /** Grabbing (one/two‑hand, distance). @defaultValue false */
    grabbing?: boolean | { useHandPinchForGrab?: boolean };
    /** Physics simulation (Havok). @defaultValue false */
    physics?: boolean;
    /** Scene Understanding (planes/meshes/anchors). Boolean or config. @defaultValue false */
    sceneUnderstanding?: boolean | { showWireFrame?: boolean };
    /** Environment Raycast (hit-test against real-world surfaces). @defaultValue false */
    environmentRaycast?: boolean;
    /** Camera access for video streaming. @defaultValue false */
    camera?: boolean;
    /** Spatial UI systems (PanelUI/ScreenSpace/Follow). Boolean or config. @defaultValue true */
    spatialUI?:
      | boolean
      | {
          forwardHtmlEvents?: boolean;
          kits?: Array<Record<string, unknown>> | Record<string, unknown>;
          preferredColorScheme?: ColorScheme;
        };
  };
};

/**
 * Initialize a new WebXR world with all required systems and setup
 *
 * @param sceneContainer - HTML container for the renderer canvas
 * @param assets - Asset manifest for preloading
 * @param options - Configuration options for the world
 * @returns Promise that resolves to the initialized World instance
 */
/**
 * Initialize a new WebXR world with all required systems and setup.
 *
 * @param sceneContainer HTML container for the renderer canvas.
 * @param options Configuration options for the world.
 * @param WorldClass Optional World constructor to use (defaults to World, can be GISWorld).
 * @returns Promise that resolves to the initialized {@link World} instance.
 *
 * @remarks
 * This function powers {@link World.create}. Prefer using that static helper.
 */
export async function initializeWorld<T extends World = World>(
  container: HTMLDivElement,
  options: WorldOptions = {},
  WorldClass?: WorldConstructor<T>,
): Promise<T> {
  // Create and configure world instance
  const world = createWorldInstance(options.entityCapacity, options.checksOn, WorldClass) as T;

  // Extract configuration options
  const config = extractConfiguration(options);

  const initImpl = (world: World,
                   config: ReturnType<typeof extractConfiguration>,
                    presenter: IPresenter) => {

      // Store XR defaults for later explicit launch/offer calls
      world.xrDefaults = {
        sessionMode: config.xr.sessionMode,
        referenceSpace: config.xr.referenceSpace,
        features: config.xr.features,
      };

      // Register core systems (LevelSystem receives defaultLighting)
      registerCoreSystems(world, config);

      // Initialize asset manager
      initializeAssetManager(world.renderer, world);

      // Register additional systems (UI + Audio on by default)
      registerAdditionalSystems(world);

      // Register input and feature systems with explicit priorities
      registerFeatureSystems(world, config);

      // Setup render loop (integrates presenter hooks with World update)
      setupRenderLoop(world, presenter);

      // Note: Resize handling is now managed by the presenter

      // Manage XR offer flow if configured
      if (config.xr.offer && config.xr.offer !== 'none') {
        manageOfferFlow(world, config.xr.offer);  // requires world.xrDefaults
      }
  };

  // if presenter mode is known, create one
  if(options?.presenter)
  {

    // Create and initialize presenter based on session mode
    const presenter = createPresenter(config); // TODO use createPresenter(mode: PresentationMode,_options?: PresenterConfig,)
    const presenterConfig = buildPresenterConfig(config);
    await presenter.initialize(container, presenterConfig);

    // Get rendering components from presenter and assign to world
    assignRenderingToWorld(world, presenter, container, presenterConfig);

    // Setup input management (uses world.camera and world.scene from presenter)
    setupInputManagement(world); 
    initImpl(world, config, presenter);
    // Return promise that resolves after asset preloading
     return finalizeInitialization<T>(world, options.assets).then(async (w) => {
       // Load initial level or create empty level
       const levelUrl =
         typeof options.level === 'string' ? options.level : options.level?.url;
       if (levelUrl) {
         await w.loadLevel(levelUrl);
       } else {
         await w.loadLevel();
       }
       return w;
     });
  } else {
    // otherwise defer complete world initialization until user calls world.setPresenter(pr)
    // NOTE could save world parameter by binding to 'this'
    world.onSetPresenter = (world: World, presenter: IPresenter, pconfig: PresenterConfig ) => 
      {
      // Get rendering components from presenter and assign to world
      assignRenderingToWorld(world, presenter, container, pconfig);

      // Setup input management (uses world.camera and world.scene from presenter)
      setupInputManagement(world);

      // TODO ... 
      const config = extractConfiguration(options);
      initImpl(world, config, presenter);

      if(isGISPresenter(presenter))
      { // only call this now, once LevelSystem is initialized and ActiveLevelRoot exists
        (presenter as IGISPresenter).initGISRoot(world);
      }

      return world;
    };
    return world;
  }


  
}

/**
 * Create a new World instance with basic ECS setup
 */
function createWorldInstance<T extends World = World>(
  entityCapacity: Number | undefined,
  checksOn: Boolean | undefined,
  WorldClass?: WorldConstructor<T>,
): T {
  const Constructor = WorldClass ?? World;
  const world = new Constructor(
    (entityCapacity ?? 1024) as number,
    (checksOn ?? false) as boolean,
  ) as T;
  world
    .registerComponent(Transform)
    .registerComponent(Visibility)
    .registerComponent(LevelTag); // required by LevelSystem
    world.registerSystem(TransformSystem)
    .registerSystem(VisibilitySystem);
  return world;
}

/**
 * Extract and normalize configuration options
 */
function extractConfiguration(options: WorldOptions) {
  return {
    cameraFov: options.render?.fov ?? 50,
    cameraNear: options.render?.near ?? 0.1,
    cameraFar: options.render?.far ?? 200,
    defaultLighting: options.render?.defaultLighting ?? true,
    stencil: options.render?.stencil ?? false,
    xr: {
      sessionMode: options.xr?.sessionMode ?? SessionMode.ImmersiveVR,
      referenceSpace:
        options.xr?.referenceSpace ?? ReferenceSpaceType.LocalFloor,
      features: options.xr?.features,
      offer: options.xr?.offer ?? 'always',
    },
    features: {
      locomotion: options.features?.locomotion ?? false,
      grabbing: options.features?.grabbing ?? false,
      physics: options.features?.physics ?? false,
      sceneUnderstanding: options.features?.sceneUnderstanding ?? false,
      environmentRaycast: options.features?.environmentRaycast ?? false,
      camera: options.features?.camera ?? false,
      spatialUI: options.features?.spatialUI ?? true,
    },
  } as const;
}

/**
 * Create the appropriate presenter based on session mode
 */
function createPresenter(
  config: ReturnType<typeof extractConfiguration>,
): IPresenter {
  // Determine presentation mode from XR session mode
  const mode =
    config.xr.sessionMode === SessionMode.ImmersiveAR
      ? PresentationMode.ImmersiveAR
      : PresentationMode.ImmersiveVR;

  return new XRPresenter(mode);
}

/**
 * Build presenter configuration from world options
 */
function buildPresenterConfig(
  config: ReturnType<typeof extractConfiguration>,
): PresenterConfig & { fov?: number; near?: number; far?: number } {
  return {
    fov: config.cameraFov,
    near: config.cameraNear,
    far: config.cameraFar,
  };
}

/**
 * Assign rendering components from presenter to world instance
 * @note presenter must be initialized! i.e. have scene, renderer constructed
 */
function assignRenderingToWorld(
  world: World,
  presenter: IPresenter,
  container: HTMLDivElement,
  presenterConfig: PresenterConfig,
) {
  // REDUNDANT with setPresenter() implementation
  // Get rendering components from presenter
  world.scene = presenter.scene;
  world.camera = presenter.camera;
  world.renderer = presenter.renderer;

    // Scene entity (wrap Scene in an entity for parenting convenience) required by LevelSystem
  world.sceneEntity = world.createTransformEntity(presenter.scene);

  // Create a default level root so activeLevel is always defined
  // REDUNDANT with LevelSystem::init()
  /*
  const levelRootEntity = world.createTransformEntity(undefined, {
    parent: world.sceneEntity,
  });
  levelRootEntity.object3D!.name = 'LevelRoot';
  // @ts-ignore init signal now; LevelSystem will enforce identity each frame
  world.activeLevel = signal(levelRootEntity);
  */

  if(!world?.presenter)
  { // Register presenter with world (this also initializes GIS root if applicable)
    world.setPresenter(presenter, container, presenterConfig);
  }

}

/**
 * Setup default lighting environment using Unity-style gradient ambient lighting
 */
// default lighting is attached per level by LevelSystem

/**
 * Setup XR input management
 * @note requires world has camera, scene.
 * Generally world.setPresenter() [actually assignRenderingToWorld] must have been called first
 */
function setupInputManagement(world: World): XRInputManager {
  const inputManager = new XRInputManager({
    camera: world.camera,
    scene: world.scene,
    assetLoader: AssetManager,
  });
  world.scene.add(inputManager.xrOrigin);
  inputManager.xrOrigin.add(world.camera);
  world.player = inputManager.xrOrigin;
  world.input = inputManager;

  return inputManager;
}

/**
 * Manage offering XR sessions according to the configured offer policy.
 * - 'once': offer after init; no re-offer on end
 * - 'always': offer after init and re-offer whenever the session ends
 */
function manageOfferFlow(world: World, mode: 'once' | 'always') {
  let offering = false;
  const offer = async () => {
    if (offering || world.session) {
      return;
    }
    offering = true;
    try {
      const opts = world.xrDefaults ?? { sessionMode: SessionMode.ImmersiveVR };
      const sessionInit = buildSessionInit(opts as XROptions);

      const session = await navigator.xr?.offerSession?.(
        opts.sessionMode ?? SessionMode.ImmersiveVR,
        // if the dynamic import failed, rebuild via launchXR path by calling request, but we only want offer
        sessionInit as XRSessionInit,
      );
      if (!session) {
        return;
      }

      const refSpec = normalizeReferenceSpec(opts.referenceSpace);
      session.addEventListener('end', onEnd);
      try {
        const resolvedType = await resolveReferenceSpaceType(
          session,
          refSpec.type,
          refSpec.required ? [] : refSpec.fallbackOrder,
        );
        world.renderer.xr.setReferenceSpaceType(
          resolvedType as unknown as XRReferenceSpaceType,
        );
        await world.renderer.xr.setSession(session);
        world.session = session;
      } catch (err) {
        console.error('[XR] Failed to acquire reference space:', err);
        try {
          await session.end();
        } catch {}
      }
    } finally {
      offering = false;
    }
  };

  const onEnd = () => {
    world.session?.removeEventListener('end', onEnd);
    world.session = undefined;
    if (mode === 'always') {
      // re-offer after session ends
      offer();
    }
  };

  // initial offer once world is ready
  offer();
}

/**
 * Register core interaction systems
 */
function registerCoreSystems(
  world: World,
  config: ReturnType<typeof extractConfiguration>,
) {
  world
    .registerComponent(Interactable)
    .registerComponent(Hovered)
    .registerComponent(Pressed)
    .registerComponent(LevelRoot)
    // New split components
    .registerComponent(DomeTexture)
    .registerComponent(DomeGradient)
    .registerComponent(IBLTexture)
    .registerComponent(IBLGradient);
    // Unified environment system (background + IBL)
    world.registerSystem(EnvironmentSystem); // requires world.renderer
    world.registerSystem(LevelSystem, { // requires sceneEntity -> creates ActiveLevelRoot child -> init() must be called before presenter initGISRoot
      configData: { defaultLighting: config.defaultLighting },
    });
}

/**
 * Initialize the asset manager
 */
function initializeAssetManager(renderer: WebGLRenderer, world: World) {
  AssetManager.init(renderer, world);
}

/**
 * Register optional systems based on configuration
 */
function registerAdditionalSystems(world: World) {
  // Audio system remains always-on
  world.registerComponent(AudioSource).registerSystem(AudioSystem);
}

function registerFeatureSystems(
  world: World,
  config: ReturnType<typeof extractConfiguration>,
) {
  const locomotion = config.features.locomotion as
    | boolean
    | { useWorker?: boolean };
  const locomotionEnabled = !!locomotion;
  const grabbing = config.features.grabbing as
    | boolean
    | { useHandPinchForGrab?: boolean };
  const grabbingEnabled = !!grabbing;
  const physicsEnabled = !!config.features.physics;
  const sceneUnderstanding = config.features.sceneUnderstanding as
    | boolean
    | { showWireFrame?: boolean };
  const sceneUnderstandingEnabled = !!sceneUnderstanding;
  const environmentRaycastEnabled = !!config.features.environmentRaycast;
  const cameraEnabled = !!config.features.camera;
  const spatialUI = config.features.spatialUI as
    | boolean
    | {
        forwardHtmlEvents?: boolean;
        kits?: any;
        preferredColorScheme?: ColorScheme;
      };
  const spatialUIEnabled = !!spatialUI;

  if (locomotionEnabled) {
    const locOpts =
      typeof locomotion === 'object' && locomotion
        ? { useWorker: locomotion.useWorker }
        : undefined;
    world.registerSystem(LocomotionSystem, {
      priority: -5,
      configData: locOpts,
    });
  }
  world.registerSystem(InputSystem, { priority: -4 });
  if (grabbingEnabled) {
    const grabOpts =
      typeof grabbing === 'object' && grabbing
        ? { useHandPinchForGrab: grabbing.useHandPinchForGrab }
        : undefined;
    world.registerSystem(GrabSystem, { priority: -3, configData: grabOpts });
  }

  // Physics runs after Grab so it can respect Pressed overrides
  if (physicsEnabled) {
    world
      .registerComponent(PhysicsBody)
      .registerComponent(PhysicsShape)
      .registerComponent(PhysicsManipulation)
      .registerSystem(PhysicsSystem, { priority: -2 });
  }

  // Scene Understanding updates plane/mesh/anchor debug after input/physics
  if (sceneUnderstandingEnabled) {
    const sceneOpts =
      typeof sceneUnderstanding === 'object' && sceneUnderstanding
        ? { showWireFrame: sceneUnderstanding.showWireFrame }
        : undefined;
    world
      .registerComponent(XRPlane)
      .registerComponent(XRMesh)
      .registerComponent(XRAnchor)
      .registerSystem(SceneUnderstandingSystem, {
        priority: -1,
        configData: sceneOpts,
      });
  }

  // Environment Raycast system - requires hit-test feature
  if (environmentRaycastEnabled) {
    world
      .registerComponent(EnvironmentRaycastTarget)
      .registerSystem(EnvironmentRaycastSystem, {
        priority: -1,
      });
  }

  // Camera system for video streaming
  if (cameraEnabled) {
    world.registerComponent(CameraSource).registerSystem(CameraSystem);
  }

  // Spatial UI systems (Panel, ScreenSpace, Follow)
  if (spatialUIEnabled) {
    const forwardHtmlEvents =
      typeof spatialUI === 'object' && spatialUI
        ? spatialUI.forwardHtmlEvents
        : undefined;
    const kitsVal =
      typeof spatialUI === 'object' && spatialUI ? spatialUI.kits : undefined;
    const kitsObj = Array.isArray(kitsVal)
      ? Object.assign({}, ...(kitsVal as Array<Record<string, unknown>>))
      : kitsVal;
    const preferredColorScheme =
      typeof spatialUI === 'object' && spatialUI
        ? spatialUI.preferredColorScheme
        : undefined;

    world
      .registerComponent(PanelUI)
      .registerComponent(ScreenSpace)
      .registerComponent(Follower)
      .registerSystem(PanelUISystem, {
        configData: {
          ...(forwardHtmlEvents !== undefined ? { forwardHtmlEvents } : {}),
          ...(kitsObj ? { kits: kitsObj } : {}),
          ...(preferredColorScheme !== undefined
            ? { preferredColorScheme }
            : {}),
        },
      })
      .registerSystem(ScreenSpaceUISystem)
      .registerSystem(FollowSystem);
  }
}

/**
 * Setup the main render loop
 *
 * The render loop integrates the presenter's lifecycle hooks with
 * the World's ECS update cycle:
 * 1. presenter.preUpdate() - Before ECS systems run
 * 2. world.update() - Run all ECS systems
 * 3. presenter.postUpdate() - After ECS systems complete
 * 4. presenter.render() - Perform the actual render
 */
function setupRenderLoop(world: World, presenter: IPresenter) {
  const clock = new Clock();

  const render = () => {
    const delta = clock.getDelta();
    const elapsedTime = clock.elapsedTime;

    // Update visibility state from XR session
    world.visibilityState.value = (world.session?.visibilityState ??
      VisibilityState.NonImmersive) as VisibilityState;

    // Presenter pre-update hook (before ECS systems)
    presenter.preUpdate(delta, elapsedTime);

    // Run ECS systems in priority order (InputSystem => LocomotionSystem => GrabSystem)
    world.update(delta, elapsedTime);

    // Presenter post-update hook (after ECS systems)
    presenter.postUpdate(delta, elapsedTime);

    // Delegate rendering to presenter
    presenter.render();
  };

  // Use the presenter's renderer to set the animation loop
  // presenter.renderer.setAnimationLoop(render);
  presenter.start(render);

  // No explicit sessionend handling required on r177; WebXRManager handles
  // render target and canvas sizing restoration internally.
}

// Note: setupResizeHandling has been removed - the presenter now handles resize events

/**
 * Finalize initialization with asset preloading
 */
function finalizeInitialization<T extends World = World>(
  world: T,
  assets?: AssetManifest,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (!assets || Object.keys(assets).length === 0) {
      return resolve(world);
    }
    AssetManager.preloadAssets(assets)
      .then(() => resolve(world))
      .catch(reject);
  });
}
