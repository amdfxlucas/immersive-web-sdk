# IWSDK Project

This file provides project context for AI coding assistants working on IWSDK (Immersive Web SDK) projects.

## Project Structure

```
my-iwsdk-project/
├── src/
│   ├── index.ts              # World.create() entry point
│   ├── systems/              # Custom systems
│   └── components/           # Custom components
├── public/
│   ├── gltf/                 # 3D models
│   ├── audio/                # Sound files
│   ├── glxf/                 # Scene files
│   └── ui/                   # Compiled UI
├── ui/
│   └── *.uikitml             # UI markup source
├── metaspatial/              # Meta Spatial Editor project
└── vite.config.ts
```

**Convention:** One system per file, with its related components. No barrel `index.ts` files.

---

## Critical Best Practices

### Feature Configuration (CRITICAL!)

**This is the #1 cause of bugs in IWSDK projects.**

| Feature                    | Prerequisites                                        | If Missing                     |
| -------------------------- | ---------------------------------------------------- | ------------------------------ |
| `locomotion: true`         | LocomotionEnvironment component OR physics collision | **Player falls through world** |
| `physics: true`            | PhysicsBody + PhysicsShape components on entities    | Wasted overhead                |
| `grabbing: true`           | Grabbable components (OneHandGrabbable, etc.)        | Wasted overhead                |
| `sceneUnderstanding: true` | AR session mode                                      | Feature won't work             |

```typescript
// ❌ BAD - Player falls through the world!
World.create(container, {
  features: { locomotion: true },
});

// ✅ GOOD - With proper environment
World.create(container, {
  features: { locomotion: true },
});
// AND scene has LocomotionEnvironment component on floor/surfaces

// ✅ GOOD - AR experience (no virtual locomotion)
World.create(container, {
  xr: { sessionMode: SessionMode.ImmersiveAR },
  features: { locomotion: false, sceneUnderstanding: true },
});
```

### VR Performance Context

VR targets 72-90 FPS, giving only **11-14ms per frame**. Every allocation in `update()` risks a GC pause that drops frames.

### Anti-Patterns to Avoid

#### DON'T store entity arrays in systems

```typescript
// ❌ BAD - Manual entity tracking
private myEntities: Entity[] = [];

// ✅ GOOD - Use queries
this.queries.items.entities
```

#### DON'T allocate in update()

```typescript
// ❌ BAD - Creates garbage every frame
update() {
  const temp = new Vector3();
}

// ✅ GOOD - Allocate in init() as class properties
private temp!: Vector3;
init() {
  this.temp = new Vector3();
}
```

#### DON'T poll for state changes

```typescript
// ❌ BAD - Checking every frame
update() {
  if (entity.hasComponent(Pressed)) { ... }
}

// ✅ GOOD - Subscribe to query
this.queries.pressed.subscribe('qualify', (entity) => { ... });
```

#### DON'T forget to cleanup subscriptions

```typescript
// ❌ BAD - Memory leak
init() {
  this.world.visibilityState.subscribe((state) => { ... });
}

// ✅ GOOD - Register cleanup
init() {
  this.cleanupFuncs.push(
    this.world.visibilityState.subscribe((state) => { ... })
  );
}
```

#### DON'T use .value in update() loops

```typescript
// ❌ BAD - creates subscription overhead every frame
update() {
  const rate = this.config.tickRate.value;
}

// ✅ GOOD - peek() reads without subscription
update() {
  const rate = this.config.tickRate.peek();
}
```

#### DON'T use raw asset loaders — use AssetManager

```typescript
// ❌ BAD - bypasses DRACO/KTX2 setup, no caching, no de-duplication
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
new GLTFLoader().loadAsync(url);

// ✅ GOOD - Declare in AssetManifest passed to World.create({ assets })
const world = await World.create(container, {
  assets: { myModel: { url: '/models/scene.glb', type: AssetType.GLTF } },
});
const gltf = AssetManager.getGLTF('myModel');

// ✅ GOOD - For runtime loading
await AssetManager.loadGLTF(url, 'myModel');
```

#### DON'T use scene.add() — use createTransformEntity

