# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Immersive Web SDK (IWSDK)** - A comprehensive JavaScript framework for building WebXR (VR/AR) applications on the web. Built on Three.js with a high-performance Entity Component System (Elics), IWSDK enables developers to create immersive experiences that run identically in VR/AR headsets and desktop browsers with automatic mouse-and-keyboard emulation.

**Key Technologies:**

- Three.js (3D rendering engine)
- Elics (Entity Component System)
- WebXR API
- pnpm workspaces (monorepo management)
- Vite (build tool for examples)
- Rollup (library bundler)

## Monorepo Structure

This is a monorepo containing 10 packages:

- **@iwsdk/core** - Main SDK with ECS, systems, and WebXR integration
- **@iwsdk/create** - CLI tool for scaffolding new IWSDK projects
- **@iwsdk/glxf** - GLXF (GLTF eXtended) scene format loader
- **@iwsdk/locomotor** - Locomotion engine for movement (teleport, slide, turn)
- **@iwsdk/xr-input** - WebXR input system abstraction (controllers, hands, head tracking)
- **@iwsdk/vite-plugin-iwer** - Vite plugin that injects IWER (WebXR emulator) for desktop development
- **@iwsdk/vite-plugin-gltf-optimizer** - Build-time GLTF/GLB optimization plugin
- **@iwsdk/vite-plugin-uikitml** - UIKitML to JSON compiler for spatial UI
- **@iwsdk/vite-plugin-metaspatial** - Meta Spatial Editor integration plugin
- **@iwsdk/starter-assets** - CDN-hosted templates and starter assets

## Development Environment

**Requirements:**

- Node.js >= 20.19.0
- pnpm (package manager)

**Installation:**

```bash
pnpm install
```

## Common Development Commands

### Build Commands

```bash
# Install dependencies
pnpm install

# Build core package only
npm run build

# Build all packages
npm run build:all

# Build all packages as .tgz files for local testing with examples
npm run build:tgz

# Build specific package
pnpm --filter @iwsdk/core run build
pnpm --filter @iwsdk/vite-plugin-metaspatial run build
```

### Testing

```bash
# Run tests (from package directory, e.g., packages/core/)
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file (Vitest)
npm run test -- tests/specific.test.ts
```

Test framework: **Vitest** (used in @iwsdk/core and @iwsdk/vite-plugin-metaspatial)

### Code Quality

```bash
# Lint all files
pnpm run lint

# Auto-fix lint errors
pnpm run lint:fix

# Format code with Prettier
pnpm run format

# Check code formatting
pnpm run format:check
```

Configuration:

- ESLint config: `eslint.config.js` (flat config format)
- Prettier config: `.prettierrc.json`
- Git hooks run lint-staged automatically on commit

### Documentation

```bash
# Start VitePress dev server
npm run docs:dev

# Build all documentation
npm run docs:build

# Generate API documentation with TypeDoc
npm run docs:api
```

### Example Development Workflow

```bash
# 1. Make changes to a package (e.g., @iwsdk/core)

# 2. Build affected packages
pnpm --filter @iwsdk/core run build

# 3. Build all packages as tgz for examples
npm run build:tgz

# 4. Test in an example
cd examples/locomotion
npm run fresh:dev

# 5. Run linting before commit
pnpm run lint:fix
pnpm run format
```

## High-Level Architecture

### Entity Component System (ECS) Foundation

IWSDK is built on **Elics**, a high-performance Entity Component System with three core concepts:

- **Components**: Reusable data containers (Transform, Interactable, PhysicsBody, Grabbable, etc.)
- **Entities**: Instances that combine multiple components
- **Systems**: Logic units that query and update entities each frame

Each entity wraps a Three.js `Object3D` for 3D rendering, establishing a direct coupling between the ECS and the rendering pipeline.

### World-Centric Design

The `World` class (extends `ElicsWorld`) serves as the central hub:

```
World
├── ContextFactory → PresenterContext
│   ├── Renderer (WebGLRenderer, shared across mode switches)
│   ├── Canvas / Container (DOM elements)
│   ├── Scene (swapped per presenter: Y-up for XR, Z-up for Map)
│   └── Camera (swapped per presenter)
├── IPresenter (active: XRPresenter | MapPresenter)
├── Input (XRInputManager from @iwsdk/xr-input)
├── Player (XROrigin - head/hand tracking)
├── AssetManager (centralized loader)
├── Systems (Transform, Input, Grab, Physics, etc.)
└── Entities (hierarchical transform tree)
```

