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
 * Provides a unified way to create the appropriate presenter for the requested
 * mode, with automatic fallback handling and mode capability detection.
 *
 * Presenter implementations are registered via the PresenterRegistry. Built-in
 * XR modes (ImmersiveAR, ImmersiveVR, Inline) are registered at the bottom of
 * this file as module-level side effects. External packages (e.g. @iwsdk/map-presenter)
 * register additional modes by calling `registerPresenterDescriptor` from their
 * own entry point.
 *
 * @category Runtime
 */

import {
  registerPresenterDescriptor,
  getPresenterDescriptor,
  getRegisteredModes,
} from './presenter-registry.js';
import {
  type IPresenter,
  PresentationMode,
  type PresenterConfig,
  type XRPresenterOptions,
} from './presenter.js';
import { XRPresenter } from './xr-presenter.js';

// Re-export PresenterDescriptor and registry functions so consumers only need
// to import from this module (or from presenter/index.ts).
export {
  registerPresenterDescriptor,
  getPresenterDescriptor,
  getRegisteredModes,
  type PresenterDescriptor,
} from './presenter-registry.js';

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Create a presenter for the specified mode.
 *
 * The mode must have been registered via `registerPresenterDescriptor` before
 * this function is called. Built-in XR modes are auto-registered when this
 * module is imported. External modes (e.g. `'map'`) require their package to
 * be imported first (side-effect import).
 *
 * @param mode - The presentation mode string
 * @returns The created presenter instance
 * @throws If `mode` has not been registered
 *
 * @example
 * ```ts
 * import '@iwsdk/map-presenter'; // registers 'map'
 * const presenter = createPresenter('map');
 * ```
 *
 * @category Runtime
 */
export function createPresenter(mode: string): IPresenter {
  const descriptor = getPresenterDescriptor(mode);
  if (!descriptor) {
    throw new Error(
      `Unknown presentation mode: "${mode}". ` +
        `Registered modes: [${getRegisteredModes().join(', ')}]. ` +
        `Did you forget to import the presenter package?`,
    );
  }
  return descriptor.factory();
}

/**
 * Check which presentation modes are supported in the current environment.
 *
 * Queries every registered presenter descriptor's `isSupported()` method in
 * parallel, then returns supported modes sorted by priority (highest first).
 *
 * @returns Promise resolving to array of supported mode strings
 *
 * @example
 * ```ts
 * const modes = await getSupportedModes();
 * console.log('Supported modes:', modes);
 * // ['immersive-ar', 'immersive-vr', 'inline']
 * ```
 *
 * @category Runtime
 */
export async function getSupportedModes(): Promise<string[]> {
  const modes: string[] = [];
  await Promise.all(
    getRegisteredModes().map(async (mode) => {
      if (await getPresenterDescriptor(mode)!.isSupported()) {
        modes.push(mode);
      }
    }),
  );
  // Sort by priority descending so callers get a deterministic ordered list
  modes.sort(
    (a, b) =>
      (getPresenterDescriptor(b)?.priority ?? 0) -
      (getPresenterDescriptor(a)?.priority ?? 0),
  );
  return modes;
}

/**
 * Get the best available presentation mode.
 *
 * Returns the preferred mode if supported; otherwise returns the highest-priority
 * registered mode that is available. Falls back to `'inline'` if nothing else
 * is available.
 *
 * @param preferred - Optional preferred mode string
 * @returns Promise resolving to the best available mode
 *
 * @example
 * ```ts
 * const mode = await getBestMode(PresentationMode.ImmersiveAR);
 * ```
 *
 * @category Runtime
 */
export async function getBestMode(preferred?: string): Promise<string> {
  const supported = await getSupportedModes(); // already sorted by priority desc
  if (preferred && supported.includes(preferred)) {
    return preferred;
  }
  return supported[0] ?? PresentationMode.Inline;
}

/**
 * Create presenter configuration with sensible defaults for the given mode.
 *
 * Delegates to the descriptor's `createConfig()` if present, otherwise passes
 * user options through unchanged.
 *
 * @param mode - Presentation mode string
 * @param options - User-provided options (merged with mode defaults)
 * @returns Complete configuration object
 *
 * @category Runtime
 */
export function createPresenterConfig(
  mode: string,
  options?: Partial<PresenterConfig>,
): PresenterConfig {
  const descriptor = getPresenterDescriptor(mode);
  if (descriptor?.createConfig) {
    return descriptor.createConfig(options);
  }
  return (options ?? {}) as PresenterConfig;
}

/**
 * Check if a specific presentation mode is supported.
 *
 * @param mode - Mode to check
 * @returns Promise resolving to whether mode is supported
 *
 * @category Runtime
 */
export async function isModeSupported(mode: string): Promise<boolean> {
  const supported = await getSupportedModes();
  return supported.includes(mode);
}

// ============================================================================
// BUILT-IN REGISTRATIONS
// These run at module-load time. Any import of this file (directly or via
// presenter/index.ts) will trigger these registrations, ensuring the built-in
// XR modes are always available without an explicit bootstrap call.
// ============================================================================

registerPresenterDescriptor(PresentationMode.ImmersiveAR, {
  priority: 40,
  factory: () => new XRPresenter(PresentationMode.ImmersiveAR),
  isSupported: async () => {
    if (typeof navigator === 'undefined' || !navigator.xr) {
      return false;
    }
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  },
  createConfig: (options?) =>
    ({
      ...options,
      sessionMode: 'immersive-ar',
      referenceSpace: 'local-floor',
      features: { handTracking: true, anchors: true, hitTest: true },
      fov: 50,
      near: 0.1,
      far: 200,
    }) as XRPresenterOptions,
});

registerPresenterDescriptor(PresentationMode.ImmersiveVR, {
  priority: 30,
  factory: () => new XRPresenter(PresentationMode.ImmersiveVR),
  isSupported: async () => {
    if (typeof navigator === 'undefined' || !navigator.xr) {
      return false;
    }
    try {
      return await navigator.xr.isSessionSupported('immersive-vr');
    } catch {
      return false;
    }
  },
  createConfig: (options?) =>
    ({
      ...options,
      sessionMode: 'immersive-vr',
      referenceSpace: 'local-floor',
      features: { handTracking: true },
      fov: 50,
      near: 0.1,
      far: 200,
    }) as XRPresenterOptions,
});

registerPresenterDescriptor(PresentationMode.Inline, {
  priority: 10,
  factory: () => new XRPresenter(PresentationMode.Inline),
  isSupported: async () => true, // always supported
  createConfig: (options?) =>
    ({
      ...options,
      fov: 50,
      near: 0.1,
      far: 200,
    }) as XRPresenterOptions,
});
