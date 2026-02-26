---
name: iwsdk-planner
description: IWSDK project planning and best practices guide. Use when planning new IWSDK features, designing systems/components, reviewing IWSDK code architecture, or when the user asks about IWSDK patterns, ECS design, signals, or reactive programming in this codebase.
---

# IWSDK Project Planner

You are an expert IWSDK (Immersive Web SDK) architect. Apply these patterns and best practices when planning, implementing, or reviewing IWSDK code.

## Core Architecture

IWSDK is built on three pillars:
1. **ECS (Entity Component System)** via `elics` library
2. **Reactive Signals** via `@preact/signals-core`
3. **Three.js Integration** with zero-copy transform binding (super-three v0.177.0)

## Critical Best Practices

### 1. Keep Systems Stateless

Systems should NOT store arrays of entities or maintain entity references. Use queries instead.

```typescript
// ❌ BAD - Storing entity references
export class BadSystem extends createSystem({ items: { required: [MyComponent] } }) {
  private myEntities: Entity[] = [];  // DON'T DO THIS

  init() {
    this.queries.items.subscribe('qualify', (entity) => {
      this.myEntities.push(entity);  // BAD: manually tracking entities
    });
  }
}

// ✅ GOOD - Use queries for entity access
export class GoodSystem extends createSystem({ items: { required: [MyComponent] } }) {
  update() {
    // Query always gives current matching entities
    for (const entity of this.queries.items.entities) {
      // Process entity
    }
  }
}
```

**Exception:** Scratch variables for temporary per-frame calculations are OK.

### 2. Use Query Subscribe/Unsubscribe for Reactive Programming

Instead of polling or storing state, react to entity lifecycle events:

```typescript
export class ReactiveSystem extends createSystem({
  interactables: { required: [Interactable, Transform] }
}) {
  init() {
    // React when entities enter the query
    this.queries.interactables.subscribe('qualify', (entity) => {
      this.setupEventListeners(entity);
    });

    // React when entities leave the query
    this.queries.interactables.subscribe('disqualify', (entity) => {
      this.cleanupEventListeners(entity);
    });
  }
}
```

### 3. Use Signals for Reactive State

IWSDK uses `@preact/signals-core`. Prefer signals over manual state tracking:

```typescript
// System config properties are automatically signals
export class MySystem extends createSystem(
  {},
  {
    speed: { type: Types.Float32, default: 5.0 },
    jumpHeight: { type: Types.Float32, default: 2.0 }
  }
) {
  init() {
    // Subscribe to config changes reactively
    this.cleanupFuncs.push(
      this.config.speed.subscribe((newSpeed) => {
        console.log('Speed changed:', newSpeed);
      })
    );
  }

  update(delta) {
    // Read signal value with .value
    const currentSpeed = this.config.speed.value;
  }
}
```

### World Globals Signals for Cross-System Communication

Store signals in `world.globals` for state that multiple systems need to read/write:

```typescript
// In index.ts (initialization)
import { signal } from '@preact/signals-core';

(world.globals as Record<string, unknown>).gamePaused = signal(true);
(world.globals as Record<string, unknown>).audioMasterVolume = signal(1.0);

// In any system (reading with peek() in hot paths)
const gamePaused = (this.globals.gamePaused as Signal<boolean>).peek();

// In any system (writing)
const gamePausedSignal = this.globals.gamePaused as Signal<boolean>;
gamePausedSignal.value = !gamePausedSignal.value;
```

### 4. Component Types (Complete List)

```typescript
import { Types } from '@iwsdk/core';

Types.Float32   // 32-bit float
Types.Float64   // 64-bit float (for physics engine refs)
Types.Int8      // 8-bit signed integer
Types.Int16     // 16-bit signed integer
Types.Int32     // 32-bit signed integer
Types.Uint32    // 32-bit unsigned integer
Types.Boolean   // true/false
Types.String    // text
Types.Vec3      // [x, y, z] - 3 floats
Types.Vec4      // [x, y, z, w] - 4 floats (quaternions)
Types.Color     // [r, g, b, a] - 4 floats (RGBA)
Types.Entity    // Reference to another entity
Types.Enum      // Enumerated value
Types.Object    // Any JS object (avoid if possible - not optimized)
```

