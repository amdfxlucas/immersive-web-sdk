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
├── Scene (Three.js)
├── Camera
├── Renderer (WebGLRenderer + WebXR support)
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

## CURRENT DEVELOPMENT TASK: Presenter Abstraction for iwsdk/core

i imagine a GIS system in the spirit of MVC(Model-view-controller) where the state of an ECS(entity-component-system) world (the datamodel) is presented or rendered in different modes (Views) like i.e. WebXR 3D Threejs scene(what we have now) or Giro3d 2,5D MapView. 
For Giro3D look here: https://gitlab.com/giro3d/giro3d/-/tree/main/src?ref_type=heads
My most important requirement being that the Presenters(or Views) are subordinate to the ECS world, and populate their scene-graph according to the world's (common /shared-between views) specification/current state. Also its crucial that the identity of individual entities/features from the ECS world is kept. So that i.e. individual parcel remains pickable(by whatever means the presenters implement this ). From the superordinate main-application's point of view, it only has to assume the responsibility of loading features into the ecs world and provide a div-container to the presenter manager, and 'automatically' have them rendererd by the selected presenter. Any user interaction, e.g. 'click's are communicated by the presenter in form of 'Tag'-components such as Hovered or Pressed, which are added to the affected entities(i..e parcel) or transient 'ActionEntities' like 'MouseClick's which are added to the 'world', for other systems to react on.

Core Changes
1. IPresenter Interface (presenter.ts)
Defines the contract that all presenters implement, including scene/camera/renderer access, coordinate transforms, input handling, and render loop hooks.
2. XRPresenter (xr-presenter.ts)
Implements IPresenter for WebXR modes (AR/VR). This encapsulates the existing IWSDK rendering setup while conforming to the presenter interface.
3. MapPresenter (map-presenter.ts)
Implements IPresenter for Giro3D-based 2D/2.5D map viewing. Automatically wraps ENU-centered geometry with offset transforms to position it correctly in CRS space.
4. World (world-with-presenter.ts)
Modified World class that:

Delegates rendering to the active presenter
Provides world.launch(mode) instead of world.launchXR()
Supports world.switchMode(newMode) for runtime mode changes
Proxies scene, camera, renderer through the presenter

5. createSystem (system-with-presenter.ts)
Modified system factory that gives systems:

this.presenter - direct access to IPresenter
this.scene/camera/renderer - proxied from presenter (backward compatible)
this.geographicToScene() / this.sceneToGeographic() - coordinate helpers
this.notifyChange() - for Map mode's on-demand rendering

Key API Changes
BeforeAfterworld.launchXR()world.launch(PresentationMode.ImmersiveAR)N/Aworld.launch(PresentationMode.Map)N/Aworld.switchMode(mode)world.getActiveRoot()world.getContentRoot()Direct coordinate mathsystem.geographicToScene({ lat, lon })
Usage Example
typescript// Create world with Map mode
const world = await World.create(container, {
  presentation: {
    mode: PresentationMode.Map,
    crs: { code: 'EPSG:25833', proj4: '...' },
    origin: { lat: 51.05, lon: 13.74 },
  }
});

// Later, switch to AR
await world.switchMode(PresentationMode.ImmersiveAR);

// Systems work unchanged - they access scene via presenter
class MySystem extends createSystem({ ... }) {
  update(delta) {
    const pos = this.geographicToScene({ lat: 51, lon: 13 });
    this.scene.traverse(...); // Works in any mode
  }
}
This iteration moves the presenter into the heart of the system, making mode-switching a first-class capability while maintaining backward compatibility with existing system code.