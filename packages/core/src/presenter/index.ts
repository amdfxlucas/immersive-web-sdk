/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file presenter/index.ts
 * @brief Presenter module exports
 *
 * The Presenter abstraction enables the IWSDK World to support multiple
 * rendering modes:
 *
 * - **XR Mode**: WebXR-based immersive AR/VR rendering
 * - **Inline Mode**: Non-immersive 3D view in browser
 * - **Custom Modes**: External packages can register new modes via
 *   `registerPresenterDescriptor` (e.g. `@iwsdk/map-presenter` adds `'map'`)
 *
 * Systems interact with the presenter API rather than raw Three.js objects,
 * enabling seamless mode switching without changing system code.
 *
 * @module presenter
 * @category Runtime
 *
 * @example
 * ```ts
 * import { PresentationMode, createPresenter, getSupportedModes } from '@iwsdk/core';
 *
 * // Check available modes
 * const modes = await getSupportedModes();
 *
 * // Create a VR presenter
 * const presenter = createPresenter(PresentationMode.ImmersiveVR);
 * ```
 *
 * @example Registering an external presenter
 * ```ts
 * // External package entry point
 * import { registerPresenterDescriptor } from '@iwsdk/core';
 *
 * registerPresenterDescriptor('my-mode', {
 *   priority: 15,
 *   factory: () => new MyPresenter(),
 *   isSupported: async () => true,
 * });
 * ```
 */

// ============================================================================
// TYPES AND INTERFACES
// ============================================================================

export {
  // Enums
  PresentationMode,
  PresenterState,

  // Interfaces
  type IPresenter,
  type PresenterConfig,
  type PointerEventData,
  type FlyToOptions,
  type XRPresenterOptions,
  type PresenterFactory,

  // Types
  type PointerEventType,
  type PointerCallback,
} from './presenter.js';

// Context types
export {
  type PresenterContext,
  type ContextRequirements,
  ContextFactory,
} from './presenter-context.js';

// GIS-specific types and interfaces (used by XRPresenter too)
export {
  type IGISPresenter,
  type GeographicCoords,
  type ProjectCRS,
  type CRSExtent,
  type FitToExtentOptions,
  isGISPresenter,
  crsFromBBox,
} from './gis-presenter.js';

// GIS Root Component
export {
  GISRootComponent,
  type GISRootComponentType,
} from './gis-root-component.js';

// ============================================================================
// PRESENTER IMPLEMENTATIONS
// ============================================================================

export { XRPresenter } from './xr-presenter.js';

// ============================================================================
// COORDINATE ADAPTER
// ============================================================================

export { CoordinateAdapter } from './coordinate-adapter.js';

// ============================================================================
// PRESENTER REGISTRY (extension API)
// ============================================================================

export {
  registerPresenterDescriptor,
  getPresenterDescriptor,
  getRegisteredModes,
  type PresenterDescriptor,
} from './presenter-registry.js';

// ============================================================================
// FACTORY FUNCTIONS
// ============================================================================

export {
  createPresenter,
  getSupportedModes,
  getBestMode,
  createPresenterConfig,
  isModeSupported,
} from './presenter-factory.js';