### 5. Component Design Patterns

```typescript
import { createComponent, Types } from '@iwsdk/core';

// Tag component (no data, just marks entities)
export const Interactable = createComponent('Interactable', {}, '');

// Data component with proper types
export const Health = createComponent('Health', {
  current: { type: Types.Float32, default: 100 },
  max: { type: Types.Float32, default: 100 }
});

// With enums
export const State = createComponent('State', {
  mode: {
    type: Types.Enum,
    enum: { Idle: 'idle', Moving: 'moving', Attacking: 'attacking' },
    default: 'idle'
  }
});

// With vectors (stored as TypedArrays for performance)
export const Velocity = createComponent('Velocity', {
  linear: { type: Types.Vec3, default: [0, 0, 0] },
  angular: { type: Types.Vec3, default: [0, 0, 0] }
});

// With colors (RGBA, 4 components)
export const Tint = createComponent('Tint', {
  color: { type: Types.Color, default: [1, 1, 1, 1] }
});
```

### 6. Query Patterns with Filters

```typescript
export class DamageSystem extends createSystem({
  // Basic query
  enemies: { required: [Enemy] },

  // With exclusions
  vulnerableEnemies: {
    required: [Enemy, Health],
    excluded: [Invulnerable, Shield]
  },

  // With value filters
  lowHealth: {
    required: [Health],
    where: [lt(Health, 'current', 20)]
  },

  // Complex filters
  activeBosses: {
    required: [Boss, Health],
    where: [
      gt(Health, 'current', 0),
      eq(State, 'mode', 'attacking')
    ]
  }
}) {}

// Available filter operators: eq, ne, lt, le, gt, ge, isin, nin
```

### 7. System Interface (Full)

```typescript
interface System {
  // World access
  world: World;

  // Query results
  queries: Record<string, Query>;

  // Reactive config (auto-created from schema)
  config: { [key]: Signal };

  // Cleanup registration
  cleanupFuncs: Array<() => void>;

  // XR/Player access
  player: XROrigin;
  input: XRInputManager;

  // Three.js access
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;

  // XR state
  visibilityState: Signal<VisibilityState>;
  xrManager: WebXRManager;
  xrFrame: XRFrame;

  // Shared state
  globals: Record<string, any>;

  // Entity creation helpers
  createEntity(): Entity;
  createTransformEntity(object?: Object3D, parent?: Entity): Entity;

  // Lifecycle
  init(): void;
  update(delta: number, time: number): void;
  play(): void;
  stop(): void;
}
```

### 8. XR Input System (Critical)

```typescript
update() {
  const leftGamepad = this.input.gamepads.left;
  const rightGamepad = this.input.gamepads.right;

  // Button states
  leftGamepad?.getButtonPressed(InputComponent.Trigger); // Currently pressed
  leftGamepad?.getButtonDown(InputComponent.Trigger);    // Just pressed this frame
  leftGamepad?.getButtonUp(InputComponent.Trigger);      // Just released this frame
  leftGamepad?.getButtonValue(InputComponent.Trigger);   // Analog value 0-1
  leftGamepad?.getButtonTouched(InputComponent.Trigger); // Finger touching

  // Special select button (primary action)
  leftGamepad?.getSelectStart(); // Primary button just pressed
  leftGamepad?.getSelectEnd();   // Primary button just released
  leftGamepad?.getSelecting();   // Primary button held

  // Thumbstick/touchpad axes
  const axes = leftGamepad?.getAxesValues(InputComponent.Thumbstick);
  console.log(axes?.x, axes?.y); // -1 to 1 range

  // Directional axes state
  leftGamepad?.getAxesEnteringUp(InputComponent.Thumbstick);
  leftGamepad?.getAxesEnteringDown(InputComponent.Thumbstick);
  leftGamepad?.getAxesEnteringLeft(InputComponent.Thumbstick);
  leftGamepad?.getAxesEnteringRight(InputComponent.Thumbstick);
}
```