```typescript
// ❌ BAD - bypasses ECS, no Transform component, no level lifecycle
scene.add(mesh);

// ❌ BAD - parenting under a non-entity silently reparents to scene root
someObject3D.add(mesh);

// ✅ GOOD - proper entity creation with parent
world.createTransformEntity(mesh, parentEntity);
// or with options
world.createTransformEntity(mesh, { parent: parentEntity });

// ✅ GOOD - persistent entity (survives level changes)
world.createTransformEntity(mesh, {
  parent: world.sceneEntity,
  persistent: true,
});
```

#### DON'T use manual Raycaster — use Interactable component

```typescript
// ❌ BAD - no BVH acceleration, doesn't work in XR, no pointer events
import { Raycaster } from '@iwsdk/core';
const raycaster = new Raycaster();

// ✅ GOOD - add Interactable, then query Hovered/Pressed in your system
entity.addComponent(Interactable);
// InputSystem provides BVH-accelerated raycasting, pointer events,
// and auto-manages Hovered/Pressed state
```

#### DON'T add environment components to arbitrary entities

```typescript
// ❌ BAD - Environment components on random entity (silently ignored)
someEntity.addComponent(DomeGradient, { sky: [0.2, 0.6, 0.8, 1.0] });

// ✅ GOOD - Must go on the level root
const root = world.activeLevel.value;
root.addComponent(DomeGradient, { sky: [0.2, 0.6, 0.8, 1.0] });
```

#### DON'T forget `_needsUpdate` after changing environment properties

```typescript
// ❌ BAD - Changes are silently ignored
root.setValue(DomeGradient, 'sky', [0.1, 0.2, 0.8, 1.0]);

// ✅ GOOD - Set _needsUpdate to apply changes
root.setValue(DomeGradient, 'sky', [0.1, 0.2, 0.8, 1.0]);
root.setValue(DomeGradient, '_needsUpdate', true);
```

#### DON'T use `entity.destroy()` for objects with GPU resources

```typescript
// ❌ BAD - GPU memory for geometry/materials/textures is leaked
entity.destroy();

// ✅ GOOD - Also cleans up GPU resources
entity.dispose();
```

#### DON'T pass numbers to ScreenSpace

```typescript
// ❌ BAD - ScreenSpace uses CSS strings, not numbers
entity.addComponent(ScreenSpace, { width: 400, top: 20 });

// ✅ GOOD - Use CSS string expressions
entity.addComponent(ScreenSpace, { width: '400px', top: '20px' });
```

---

## Quick Reference

### Core Architecture

IWSDK is built on three pillars:

1. **ECS (Entity Component System)** via `elics` library
2. **Reactive Signals** via `@preact/signals-core`
3. **Three.js Integration** with zero-copy transform binding

### Key Imports

```typescript
import {
  World,
  SessionMode,
  VisibilityState,
  createSystem,
  createComponent,
  Types,
  eq,
  ne,
  lt,
  le,
  gt,
  ge,
  isin,
  nin,
  Transform,
  Interactable,
  Hovered,
  Pressed,
  OneHandGrabbable,
  TwoHandsGrabbable,
  DistanceGrabbable,
  PhysicsBody,
  PhysicsShape,
  PhysicsState,
  PhysicsShapeType,
  AudioSource,
  PlaybackMode,
  AudioUtils,
  PanelUI,
  PanelDocument,
  InputComponent,
} from '@iwsdk/core';
```

### Critical Import Rule

**ALWAYS import Three.js types from `@iwsdk/core`, NEVER from `'three'` directly.**

```typescript
// ✅ CORRECT
import { Vector3, Quaternion, Mesh, MeshStandardMaterial } from '@iwsdk/core';

// ❌ WRONG - causes duplicate Three.js instances and bugs
import { Vector3 } from 'three';
import * as THREE from 'three';
```

**Exception:** GLTF loader types still come from three/addons:

```typescript
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
```

### Available Types