### Core Systems

- **Transform System**: Synchronizes ECS component data with Three.js Object3D transforms using zero-copy typed arrays
- **Input System**: Samples XR poses, manages raycasting for interactables, emits pointer events
- **Level System**: Manages GLXF scene loading, handles level transitions, enforces identity transforms on level roots
- **Physics System**: Havok-based rigid body and constraint simulation
- **Grab System**: One-hand, two-hand, and distance grab interactions
- **Locomotion System**: Teleportation, sliding, and turning locomotion (optional feature)
- **Audio System**: Spatial audio with pooled Web Audio API sources
- **UI Systems**: Screen-space, panel-based, and world-space UI using UIKit

### Key Design Patterns

**Reactive Configuration via Signals:**

- Uses Preact Signals for reactive state management
- System configurations are Signals, allowing reactive updates

**Transform Synchronization Without Copies:**

- Transform component fields directly map to Three.js Object3D typed arrays
- Updates to ECS data automatically reflect in Three.js with zero overhead

**Level Root Parenting:**

- Entities automatically parented under scene root (persistent) or active level root (level content)
- Enables atomic level unloading by destroying level-tagged entities

**Optional Feature Systems:**

- Configured via `WorldOptions.features` during World creation
- Features: locomotion, grabbing, physics, sceneUnderstanding, environmentRaycast, camera, spatialUI

**GLXF Component Registry:**

- GLXF metadata maps to ECS components via component registry
- Supports custom mappers for declarative scene construction

### Module Organization (@iwsdk/core)

```
/ecs        - Component/System/World abstractions
/init       - World initialization and bootstrap logic
/presenter  - Presenter abstraction (IPresenter, PresenterContext, XR/Map implementations)
/transform  - Transform component with synced vectors
/input      - Input system with pointer/gesture handling
/level      - GLXF level loading and transitions
/grab       - Grab interaction (one/two hand, distance)
/locomotion - Locomotion wrapper (uses @iwsdk/locomotor)
/physics    - Physics simulation (Havok integration)
/audio      - Spatial audio system
/ui         - Spatial UI systems (ScreenSpace, PanelUI, Follow)
/environment - Lighting (dome textures, IBL gradients)
/asset      - Centralized asset management
/scene-understanding - XR plane/mesh/anchor handling
/camera     - Camera stream access
```

### Development Pattern: TGZ-Based Local Dependencies

Examples use `.tgz` files for local package dependencies:

1. `npm run build:tgz` creates `.tgz` archives for all packages
2. Examples reference packages via `file:` dependencies pointing to tgz files
3. This simulates how end-users consume packages from npm

## Contributing Guidelines

### Pull Request Process

1. Fork repo and create branch from `main`
2. Add tests for new code
3. Ensure code lints: `pnpm run lint` and `pnpm run format`
4. Complete CLA (Contributor License Agreement)

### Testing Requirements

- Must not break existing tests
- New features should include relevant tests with Vitest
- Run tests before submitting PR

### Code Quality Standards

- ESLint and Prettier enforce coding standards
- Run `pnpm run format` before committing
- Git hooks automatically run lint-staged on commit
- VSCode Prettier extension recommended for format-on-save

## Versioning and Release Process

### Changesets Workflow

```bash
# 1. Create a changeset describing your changes
pnpm changeset

# 2. Select affected packages and bump type (patch/minor/major)

# 3. Commit the changeset file along with your changes
```

### Bump Guidelines

- **patch**: Bug fixes, documentation updates, build changes, safe internal refactors
- **minor**: Backward-compatible new features
- **major**: Breaking changes

### Fixed Versioning

All `@iwsdk/*` packages share the same version number. Changesets manages version bumping across the entire monorepo.

## License

MIT License - All contributions are licensed under the MIT License.

## Presenter Abstraction

The Presenter abstraction follows an MVC-inspired pattern where the ECS World is the data model, and Presenters are interchangeable views that render the world's state in different modes (WebXR 3D, custom map views, etc.).

**Design principles:**

- Presenters are subordinate to the ECS World — they render whatever the World contains
- Entity identity is preserved across presenter switches (a parcel entity remains the same entity regardless of view)
- User interactions (clicks, hovers) are communicated back to the ECS as Tag components (Hovered, Pressed) on affected entities
- Applications only load features into the World and provide a container div; rendering is handled automatically by the active presenter
- **Core is XR/AR/VR-focused** — additional rendering modes (e.g. map) are provided by external packages via the presenter registry