**InputComponent Enum:**
```typescript
import { InputComponent } from '@iwsdk/core';

InputComponent.Trigger     // 'xr-standard-trigger'
InputComponent.Squeeze     // 'xr-standard-squeeze'
InputComponent.Touchpad    // 'xr-standard-touchpad'
InputComponent.Thumbstick  // 'xr-standard-thumbstick'
InputComponent.A_Button    // 'a-button'
InputComponent.B_Button    // 'b-button'
InputComponent.X_Button    // 'x-button'
InputComponent.Y_Button    // 'y-button'
InputComponent.Thumbrest   // 'thumbrest'
InputComponent.Menu        // 'menu'
```

### 9. Player/XROrigin Access (Critical)

```typescript
// Accessing player spatial hierarchy in a system
this.player              // XROrigin (Group) - VR rig root
this.player.head         // Head tracking (viewer pose)
this.player.raySpaces.left   // Left controller ray origin
this.player.raySpaces.right  // Right controller ray origin
this.player.gripSpaces.left  // Left controller grip position
this.player.gripSpaces.right // Right controller grip position
this.player.secondaryRaySpaces.left   // Secondary left ray
this.player.secondaryRaySpaces.right  // Secondary right ray
this.player.secondaryGripSpaces.left  // Secondary left grip
this.player.secondaryGripSpaces.right // Secondary right grip

// Getting world positions
const headPos = new Vector3();
this.player.head.getWorldPosition(headPos);

const rightHandPos = new Vector3();
this.player.gripSpaces.right.getWorldPosition(rightHandPos);
```

### 10. Audio System

```typescript
import { AudioSource, PlaybackMode, AudioUtils, InstanceStealPolicy, DistanceModel } from '@iwsdk/core';

// Adding audio to an entity
entity.addComponent(AudioSource, {
  src: 'audio/click.mp3',
  positional: true,          // 3D spatial audio
  loop: false,
  autoplay: false,
  volume: 0.5,
  refDistance: 1,
  rolloffFactor: 1,
  maxDistance: 10000,
  maxInstances: 1,
  playbackMode: PlaybackMode.Restart,
});

// Playing audio
AudioUtils.play(entity);
```

**PlaybackMode:**
```typescript
PlaybackMode.Restart      // Stop current and restart
PlaybackMode.Overlap      // Always start new instance
PlaybackMode.Ignore       // Ignore if already playing
PlaybackMode.FadeRestart  // Fade out current, start new
```

**InstanceStealPolicy:**
```typescript
InstanceStealPolicy.Oldest    // Steal oldest instance
InstanceStealPolicy.Quietest  // Steal quietest instance
InstanceStealPolicy.Furthest  // Steal furthest instance
```

**DistanceModel:**
```typescript
DistanceModel.Linear       // Linear falloff
DistanceModel.Inverse      // Inverse falloff
DistanceModel.Exponential  // Exponential falloff
```

### 11. Physics System

**PhysicsBody - motion properties:**
```typescript
import { PhysicsBody, PhysicsState } from '@iwsdk/core';

entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic,  // Static, Dynamic, Kinematic
  linearDamping: 0.0,
  angularDamping: 0.0,
  gravityFactor: 1.0,
  centerOfMass: [Infinity, Infinity, Infinity], // Infinity = auto-compute
});
```

**PhysicsState:**
```typescript
PhysicsState.Static    // Immovable (walls, floors)
PhysicsState.Dynamic   // Affected by physics
PhysicsState.Kinematic // Moved by code, affects others
```

**PhysicsShape - collision shape AND material properties:**
```typescript
import { PhysicsShape, PhysicsShapeType } from '@iwsdk/core';

entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Auto,  // Auto-detect from geometry
  dimensions: [0, 0, 0],         // Shape-specific dimensions
  density: 1.0,                  // Affects mass
  restitution: 0.0,              // Bounciness (0-1)
  friction: 0.5,                 // Sliding behavior
});
```

