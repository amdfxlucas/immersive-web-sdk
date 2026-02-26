# IWSDK Project - Claude Code Configuration

This file configures Claude Code for IWSDK (Immersive Web SDK) project development.

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

---

## Agents Available

### `iwsdk-project-code-reviewer`

Reviews IWSDK project code for correct framework usage, ECS patterns, and performance.

```
Use the iwsdk-project-code-reviewer agent to review my code
```

---

## Skills Available

### `/iwsdk-planner`

**IWSDK project planning and best practices guide**

Use when:

- Planning new IWSDK features
- Designing systems/components
- Need guidance on ECS, signals, or reactive patterns

### `/iwsdk-ui-panel`

**Develop and iterate on IWSDK UI panels**

Use when:

- Working on PanelUI components
- Debugging UI layout
- Improving UI design

### `/catalog-assets`

**Catalog and index 3D model assets or image libraries**

Use when:

- Documenting or describing asset files (GLB models, textures, images)
- Creating a searchable index of assets
- Spawns parallel subagents to examine preview images and write descriptions

Example:
```
/catalog-assets public/kenney_prototype-kit
```

### `/preview-model`

**Preview a 3D model from the Kenney Prototype Kit in VR**

Use when:

- Wanting to see what a model looks like in the scene
- Testing a model with different texture variations
- Comparing models visually

Example:
```
/preview-model figurine
/preview-model door-rotate b
```

The Kenney Prototype Kit is bundled at `public/kenney_prototype-kit/` and includes 143 models with 3 texture variations each.

---

## MCP Tools Available

### IWSDK-RAG (Code Intelligence)

Semantic code search and API lookup for IWSDK, elics ECS, and dependencies.

| Tool                                         | Purpose                      | When to Use                                              |
| -------------------------------------------- | ---------------------------- | -------------------------------------------------------- |
| `mcp__iwsdk-rag-local__search_code`          | Semantic search across IWSDK | Finding code by description ("how to create VR session") |
| `mcp__iwsdk-rag-local__get_api_reference`    | Quick API lookup by name     | When you know the class/function name                    |
| `mcp__iwsdk-rag-local__find_by_relationship` | Find code by relationships   | Classes that extend/implement something                  |
| `mcp__iwsdk-rag-local__list_ecs_components`  | List all ECS components      | Discovering available components                         |
| `mcp__iwsdk-rag-local__list_ecs_systems`     | List all ECS systems         | Discovering available systems                            |
| `mcp__iwsdk-rag-local__find_usage_examples`  | Find real-world examples     | Understanding how to use an API                          |

### IWER (Immersive Web Emulation Runtime)

WebXR emulator control for testing without a headset. All tools are prefixed `mcp__iwer__`.

**Session**

| Tool                 | Purpose                                 |
| -------------------- | --------------------------------------- |
| `get_session_status` | Check IWER connection (**call first!**) |
| `accept_session`     | Enter XR mode                           |
| `end_session`        | Exit XR mode                            |
| `reload_page`        | Reload browser to reset state           |

**Device Control**

| Tool                | Purpose                                                                    |
| ------------------- | -------------------------------------------------------------------------- |
| `set_transform`     | Set position/orientation of headset, controller, or hand                   |
| `get_transform`     | Read current position/orientation of a device                              |
| `look_at`           | Orient a device toward a world position (optional move-to)                 |
| `animate_to`        | Smoothly animate a device to a new transform over time                     |
| `set_input_mode`    | Switch between `controller` and `hand` tracking                            |
| `set_connected`     | Connect/disconnect an input device                                         |
| `select`            | Full select action (press+release) — fires selectstart/select/selectend    |
| `set_select_value`  | Set trigger/pinch value (0-1) for grab-move-release patterns               |
| `set_gamepad_state` | Set button values and thumbstick axes by index                             |
| `get_device_state`  | Read full device state (headset + controllers + hands)                     |
| `set_device_state`  | Batch-set device state; call with no args to reset defaults                |

**Observation**