### Key Files

```
/presenter
├── presenter.ts            - IPresenter interface, PresentationMode enum, PresenterConfig
├── presenter-registry.ts   - PresenterDescriptor interface + registerPresenterDescriptor() registry
├── presenter-context.ts    - PresenterContext, ContextRequirements, ContextFactory
├── presenter-factory.ts    - createPresenter(), getSupportedModes(), getBestMode() (registry-backed)
├── xr-presenter.ts         - WebXR (AR/VR/Inline) presenter implementation
├── gis-presenter.ts        - IGISPresenter interface for geographic coordinate support
├── gis-root-component.ts   - GISRootComponent for CRS/origin metadata
├── coordinate-adapter.ts   - ENU ↔ Geographic ↔ CRS coordinate transforms
└── index.ts                - Module exports
```

### "Bring Your Own Presenter" — Presenter Registry

`@iwsdk/core` ships with three built-in modes (`immersive-ar`, `immersive-vr`, `inline`). Additional modes are registered by external packages at import time.

```typescript
// presenter-registry.ts
export interface PresenterDescriptor {
  factory(): IPresenter; // creates the presenter instance
  isSupported(): Promise<boolean>; // environment capability check
  createConfig?(options?: Partial<PresenterConfig>): PresenterConfig; // default config
  priority?: number; // for getBestMode() ordering (higher = preferred)
}

export function registerPresenterDescriptor(
  mode: string,
  descriptor: PresenterDescriptor,
): void;
export function getPresenterDescriptor(
  mode: string,
): PresenterDescriptor | undefined;
export function getRegisteredModes(): string[];
```

Built-in XR modes are registered inside `presenter-factory.ts` as module-level side effects (priorities: AR=40, VR=30, Inline=10). External packages register at their own entry point:

```typescript
// @iwsdk/map-presenter/src/index.ts
import { registerPresenterDescriptor } from '@iwsdk/core';

registerPresenterDescriptor('map', {
  priority: 20,
  factory: () => new MapPresenter(),
  isSupported: () => MapPresenter.isSupported(),
  createConfig: (opts) => ({
    backgroundColor: '#87CEEB',
    terrain: false,
    ...opts,
  }),
});
```

**`IPresenter.mode` is `string`** (not a closed enum) so external modes integrate naturally. `PresentationMode` enum covers only built-in modes and remains for convenience in application code.

### PresenterContext (Shared Rendering Infrastructure)

The `PresenterContext` owns the Three.js rendering infrastructure that persists across presenter switches:

```typescript
interface PresenterContext {
  readonly renderer: WebGLRenderer; // shared, never destroyed on mode switch
  readonly container: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  scene: Scene; // swapped per presenter (XR=Y-up, external may differ)
  camera: PerspectiveCamera | OrthographicCamera; // swapped per presenter
  readonly xrEnabled: boolean;
  dispose(): void; // only called on World disposal
}
```

**What is shared vs. swapped:**

- **Shared** (persists across switches): WebGLRenderer, DOM canvas, container
- **Swapped** (each presenter creates its own): Scene, Camera

### ContextRequirements (Presenter Specifications)

Each presenter declares its needs via `getRequirements()`:

```typescript
interface ContextRequirements {
  xrEnabled?: boolean;
  renderer?: {
    alpha?: boolean; // immutable after WebGL context creation
    antialias?: boolean; // immutable after WebGL context creation
    stencil?: boolean;
    multiviewStereo?: boolean; // Quest-specific
  };
  camera?: {
    type: ('perspective' | 'orthographic')[];
    fov?: number;
    near?: number;
    far?: number;
  };
  sceneUpAxis?: 'y' | 'z';
}
```

Example requirements:

- **XRPresenter**: `{ xrEnabled: true, renderer: { alpha: true, antialias: true }, camera: { type: ['perspective'] }, sceneUpAxis: 'y' }`
- **MapPresenter** (external): `{ xrEnabled: false, renderer: { alpha: true, antialias: true }, camera: { type: ['perspective', 'orthographic'] }, sceneUpAxis: 'z' }`

### ContextFactory (Context Reuse Logic)

The `ContextFactory` creates and manages `PresenterContext` instances. It reuses the renderer across mode switches whenever possible.

**Reuse rules:**