**PhysicsShapeType:**
```typescript
PhysicsShapeType.Sphere     // dimensions[0] = radius
PhysicsShapeType.Box        // dimensions = [width, height, depth]
PhysicsShapeType.Cylinder   // dimensions[0] = radius, dimensions[1] = height
PhysicsShapeType.Capsules   // dimensions[0] = radius, dimensions[1] = height
PhysicsShapeType.ConvexHull // Convex wrapper around mesh
PhysicsShapeType.TriMesh    // Exact mesh geometry (expensive)
PhysicsShapeType.Auto       // Auto-detect from Three.js geometry
```

### 12. Grabbable Components

```typescript
import { OneHandGrabbable, TwoHandsGrabbable, DistanceGrabbable, MovementMode } from '@iwsdk/core';

// Basic single-hand grab
entity.addComponent(OneHandGrabbable, {});

// Constrained manipulation
entity.addComponent(OneHandGrabbable, {
  rotate: true,
  rotateMin: [0, -Math.PI, 0],
  rotateMax: [0, Math.PI, 0],
  translate: true,
  translateMin: [-2, 0, -2],
  translateMax: [2, 3, 2],
});

// Two-hand manipulation (with scaling)
entity.addComponent(TwoHandsGrabbable, {
  rotate: true,
  translate: true,
  scale: true,
  scaleMin: [0.5, 0.5, 0.5],
  scaleMax: [2, 2, 2],
});

// Distance grab
entity.addComponent(DistanceGrabbable, {
  rotate: true,
  translate: true,
  scale: true,
  movementMode: MovementMode.MoveTowardsTarget, // MoveTowardsTarget | MoveAtSource | RotateAtSource
  returnToOrigin: false,  // Snap back when released
  moveSpeed: 0.1,         // Speed for MoveTowardsTarget mode
});
```

### 13. Environment/Lighting

```typescript
import { DomeGradient, DomeTexture, IBLGradient, IBLTexture } from '@iwsdk/core';

// Gradient sky dome (RGBA colors - 4 components)
entity.addComponent(DomeGradient, {
  sky: [0.2423, 0.6172, 0.8308, 1.0],      // RGBA
  equator: [0.6584, 0.7084, 0.7913, 1.0],  // RGBA
  ground: [0.807, 0.7758, 0.7454, 1.0],    // RGBA
  intensity: 1.0,
});

// HDR texture sky
entity.addComponent(DomeTexture, {
  url: '/textures/sky.hdr'
});

// Image-based lighting from gradient
entity.addComponent(IBLGradient, {
  sky: [0.6902, 0.749, 0.7843, 1.0],       // RGBA
  equator: [0.6584, 0.7084, 0.7913, 1.0],  // RGBA
  ground: [0.807, 0.7758, 0.7454, 1.0],    // RGBA
  intensity: 1.0,
});

// IBL from texture
entity.addComponent(IBLTexture, {
  src: 'room',  // or URL to HDR
  intensity: 1.0,
  rotation: [0, 0, 0],
});
```

### 14. Asset Loading

```typescript
import { AssetManager, AssetType } from '@iwsdk/core';

const world = await World.create(container, {
  assets: {
    myModel: { url: '/models/scene.glb', type: AssetType.GLTF, priority: 'critical' },
    mySound: { url: '/audio/click.mp3', type: AssetType.Audio, priority: 'background' },
    myTexture: { url: '/textures/wood.jpg', type: AssetType.Texture },
    myHDR: { url: '/textures/env.hdr', type: AssetType.HDRTexture },
  }
});

// Access preloaded assets
const model = AssetManager.getGLTF('myModel');
const texture = AssetManager.getTexture('myTexture');
const audio = AssetManager.getAudio('mySound');
```

