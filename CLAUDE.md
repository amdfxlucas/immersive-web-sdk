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

The Presenter abstraction follows an MVC-inspired pattern where the ECS World is the data model, and Presenters are interchangeable views that render the world's state in different modes (WebXR 3D, Giro3D 2.5D map, etc.).

**Design principles:**

- Presenters are subordinate to the ECS World — they render whatever the World contains
- Entity identity is preserved across presenter switches (a parcel entity remains the same entity regardless of view)
- User interactions (clicks, hovers) are communicated back to the ECS as Tag components (Hovered, Pressed) on affected entities
- Applications only load features into the World and provide a container div; rendering is handled automatically by the active presenter

### Key Files

```
/presenter
├── presenter.ts            - IPresenter interface, PresentationMode enum, config types
├── presenter-context.ts    - PresenterContext, ContextRequirements, ContextFactory
├── xr-presenter.ts         - WebXR (AR/VR) presenter implementation
├── map-presenter.ts        - Giro3D 2D/2.5D map presenter implementation
├── presenter-factory.ts    - createPresenter(), getSupportedModes(), getBestMode()
├── gis-presenter.ts        - IGISPresenter interface for geographic coordinate support
├── gis-root-component.ts   - GISRootComponent for CRS/origin metadata
├── coordinate-adapter.ts   - ENU ↔ Geographic ↔ CRS coordinate transforms
├── map3d_components/       - MapLayerComponent, MapDataSourceComponent, FeatureSource
└── index.ts                - Module exports
```

### PresenterContext (Shared Rendering Infrastructure)

The `PresenterContext` owns the Three.js rendering infrastructure that persists across presenter switches:

```typescript
interface PresenterContext {
  readonly renderer: WebGLRenderer; // shared, never destroyed on mode switch
  readonly container: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  scene: Scene; // swapped per presenter (XR=Y-up, Map=Z-up)
  camera: PerspectiveCamera | OrthographicCamera; // swapped per presenter
  readonly xrEnabled: boolean;
  dispose(): void; // only called on World disposal
}
```

**What is shared vs. swapped:**

- **Shared** (persists across switches): WebGLRenderer, DOM canvas, container
- **Swapped** (each presenter creates its own): Scene (XR uses Y-up, Map uses Z-up), Camera

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
- **MapPresenter**: `{ xrEnabled: false, renderer: { alpha: true, antialias: true }, camera: { type: ['perspective', 'orthographic'] }, sceneUpAxis: 'z' }`

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
  readonly mode: PresentationMode;
  readonly state: PresenterState;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera | OrthographicCamera;
  readonly renderer: WebGLRenderer;

  getRequirements(): ContextRequirements;
  initialize(context: PresenterContext, config: PresenterConfig): Promise<void>;
  deactivate(): Object3D[]; // stop without disposing renderer; return content for migration
  stop(): void;
  dispose(): void;

  getContentRoot(): Object3D;
  render(delta: number): void;
  resize(width: number, height: number): void;
  // ... pointer events, flyTo, etc.
}
```

**Key methods:**

- `getRequirements()` — returns what this presenter needs from the context
- `initialize(context, config)` — receives a PresenterContext (does NOT create its own renderer); creates its own Scene/Camera and writes them back to the context
- `deactivate()` — graceful shutdown that preserves the shared renderer; returns content Object3Ds for migration to the next presenter

### Mode Switching Flow

When `world.switchMode(newMode)` is called:

```
1. newPresenter = createPresenter(newMode)
2. requirements = newPresenter.getRequirements()
3. contentObjects = oldPresenter.deactivate()       // stop old, get content
4. context = contextFactory.getOrCreateContext(      // reuse or create renderer
     container, requirements)
5. await newPresenter.initialize(context, config)    // start new presenter
6. world.scene = context.scene                       // update World references
7. world.camera = context.camera
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

### Giro3D Integration (ownsRenderer)

The Giro3D fork's `C3DEngine` accepts an `ownsRenderer: boolean` option (default `true`). When `ownsRenderer: false`:

- `C3DEngine.dispose()` skips `renderer.dispose()` and canvas removal
- This allows MapPresenter to safely deactivate without destroying the shared WebGLRenderer
- Set via `new Instance(domElement, { renderer: context.renderer, ownsRenderer: false })`

### Presenter Implementations

**XRPresenter** (`xr-presenter.ts`):

- Handles WebXR session lifecycle (AR/VR/NonImmersive)
- Creates Y-up Scene, PerspectiveCamera
- Uses `renderer.xr` for immersive sessions
- On deactivate: stops animation loop, collects scene children, does NOT dispose renderer

**MapPresenter** (`map-presenter.ts`):

- Wraps Giro3D Instance for 2D/2.5D geographic map viewing
- Creates Z-up Scene via Giro3D, with Perspective or Orthographic camera
- Wraps ENU-centered geometry in offset transforms for CRS positioning
- Uses FeatureSource with rbush spatial index for efficient tile-based feature queries
- On deactivate: unwraps ENU objects, collects content, disposes Giro3D (but NOT the shared renderer)

### Usage Example

```typescript
// Create world with Map mode
const world = await World.create(container, {
  presentation: {
    mode: PresentationMode.Map,
    crs: { code: 'EPSG:25833', proj4: '...' },
    origin: { lat: 51.05, lon: 13.74 },
  },
});

// Later, switch to AR — renderer is reused, scene/camera swapped
await world.switchMode(PresentationMode.ImmersiveAR);

// Systems work unchanged — live getters always return current scene/camera
class MySystem extends createSystem({ ... }) {
  update(delta) {
    const pos = this.geographicToScene({ lat: 51, lon: 13 });
    this.scene.traverse(...); // Works in any mode
  }
}
```