```typescript
Types.Float32; // 32-bit float
Types.Float64; // 64-bit float
Types.Int8; // 8-bit integer
Types.Int16; // 16-bit integer
Types.Int32; // 32-bit integer
Types.Uint32; // 32-bit unsigned
Types.Boolean; // true/false
Types.String; // text
Types.Vec3; // [x, y, z]
Types.Vec4; // [x, y, z, w]
Types.Color; // [r, g, b, a] - RGBA!
Types.Entity; // Entity reference
Types.Enum; // Enumerated value
Types.Object; // Any JS object (AVOID - not optimized)
```

### Component Template

```typescript
export const MyComponent = createComponent('MyComponent', {
  speed: { type: Types.Float32, default: 1.0 },
  position: { type: Types.Vec3, default: [0, 0, 0] },
  color: { type: Types.Color, default: [1, 1, 1, 1] }, // RGBA
});
```

### Zero-Allocation Vector Access

Use `getVectorView()` for direct TypedArray access in hot paths:

```typescript
// Returns Float32Array view - no object allocation
const posView = entity.getVectorView(Transform, 'position') as Float32Array;
posView[0] = x; // Direct write
posView[1] = y;
posView[2] = z;
```

### System Template

```typescript
export class MySystem extends createSystem(
  {
    items: { required: [MyComponent] },
    activeItems: { required: [MyComponent], excluded: [Disabled] },
  },
  {
    speed: { type: Types.Float32, default: 1.0 },
  },
) {
  private temp!: Vector3;

  init() {
    this.temp = new Vector3();

    this.queries.items.subscribe('qualify', (entity) => {
      // Entity matched query
    });

    this.cleanupFuncs.push(
      this.config.speed.subscribe((value) => {
        // Config changed
      }),
    );
  }

  update(delta: number, time: number) {
    for (const entity of this.queries.activeItems.entities) {
      // Process entity - NO allocations here!
    }
  }
}
```

### XR Input Access

```typescript
update() {
  const leftGamepad = this.input.gamepads.left;
  const rightGamepad = this.input.gamepads.right;

  // Button states
  leftGamepad?.getButtonPressed(InputComponent.Trigger);  // Currently held
  leftGamepad?.getButtonDown(InputComponent.Trigger);     // Just pressed
  leftGamepad?.getButtonUp(InputComponent.Trigger);       // Just released

  // Thumbstick
  const axes = leftGamepad?.getAxesValues(InputComponent.Thumbstick);
  console.log(axes?.x, axes?.y);  // -1 to 1

  // Player spatial hierarchy
  this.player.head;              // Head tracking
  this.player.raySpaces.left;    // Left controller ray
  this.player.gripSpaces.right;  // Right controller grip
}
```

### VisibilityState Handling

```typescript
init() {
  this.cleanupFuncs.push(
    this.world.visibilityState.subscribe((state) => {
      switch (state) {
        case VisibilityState.NonImmersive:
          // Browser mode (2D)
          break;
        case VisibilityState.Visible:
          // Full XR experience
          break;
        case VisibilityState.VisibleBlurred:
          // XR but focus lost - pause game
          break;
      }
    })
  );
}
```

### Audio Playback

```typescript
entity.addComponent(AudioSource, {
  src: '/audio/click.mp3',
  positional: true,
  volume: 0.5,
  playbackMode: PlaybackMode.Restart, // or Overlap, Ignore, FadeRestart
});

// Play audio
AudioUtils.play(entity);
```

### Physics Setup

```typescript
// PhysicsBody = motion properties
entity.addComponent(PhysicsBody, {
  state: PhysicsState.Dynamic, // or Static, Kinematic
  linearDamping: 0.5,
  gravityFactor: 1.0,
});

// PhysicsShape = collision shape + material
entity.addComponent(PhysicsShape, {
  shape: PhysicsShapeType.Box, // or Sphere, Cylinder, Auto
  density: 1.0,
  restitution: 0.5, // Bounciness
  friction: 0.3,
});
```

---

## Testing Workflow

**CRITICAL: Always run type check BEFORE testing!**

```bash
npx tsc --noEmit
```

Type errors will prevent systems from initializing properly, but may not show errors in the browser console. Always type check after writing code and before testing.

1. **Type check first:** `npx tsc --noEmit` - fix any errors before proceeding
2. Start dev server: `npm run dev`
3. Open browser to `https://localhost:8081`
4. Enter XR mode in browser
5. Test interactions with controllers