**AssetType Enum:**
```typescript
AssetType.GLTF        // 3D models
AssetType.Audio       // Sound files
AssetType.Texture     // Images
AssetType.HDRTexture  // HDR environment maps
```

### 15. VisibilityState

```typescript
import { VisibilityState } from '@iwsdk/core';

VisibilityState.NonImmersive   // Browser mode (no XR)
VisibilityState.Hidden         // XR but not rendering
VisibilityState.Visible        // Full XR experience
VisibilityState.VisibleBlurred // XR but focus lost

this.world.visibilityState.subscribe((state) => {
  switch (state) {
    case VisibilityState.NonImmersive:
      // Show 2D fallback UI
      break;
    case VisibilityState.Visible:
      // Full XR experience
      break;
    case VisibilityState.VisibleBlurred:
      // Pause game, show overlay
      break;
  }
});
```

### XR Session Optimization

Configure frame rate and foveation when the XR session becomes visible:

```typescript
this.world.visibilityState.subscribe((state) => {
  if (state === VisibilityState.Visible) {
    this.world.session?.updateTargetFrameRate(72);  // Request 72 FPS
    this.world.renderer.xr.setFoveation(1);          // Max foveation for performance
  }
});
```

### 16. Locomotion Configuration

```typescript
import { LocomotionSystem, TurningMethod } from '@iwsdk/core';

const locomotion = world.getSystem(LocomotionSystem);

// All config properties are signals
locomotion.config.slidingSpeed.value = 3.0;
locomotion.config.turningMethod.value = TurningMethod.SmoothTurn; // 0=Snap, 1=Smooth
locomotion.config.turningAngle.value = 45;
locomotion.config.turningSpeed.value = 180;
locomotion.config.comfortAssist.value = 0.5;
locomotion.config.rayGravity.value = -0.4;
locomotion.config.jumpHeight.value = 1.5;
locomotion.config.jumpCooldown.value = 0.1;
locomotion.config.maxDropDistance.value = 5.0;
locomotion.config.useWorker.value = true;
```

### 17. Scene Understanding (AR)

```typescript
import { XRPlane, XRMesh, XRAnchor } from '@iwsdk/core';

// Enable in World.create
World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    features: { planeDetection: true, meshDetection: true }
  },
  features: {
    sceneUnderstanding: true
  }
});

// Query detected planes/meshes
export class MyARSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
  anchors: { required: [XRAnchor] }
}) {
  init() {
    this.queries.planes.subscribe('qualify', (entity) => {
      // New plane detected
      const plane = entity.object3D;
    });
  }
}
```

### 18. Feature Configuration (Critical!)

**Only enable features that your experience actually uses.** Features have prerequisites - enabling them without proper setup causes problems.

#### Feature Decision Matrix

| Feature | Enable When | Prerequisites | If Missing |
|---------|-------------|---------------|------------|
| `locomotion` | Player needs to move (teleport/slide) | Collision geometry in scene (floor, walls) | **Player falls through world** |
| `physics` | Objects need dynamic simulation | PhysicsShape + PhysicsBody components | Wasted overhead |
| `grabbing` | Objects are grabbable | Grabbable components on entities | Wasted overhead |
| `sceneUnderstanding` | AR with real-world surfaces | AR session mode | Feature won't work |
| `environmentRaycast` | AR object placement | AR session + hit-test support | Feature won't work |
| `spatialUI` | Using PanelUI components | UI config files | No UI renders |

#### Locomotion Requires Environment Setup

```typescript
// ❌ BAD - Locomotion enabled but no collision geometry
const world = await World.create(container, {
  features: {
    locomotion: true,  // Player will fall through the floor!
  }
});

// ✅ GOOD - Locomotion with proper environment
const world = await World.create(container, {
  level: '/glxf/SceneWithFloor.glxf',  // Scene has collision meshes
  features: {
    locomotion: true,
    physics: true,  // Physics provides collision detection
  }
});

// ✅ GOOD - Static experience, no locomotion needed
const world = await World.create(container, {
  features: {
    locomotion: false,  // Player stays at origin
    grabbing: true,     // Can still interact with objects
  }
});
```

