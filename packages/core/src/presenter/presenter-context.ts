/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file presenter-context.ts
 * @brief Shared rendering context that persists across presenter switches.
 *
 * The PresenterContext owns the WebGLRenderer and its DOM canvas.
 * Scene and Camera are swapped per presenter (XR uses Y-up, Map uses Z-up)
 * but the renderer is shared and reused across mode switches.
 *
 * @category Runtime
 */

import { PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three';
import type { OrthographicCamera } from 'three';

/**
 * Shared Three.js rendering infrastructure that persists across presenter switches.
 *
 * The renderer and canvas are shared across all presenters. Scene and Camera
 * are swapped when the active presenter changes (since XR uses Y-up and Map uses Z-up).
 *
 * @category Runtime
 */
export interface PresenterContext {
  /** The shared WebGL renderer (never destroyed during mode switches) */
  readonly renderer: WebGLRenderer;

  /** The DOM container element */
  readonly container: HTMLDivElement;

  /** The renderer's canvas element */
  readonly canvas: HTMLCanvasElement;

  /**
   * The current Scene. Swapped per presenter because XR uses Y-up
   * and Map uses Z-up coordinate systems.
   */
  scene: Scene;

  /**
   * The current Camera. May change type between presenters
   * (PerspectiveCamera for XR, Perspective or Orthographic for Map).
   */
  camera: PerspectiveCamera | OrthographicCamera;

  /** Whether XR is enabled on the renderer */
  readonly xrEnabled: boolean;

  /** Dispose the context (only called on World disposal, never on mode switch) */
  dispose(): void;
}

/**
 * Declares what a presenter needs from the rendering context.
 *
 * Used by the ContextFactory to determine if an existing context can be reused
 * or needs to be recreated.
 *
 * @category Runtime
 */
export interface ContextRequirements {
  /** Whether the renderer must have XR enabled */
  xrEnabled?: boolean;

  /** Required renderer capabilities */
  renderer?: {
    /** Need alpha channel (transparent background for AR). Immutable after creation. */
    alpha?: boolean;
    /** Need antialiasing. Immutable after creation. */
    antialias?: boolean;
    /** Need stencil buffer */
    stencil?: boolean;
    /** Need multiview stereo (Quest-specific) */
    multiviewStereo?: boolean;
  };

  /** Camera requirements */
  camera?: {
    /** Acceptable camera types */
    type: ('perspective' | 'orthographic')[];
    /** Field of view (perspective only) */
    fov?: number;
    /** Near clipping plane */
    near?: number;
    /** Far clipping plane */
    far?: number;
  };

  /** Whether the scene coordinate system is Y-up (Three.js default) or Z-up (Giro3D) */
  sceneUpAxis?: 'y' | 'z';
}

/**
 * Factory for creating and managing PresenterContext instances.
 *
 * Handles context lifecycle and reuse logic. The renderer is reused across
 * presenter switches whenever possible (i.e., when immutable WebGL context
 * attributes like alpha and antialias match).
 *
 * @category Runtime
 */
export class ContextFactory {
  private _context: PresenterContext | null = null;

  /**
   * Get or create a context that satisfies the given requirements.
   *
   * Reuse logic:
   * 1. If no context exists, create one
   * 2. If context exists and renderer satisfies requirements, reuse it
   *    (scene and camera will be swapped by the presenter)
   * 3. If renderer requirements are incompatible (e.g., alpha mismatch),
   *    dispose old context and create new one
   */
  getOrCreateContext(
    container: HTMLDivElement,
    requirements: ContextRequirements,
  ): PresenterContext {
    if (this._context && this.canReuse(this._context, requirements)) {
      this.reconfigure(this._context, requirements);
      return this._context;
    }

    // Must create new context
    if (this._context) {
      this._context.dispose();
    }
    this._context = this.createContext(container, requirements);
    return this._context;
  }

  /** Get the current context (if any) */
  get context(): PresenterContext | null {
    return this._context;
  }

  /** Dispose the current context */
  dispose(): void {
    if (this._context) {
      this._context.dispose();
      this._context = null;
    }
  }

  /**
   * Check if an existing context can satisfy new requirements.
   *
   * The renderer can be reused if immutable WebGL context attributes match:
   * - alpha (cannot change after creation)
   * - antialias (cannot change after creation)
   *
   * These CAN be changed on an existing renderer:
   * - xr.enabled (toggle on/off)
   * - pixel ratio, size
   */
  private canReuse(
    context: PresenterContext,
    requirements: ContextRequirements,
  ): boolean {
    const gl = context.renderer.getContext();
    const contextAttrs = gl.getContextAttributes();

    if (
      requirements.renderer?.alpha !== undefined &&
      requirements.renderer.alpha !== contextAttrs?.alpha
    ) {
      return false;
    }
    if (
      requirements.renderer?.antialias !== undefined &&
      requirements.renderer.antialias !== contextAttrs?.antialias
    ) {
      return false;
    }

    return true;
  }

  /**
   * Reconfigure mutable properties on an existing context.
   */
  private reconfigure(
    context: PresenterContext,
    requirements: ContextRequirements,
  ): void {
    if (requirements.xrEnabled !== undefined) {
      context.renderer.xr.enabled = requirements.xrEnabled;
    }
  }

  /**
   * Create a new PresenterContext with a fresh WebGLRenderer.
   */
  private createContext(
    container: HTMLDivElement,
    requirements: ContextRequirements,
  ): PresenterContext {
    const renderer = new WebGLRenderer({
      antialias: requirements.renderer?.antialias ?? true,
      alpha: true, // always true to guarantee reuse across AR/non-AR switches
      // @ts-ignore - multiviewStereo is a Quest-specific extension
      multiviewStereo: requirements.renderer?.multiviewStereo ?? false,
    });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(
      container.clientWidth || window.innerWidth,
      container.clientHeight || window.innerHeight,
    );
    renderer.outputColorSpace = SRGBColorSpace;

    if (requirements.xrEnabled) {
      renderer.xr.enabled = true;
    }

    container.appendChild(renderer.domElement);

    // Scene and camera are placeholders; the presenter fills them in during initialize()
    const scene = new Scene();
    const camera = new PerspectiveCamera(
      requirements.camera?.fov ?? 50,
      (container.clientWidth || window.innerWidth) /
        (container.clientHeight || window.innerHeight),
      requirements.camera?.near ?? 0.1,
      requirements.camera?.far ?? 200,
    );

    const ctx: PresenterContext = {
      renderer,
      container,
      canvas: renderer.domElement,
      scene,
      camera,
      get xrEnabled() {
        return renderer.xr.enabled;
      },
      dispose() {
        renderer.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      },
    };

    return ctx;
  }
}
