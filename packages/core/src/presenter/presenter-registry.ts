/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file presenter-registry.ts
 * @brief Registry for pluggable presenter implementations
 *
 * Enables external packages to register new presentation modes without
 * modifying IWSDK core. Built-in XR modes (AR, VR, Inline) are registered
 * in presenter-factory.ts at module initialization time.
 *
 * @example
 * ```ts
 * // In an external package (e.g. @iwsdk/map-presenter):
 * import { registerPresenterDescriptor } from '@iwsdk/core';
 *
 * registerPresenterDescriptor('map', {
 *   priority: 20,
 *   factory: () => new MapPresenter(),
 *   isSupported: () => MapPresenter.isSupported(),
 *   createConfig: (opts) => ({ backgroundColor: '#87CEEB', ...opts }),
 * });
 * ```
 *
 * @category Runtime
 */

import type { IPresenter, PresenterConfig } from './presenter.js';

/**
 * Describes a presenter mode that can be registered with the IWSDK.
 *
 * External packages implement and register this interface to add new
 * presentation modes to the World without modifying core.
 *
 * @category Runtime
 */
export interface PresenterDescriptor {
  /**
   * Instantiate a new presenter for this mode.
   *
   * Called by `createPresenter()` each time a presenter is needed.
   */
  factory(): IPresenter;

  /**
   * Async check: is this mode supported in the current browser/environment?
   *
   * Called by `getSupportedModes()`. Should resolve quickly without heavy loading.
   */
  isSupported(): Promise<boolean>;

  /**
   * Merge user options with mode-specific defaults to produce a full config.
   *
   * If omitted, only user-supplied options are passed through.
   */
  createConfig?(options?: Partial<PresenterConfig>): PresenterConfig;

  /**
   * Priority for `getBestMode()` ordering.
   *
   * Higher numbers are preferred first.
   * Built-in priorities: ImmersiveAR=40, ImmersiveVR=30, Inline=10.
   * Suggested range for external modes: 11–29.
   */
  priority?: number;
}

// Module-level registry — populated via registerPresenterDescriptor() calls.
const _registry = new Map<string, PresenterDescriptor>();

/**
 * Register a presenter descriptor for a mode string.
 *
 * Calling this twice for the same mode replaces the previous descriptor.
 * External packages should call this as a side effect of their entry-point import.
 *
 * @param mode - Mode string identifier (e.g. `'map'`, `'immersive-ar'`)
 * @param descriptor - Descriptor object implementing the presenter lifecycle
 *
 * @category Runtime
 */
export function registerPresenterDescriptor(
  mode: string,
  descriptor: PresenterDescriptor,
): void {
  _registry.set(mode, descriptor);
}

/**
 * Retrieve the descriptor for a registered mode string.
 *
 * Returns `undefined` if the mode has not been registered.
 *
 * @category Runtime
 */
export function getPresenterDescriptor(
  mode: string,
): PresenterDescriptor | undefined {
  return _registry.get(mode);
}

/**
 * Return all currently registered mode strings in registration order.
 *
 * @category Runtime
 */
export function getRegisteredModes(): string[] {
  return Array.from(_registry.keys());
}