#### VR vs AR Feature Sets

```typescript
// VR Experience - typically needs locomotion
const vrWorld = await World.create(container, {
  xr: { sessionMode: SessionMode.ImmersiveVR },
  features: {
    locomotion: true,   // Move around virtual space
    grabbing: true,
    physics: true,
  }
});

// AR Experience - player moves physically, no virtual locomotion
const arWorld = await World.create(container, {
  xr: {
    sessionMode: SessionMode.ImmersiveAR,
    features: { planeDetection: true, hitTest: true }
  },
  features: {
    locomotion: false,        // Player walks in real world
    sceneUnderstanding: true, // Detect real surfaces
    environmentRaycast: true, // Place objects on surfaces
    grabbing: true,
  }
});
```

### 19. World Initialization Pattern

```typescript
import { World, SessionMode } from '@iwsdk/core';

const world = await World.create(container, {
  render: {
    fov: 50,
    near: 0.1,
    far: 200,
    defaultLighting: true
  },

  assets: {
    myModel: { url: '/models/scene.glb', type: AssetType.GLTF },
  },

  level: '/glxf/MyScene.glxf',

  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    referenceSpaceType: 'local-floor',
    requiredFeatures: ['hand-tracking'],
    optionalFeatures: ['plane-detection'],
    offer: 'once',  // 'none' | 'once' | 'always'
  },

  // Enable feature systems - ONLY what you need!
  features: {
    locomotion: true,  // Only if scene has collision geometry
    grabbing: true,    // Only if objects are grabbable
    physics: true,     // Only if using dynamic physics
    spatialUI: {
      forwardHtmlEvents: true,
      preferredColorScheme: 'dark'
    }
  }
});

// Register custom systems
world.registerSystem(MySystem);

// Launch/exit XR
world.launchXR();
world.exitXR();
```

### Post-Creation Initialization Sequence

After `World.create()`, follow this order for proper initialization:

```typescript
// 1. Create subsystems (physics engine, networking, etc.)
const simulator = await RaceSimulator.create({ useWorker: true });

// 2. Store shared state in world.globals
world.globals.raceSimulator = simulator;
(world.globals as Record<string, unknown>).carProxies = new Map();
(world.globals as Record<string, unknown>).gamePaused = signal(true);

// 3. Register components
world
  .registerComponent(VehiclePhysicsLink)
  .registerComponent(VehiclePhysicsState);

// 4. Setup scene (creates entities)
await setupScene(world, simulator, { aiCount: 5 });

// 5. Register systems with priorities
world
  .registerSystem(PlayerInputSystem, { priority: 0 })
  .registerSystem(PhysicsStepSystem, { priority: 10 });
```

### 20. Transform Entity Creation

```typescript
// Create entity with Object3D binding
const entity = world.createTransformEntity(mesh, {
  parent: parentEntity,      // Optional parent
  persistent: false          // false = destroyed with level
});

// Transform component automatically syncs with Object3D (zero-copy)
entity.object3D.position.set(0, 1, 0);

// Or use component API
entity.setValue(Transform, 'position', [0, 1, 0]);

// Get vector view for efficient updates
const posView = entity.getVectorView(Transform, 'position');
posView[0] += delta;  // Direct array write
```

### 21. Panel UI Pattern

```typescript
export class SettingsSystem extends createSystem({
  settingsPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/settings.json')]
  }
}) {
  init() {
    this.queries.settingsPanel.subscribe('qualify', (entity) => {
      const doc = PanelDocument.data.document[entity.index];
      const button = doc.getElementById('my-button');

      button.addEventListener('click', () => {
        AudioUtils.play(entity);  // Audio feedback
      });
    });

    // React to XR visibility
    this.world.visibilityState.subscribe((state) => {
      const is2D = state === VisibilityState.NonImmersive;
      xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
    });
  }
}
```

## Core Components Reference (28 Total)

