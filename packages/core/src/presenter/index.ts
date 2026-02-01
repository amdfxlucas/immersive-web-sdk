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
 * - **Map Mode**: 2D/2.5D geographic map view using Giro3D
 * - **Inline Mode**: Non-immersive 3D view in browser
 *
 * Systems interact with the presenter API rather than raw Three.js objects,
 * enabling seamless mode switching without changing system code.
 *
 * @module presenter
 * @category Runtime
 *
 * @example
 * ```ts
 * import {
 *   PresentationMode,
 *   createPresenter,
 *   getSupportedModes
 * } from '@iwsdk/core';
 *
 * // Check available modes
 * const modes = await getSupportedModes();
 *
 * // Create a map presenter
 * const presenter = createPresenter(PresentationMode.Map);
 * await presenter.initialize(container, {
 *   crs: { code: 'EPSG:25833', proj4: '...' },
 *   origin: { lat: 51.05, lon: 13.74 }
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
  type GeographicCoords,
  type ProjectCRS,
  type PointerEventData,
  type FlyToOptions,
  type XRPresenterOptions,
  type MapPresenterOptions,
  type PresenterFactory,

  // Types
  type PointerEventType,
  type PointerCallback,
} from './presenter.js';

// ============================================================================
// PRESENTER IMPLEMENTATIONS
// ============================================================================

export { XRPresenter } from './xr-presenter.js';
export { MapPresenter } from './map-presenter.js';

// ============================================================================
// COORDINATE ADAPTER
// ============================================================================

export { CoordinateAdapter } from './coordinate-adapter.js';

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
