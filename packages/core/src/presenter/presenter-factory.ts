/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file presenter-factory.ts
 * @brief Factory functions for creating and managing presenters
 *
 * Provides a unified way to create the appropriate presenter for
 * the requested mode, with automatic fallback handling and mode
 * capability detection.
 *
 * @category Runtime
 */

import {
  IPresenter,
  MapPresenterOptions,
  PresentationMode,
  PresenterConfig,
  XRPresenterOptions,
} from './presenter.js';
import { XRPresenter } from './xr-presenter.js';
import { MapPresenter } from './map-presenter.js';

/**
 * Create a presenter for the specified mode
 *
 * Factory function that instantiates the appropriate presenter class
 * based on the requested presentation mode.
 *
 * @param mode - The presentation mode to create
 * @param options - Mode-specific options (optional)
 * @returns The created presenter instance
 *
 * @example
 * ```ts
 * // Create an AR presenter
 * const arPresenter = createPresenter(PresentationMode.ImmersiveAR);
 *
 * // Create a map presenter with options
 * const mapPresenter = createPresenter(PresentationMode.Map, {
 *   crs: { code: 'EPSG:25833', proj4: '...' },
 *   origin: { lat: 51.05, lon: 13.74 }
 * });
 * ```
 *
 * @category Runtime
 */
export function createPresenter(
  mode: PresentationMode,
  options?: PresenterConfig,
): IPresenter {
  switch (mode) {
    case PresentationMode.ImmersiveAR:
      return new XRPresenter(PresentationMode.ImmersiveAR);

    case PresentationMode.ImmersiveVR:
      return new XRPresenter(PresentationMode.ImmersiveVR);

    case PresentationMode.Map:
      return new MapPresenter();

    case PresentationMode.Inline:
      // Inline mode uses XRPresenter without XR session
      return new XRPresenter(PresentationMode.Inline);

    default:
      throw new Error(`Unknown presentation mode: ${mode}`);
  }
}

/**
 * Check which presentation modes are supported in the current environment
 *
 * Queries the browser for WebXR support and checks for Giro3D availability.
 *
 * @returns Promise resolving to array of supported modes
 *
 * @example
 * ```ts
 * const modes = await getSupportedModes();
 * console.log('Supported modes:', modes);
 * // ['inline', 'immersive-vr', 'map']
 * ```
 *
 * @category Runtime
 */
export async function getSupportedModes(): Promise<PresentationMode[]> {
  const modes: PresentationMode[] = [];

  // Inline mode is always supported
  modes.push(PresentationMode.Inline);

  // Check XR support
  if (typeof navigator !== 'undefined' && navigator.xr) {
    try {
      if (await navigator.xr.isSessionSupported('immersive-vr')) {
        modes.push(PresentationMode.ImmersiveVR);
      }
    } catch {
      // VR not supported
    }

    try {
      if (await navigator.xr.isSessionSupported('immersive-ar')) {
        modes.push(PresentationMode.ImmersiveAR);
      }
    } catch {
      // AR not supported
    }
  }

  // Check Giro3D support
  if (await MapPresenter.isSupported()) {
    modes.push(PresentationMode.Map);
  }

  return modes;
}

/**
 * Get the best available presentation mode
 *
 * Returns the preferred mode if supported, otherwise falls back to the
 * most capable available mode.
 *
 * Priority order (when no preference):
 * 1. ImmersiveAR (if supported)
 * 2. ImmersiveVR (if supported)
 * 3. Map (if supported)
 * 4. Inline (always available)
 *
 * @param preferred - Optional preferred mode
 * @returns Promise resolving to the best available mode
 *
 * @example
 * ```ts
 * // Get best mode without preference
 * const mode = await getBestMode();
 *
 * // Get best mode with AR preference
 * const mode = await getBestMode(PresentationMode.ImmersiveAR);
 * ```
 *
 * @category Runtime
 */
export async function getBestMode(
  preferred?: PresentationMode,
): Promise<PresentationMode> {
  const supported = await getSupportedModes();

  // If preferred mode is supported, use it
  if (preferred && supported.includes(preferred)) {
    return preferred;
  }

  // Otherwise, return the most capable supported mode
  const priority = [
    PresentationMode.ImmersiveAR,
    PresentationMode.ImmersiveVR,
    PresentationMode.Map,
    PresentationMode.Inline,
  ];

  for (const mode of priority) {
    if (supported.includes(mode)) {
      return mode;
    }
  }

  // Inline is always available as fallback
  return PresentationMode.Inline;
}

/**
 * Create presenter configuration with sensible defaults
 *
 * Merges user options with mode-specific default values.
 *
 * @param mode - Presentation mode
 * @param options - User-provided options
 * @returns Complete configuration object
 *
 * @example
 * ```ts
 * const config = createPresenterConfig(PresentationMode.Map, {
 *   origin: { lat: 51.05, lon: 13.74 }
 * });
 * ```
 *
 * @category Runtime
 */
export function createPresenterConfig(
  mode: PresentationMode,
  options?: Partial<PresenterConfig>,
): PresenterConfig {
  const baseConfig: PresenterConfig = {
    crs: options?.crs,
    origin: options?.origin,
    extent: options?.extent,
  };

  switch (mode) {
    case PresentationMode.ImmersiveAR: {
      const xrConfig: XRPresenterOptions = {
        ...baseConfig,
        sessionMode: 'immersive-ar',
        referenceSpace: 'local-floor',
        features: {
          handTracking: true,
          anchors: true,
          hitTest: true,
        },
        fov: 50,
        near: 0.1,
        far: 200,
      };
      return xrConfig;
    }

    case PresentationMode.ImmersiveVR: {
      const xrConfig: XRPresenterOptions = {
        ...baseConfig,
        sessionMode: 'immersive-vr',
        referenceSpace: 'local-floor',
        features: {
          handTracking: true,
        },
        fov: 50,
        near: 0.1,
        far: 200,
      };
      return xrConfig;
    }

    case PresentationMode.Map: {
      const mapConfig: MapPresenterOptions = {
        ...baseConfig,
        backgroundColor: '#87CEEB',
        enableTerrain: false,
        initialAltitude: 500,
      };
      return mapConfig;
    }

    case PresentationMode.Inline: {
      const inlineConfig: XRPresenterOptions = {
        ...baseConfig,
        fov: 50,
        near: 0.1,
        far: 200,
      };
      return inlineConfig;
    }

    default:
      return baseConfig;
  }
}

/**
 * Check if a specific presentation mode is supported
 *
 * @param mode - Mode to check
 * @returns Promise resolving to whether mode is supported
 *
 * @category Runtime
 */
export async function isModeSupported(
  mode: PresentationMode,
): Promise<boolean> {
  const supported = await getSupportedModes();
  return supported.includes(mode);
}