| Component | Purpose |
|-----------|---------|
| Transform | Position, rotation, scale |
| Visibility | Show/hide objects |
| LevelTag | Marks level membership |
| LevelRoot | Level root marker |
| Interactable | Marks interactive objects |
| Hovered | Currently hovered |
| Pressed | Currently pressed/grabbed |
| OneHandGrabbable | Single-hand manipulation |
| TwoHandsGrabbable | Two-hand manipulation |
| DistanceGrabbable | Grab from distance |
| Handle | Manipulation handle |
| PhysicsBody | Physics motion properties |
| PhysicsShape | Collision shape + material |
| PhysicsManipulation | Force/velocity application |
| DomeGradient | Gradient sky |
| DomeTexture | Textured sky |
| IBLGradient | Gradient IBL lighting |
| IBLTexture | Texture IBL lighting |
| PanelUI | UI panel configuration |
| PanelDocument | Loaded UI document |
| ScreenSpace | Screen-attached UI |
| Follower | Object following |
| XRPlane | Detected AR planes |
| XRMesh | Detected AR meshes |
| XRAnchor | Spatial anchors |
| AudioSource | Audio configuration |
| CameraSource | Camera device |
| LocomotionEnvironment | Locomotion settings |

## Core Systems Reference (17 Total)

| System | Priority | Purpose |
|--------|----------|---------|
| LocomotionSystem | -5 | Movement (teleport/slide/turn) |
| InputSystem | -4 | Interactable state management |
| GrabSystem | -3 | Grab handling |
| PhysicsSystem | -2 | Physics simulation |
| SceneUnderstandingSystem | -1 | AR plane/mesh detection |
| CameraSystem | default | Camera access |
| LevelSystem | default | Level loading |
| EnvironmentSystem | default | Lighting/sky |
| AudioSystem | default | Spatial audio |
| TransformSystem | default | Transform sync |
| VisibilitySystem | default | Visibility sync |
| PanelUISystem | default | UI panels |
| ScreenSpaceUISystem | default | Screen UI |
| FollowSystem | default | Object following |
| TurnSystem | default | Rotation |
| TeleportSystem | default | Teleportation |
| SlideSystem | default | Smooth movement |

### Custom System Priority Guidelines

Register custom systems with priorities following input→simulation→rendering pipeline:

```
Priority 0-9:    Input capture (player input, AI decisions)
Priority 10-19:  Simulation (physics step, game logic)
Priority 20-29:  Visual sync (sync Three.js objects to physics)
Priority 30+:    Low-priority updates (UI, HUD, ambient effects)
```

Example:
```typescript
world
  .registerSystem(PlayerInputSystem, { priority: 0 })
  .registerSystem(AIDriverSystem, { priority: 1 })
  .registerSystem(PhysicsStepSystem, { priority: 10 })
  .registerSystem(VehicleSyncSystem, { priority: 20 })
  .registerSystem(DashboardSystem, { priority: 35 });
```

## Project Structure

```
my-iwsdk-project/
├── src/
│   ├── index.ts              # Entry point with World.create()
│   ├── systems/
│   │   ├── ui-system.ts      # Panel/UI management
│   │   └── game-system.ts    # Game logic
│   └── components/
│       └── custom.ts         # Custom component definitions
├── public/
│   ├── gltf/                 # 3D models
│   ├── audio/                # Audio files
│   ├── glxf/                 # Generated scene files
│   └── ui/                   # Compiled UI configs
├── ui/
│   └── *.uikitml             # UI markup source
├── metaspatial/              # Meta Spatial Editor project
├── vite.config.ts
└── package.json
```

## Anti-Patterns to Avoid

1. **DON'T** store entity arrays in systems - use queries
2. **DON'T** poll for state changes - use signal subscriptions
3. **DON'T** manually track component additions/removals - use query subscribe
4. **DON'T** create entities in update() without proper lifecycle management
5. **DON'T** use `Types.Object` for data that could be typed (use Vec3, Float32, etc.)
6. **DON'T** forget cleanup functions for subscriptions and resources
7. **DON'T** modify entities during query iteration without careful consideration
8. **DON'T** enable locomotion without collision geometry - player falls through world
9. **DON'T** enable features you don't use - adds overhead and can cause bugs
10. **DON'T** confuse PhysicsBody (motion) with PhysicsShape (collision + material)