- Renderer CAN be reused if immutable WebGL context attributes match (alpha, antialias)
- Renderer CANNOT be reused if alpha or antialias differ (these are baked into the WebGL context at creation time)
- Mutable properties (xr.enabled, pixel ratio, size) are reconfigured on reuse
- **Design decision**: Renderer always created with `alpha: true` to guarantee reuse across all mode switches (including AR)

```
ContextFactory.getOrCreateContext(container, requirements)
  ├── Context exists and canReuse? → reconfigure() and return existing
  └── Otherwise → dispose old, createContext() with new requirements
```

### IPresenter Interface

```typescript
interface IPresenter {
  readonly mode: string; // string, not PresentationMode — allows external modes
  readonly state: Signal<PresenterState>;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly renderer: WebGLRenderer;

  getRequirements(): ContextRequirements;
  initialize(context: PresenterContext, config: PresenterConfig): Promise<void>;
  deactivate(): Object3D[]; // stop without disposing renderer; return content for migration
  stop(): Promise<void>;
  dispose(): void;

  getContentRoot(): Object3D;
  render(): void;
  // ... pointer events, flyTo, preUpdate, postUpdate, etc.
}
```

**Key methods:**

- `getRequirements()` — returns what this presenter needs from the context
- `initialize(context, config)` — receives a PresenterContext (does NOT create its own renderer); creates its own Scene/Camera and writes them back to the context
- `deactivate()` — graceful shutdown that preserves the shared renderer; returns content Object3Ds for migration to the next presenter

### Mode Switching Flow

When `world.switchMode(newMode)` is called:

```
1. newPresenter = createPresenter(newMode)      // uses registry
2. requirements = newPresenter.getRequirements()
3. contentObjects = oldPresenter.deactivate()   // stop old, get content
4. context = contextFactory.getOrCreateContext( // reuse or create renderer
     container, requirements)
5. await newPresenter.initialize(context, config)
6. world.scene = context.scene                  // update World references
7. world.camera = context.camera
8. for obj of contentObjects: newPresenter.addObject(obj, { isENU: true })
```

The old presenter's `deactivate()` does NOT dispose the renderer. The new presenter receives the same renderer instance (if requirements are compatible) and creates fresh Scene/Camera objects.

### Live Getters in Systems (Stale Reference Fix)

Systems access `this.scene`, `this.camera`, `this.renderer` as **live getters** that read from the World, not cached values. This ensures systems always see the current presenter's objects after a mode switch:

```typescript
// In system.ts — getters, not cached constructor assignments
get scene(): Scene { return this.world.scene; }
get camera(): PerspectiveCamera { return this.world.camera; }
get renderer(): WebGLRenderer { return this.world.renderer; }
```

### Built-in Presenter Implementations

**XRPresenter** (`xr-presenter.ts`):

- Handles WebXR session lifecycle (AR/VR/NonImmersive)
- Creates Y-up Scene, PerspectiveCamera
- Uses `renderer.xr` for immersive sessions
- Also implements `IGISPresenter` for geographic coordinate support in XR
- On deactivate: stops animation loop, collects scene children, does NOT dispose renderer

### External Presenter: @iwsdk/map-presenter

The Giro3D-based 2D/2.5D map presenter has been extracted to `~/Documents/repos/map-presenter` (`@iwsdk/map-presenter`). It is **not bundled with core**.

To use it:

```typescript
import '@iwsdk/map-presenter'; // registers 'map' mode as a side effect

const world = await World.create(container, {
  presenter: {
    mode: 'map',
    options: {
      crs: { code: 'EPSG:25833', proj4: '...' },
      origin: { lat: 51.05, lon: 13.74 },
      extent: { minX: 400000, maxX: 420000, minY: 5650000, maxY: 5670000 },
    },
  },
});

// Switch to AR later — renderer is reused, scene/camera swapped
await world.switchMode(PresentationMode.ImmersiveAR);
```

See the `@iwsdk/map-presenter` README for full documentation.

### Usage Example — Custom External Presenter

```typescript
// my-presenter-package/src/index.ts
import {
  registerPresenterDescriptor,
  type IPresenter,
  type PresenterContext,
  type PresenterConfig,
} from '@iwsdk/core';

class MyCustomPresenter implements IPresenter {
  readonly mode = 'my-mode';
  // ... implement full IPresenter interface
}

registerPresenterDescriptor('my-mode', {
  priority: 15,
  factory: () => new MyCustomPresenter(),
  isSupported: async () => true,
});

// App entry point
import 'my-presenter-package'; // triggers registration

const world = await World.create(container, {
  presenter: { mode: 'my-mode' },
});
```