| Tool               | Purpose                                                 |
| ------------------ | ------------------------------------------------------- |
| `capture_canvas`   | Screenshot the WebXR canvas (returns file path)         |
| `get_console_logs` | Browser console logs with level/pattern/count filtering |

**Scene Inspection** (requires IWSDK / FRAMEWORK_MCP_RUNTIME)

| Tool                   | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `get_scene_hierarchy`  | Three.js scene tree with names, UUIDs, and entity indices                                     |
| `get_object_transform` | Local + global transforms; includes position relative to XR origin (use with `look_at`) |

**ECS Debugging** (requires IWSDK / FRAMEWORK_MCP_RUNTIME)

| Tool               | Purpose                                                    |
| ------------------ | ---------------------------------------------------------- |
| `ecs_find_entities`  | Search entities by component composition and/or name regex |
| `ecs_query_entity`   | Read all component field values for an entity by index     |
| `ecs_list_components`| List all registered components with field schemas          |
| `ecs_list_systems`   | List all systems with priority, pause state, entity counts |
| `ecs_set_component`  | Write a component field value on a live entity             |
| `ecs_toggle_system`  | Pause/resume a specific system by name                     |
| `ecs_pause`          | Freeze all ECS updates (render loop continues)             |
| `ecs_resume`         | Resume ECS updates after pause                             |
| `ecs_step`           | Advance N frames with fixed timestep while paused          |
| `ecs_snapshot`       | Capture full ECS state (stores up to 2 snapshots)          |
| `ecs_diff`           | Compare two snapshots — shows field-level diffs            |

**Key workflows:**

- **Discover entities:** `ecs_find_entities` (get entity indices) → `ecs_query_entity` (read component data)
- **Discover schema:** `ecs_list_components` to see field names/types before querying or setting values
- **Frame-by-frame debugging:** `ecs_pause` → `ecs_step` (count/delta). Must pause before stepping.
- **Diff state changes:** `ecs_snapshot(label="before")` → trigger action → `ecs_snapshot(label="after")` → `ecs_diff(from="before", to="after")`
- **Isolate a system:** `ecs_list_systems` to discover names → `ecs_toggle_system` to pause one system while others run
- **Look at an object:** `get_scene_hierarchy` → find UUID → `get_object_transform` → use `positionRelativeToXROrigin` with `look_at`

**Connection check — always call first:**

```
mcp__iwer__get_session_status
```

If this returns a successful connection, the dev server is ALREADY running. Do NOT start another one.

**Troubleshooting:**

- Dev server not running → Start with `pnpm dev`
- Browser tab in background → Bring to foreground (Chrome throttles background tabs)
- Session not active → Use `mcp__iwer__accept_session`

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

**BEFORE starting a dev server, ALWAYS check if one is already running:**

```
mcp__iwer__get_session_status
```

If this returns a successful connection, the dev server is already running. Do NOT start another one.

1. **Type check first:** `npx tsc --noEmit` - fix any errors before proceeding
2. Check IWER status first: `mcp__iwer__get_session_status`
3. If not connected, start dev server: `pnpm dev`
4. Open browser to `https://localhost:8081`
5. Enter XR: `mcp__iwer__accept_session`
6. Test interactions with controller tools

### Debugging Missing Features

If something isn't appearing or working but no errors show in console:

1. **Don't use level filter for console logs** — call `mcp__iwer__get_console_logs` with just `count`, not `level` filter, as you may miss important errors
2. **Run type check** — `npx tsc --noEmit` often reveals issues that don't appear as runtime errors
3. **Check scene hierarchy** — use `mcp__iwer__get_scene_hierarchy` to verify entities exist and find entity indices
4. **Reload and check logs immediately** — some errors only appear during initialization
5. **Inspect ECS state** — use `mcp__iwer__ecs_find_entities` to check if entities have expected components, then `mcp__iwer__ecs_query_entity` to read their values
6. **Diff before/after** — take `mcp__iwer__ecs_snapshot` before and after an action to see exactly what changed (or didn't)
7. **Isolate systems** — use `mcp__iwer__ecs_toggle_system` to pause suspect systems one at a time to find which causes the issue