## Performance Tips

1. Use `getVectorView()` for direct TypedArray access (zero-copy)
2. Batch query enumeration (don't create intermediate arrays)
3. Use tag components for cheap boolean queries
4. Leverage query filters (`where`) to reduce iteration scope
5. System config signals auto-deduplicate (no callback if value unchanged)
6. Physics and locomotion can run in Web Workers for heavy scenes
7. Use `PhysicsShapeType.Auto` to let IWSDK pick optimal collision shape

## When Planning a New Feature

1. **Determine feature flags** - What built-in features does this need? (locomotion, physics, grabbing, etc.)
2. **Check prerequisites** - If using locomotion, is collision geometry set up?
3. **Identify components needed** - What data does this feature require?
4. **Design queries** - How will systems find relevant entities?
5. **Plan reactivity** - What changes should trigger updates?
6. **Consider lifecycle** - When are entities created/destroyed?
7. **Map to existing systems** - Can built-in systems (grab, physics, etc.) help?
8. **VR vs AR** - Does this work differently in each mode?
9. **Input handling** - What controller/hand inputs are needed?
10. **Audio feedback** - What sounds should play on interactions?
11. **Select 3D assets** - What models are needed? (see Asset Selection below)

## Asset Selection with Kenney Prototype Kit

This project includes the **Kenney Prototype Kit** at `public/kenney_prototype-kit/` with 143 prototyping models.

### During Planning: Choose Assets

When planning a feature that needs 3D models, consult the asset catalog:

1. **Read the catalog index** to find relevant models:
   ```
   Read: public/kenney_prototype-kit/catalog/README.md
   ```

2. **Browse category files** for detailed descriptions:
   - `walls.md` - 25 wall pieces for room construction
   - `floors.md` - 8 ground/platform surfaces
   - `doors.md` - 6 animated doorways
   - `shapes.md` - 18 geometric primitives
   - `indicators.md` - 17 waypoints/markers
   - `misc-props.md` - Coins, crates, flags
   - `buttons-levers.md` - Interactive controls
   - And more...

3. **Preview models visually** using the `/preview-model` skill:
   ```
   /preview-model wall-corner
   /preview-model door-rotate b
   ```

4. **Document asset choices** in your plan with:
   - Model name and category
   - Suggested position/scale
   - Texture variation (a, b, or c)

### Asset Selection Checklist

When your plan involves 3D objects, answer these:

| Question | Example Answer |
|----------|----------------|
| What models are needed? | `wall-corner`, `door-rotate`, `indicator-arrow` |
| What texture variation? | Variation A (purple/lavender with orange accents) |
| What scale factor? | 0.5x for desk-scale, 1.0x for room-scale |
| Where positioned? | `(0, 0.85, -1.5)` on desk, `(0, 0, -3)` on floor |
| Any interactions? | Grabbable, physics-enabled, trigger zones |

### Example: Planning a Simple Puzzle Room

**Feature:** Player solves a button puzzle to open a door

**Asset Selection:**
1. Read `catalog/walls.md` → select `wall-corner`, `wall-doorway`
2. Read `catalog/doors.md` → select `door-rotate` (animated swing door)
3. Read `catalog/buttons-levers.md` → select `button-round` (pressable)
4. Read `catalog/indicators.md` → select `indicator-arrow` (shows where to go)

**Preview with `/preview-model`:**
```
/preview-model door-rotate a
/preview-model button-round a
```

**Document in plan:**
```
Assets:
- door-rotate.glb at (0, 0, -3), scale 1.0, variation-a texture
- button-round.glb at (1, 1, -2), scale 0.5, variation-a texture
- indicator-arrow.glb at (0, 0.1, -2.5), scale 0.3, variation-a texture
```
