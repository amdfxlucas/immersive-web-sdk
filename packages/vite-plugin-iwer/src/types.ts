/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Synthetic Environment Module configuration
 */
export interface SEMOptions {
  /**
   * Default scene to load
   * @default 'living_room'
   */
  defaultScene?:
    | 'living_room'
    | 'meeting_room'
    | 'music_room'
    | 'office_large'
    | 'office_small';
}

export type AiTool = 'claude' | 'cursor' | 'copilot' | 'codex';

/**
 * MCP (Model Context Protocol) configuration
 * Enables AI agent control of the IWER runtime via WebSocket
 */
export interface MCPOptions {
  /**
   * Override the Vite dev server port used for the MCP WebSocket connection.
   * If not specified, the actual Vite dev server port is auto-detected.
   * You should NOT normally need to set this.
   */
  port?: number;

  /**
   * Enable verbose logging for MCP operations
   * @default false
   */
  verbose?: boolean;

  /**
   * Which AI tools to generate MCP config files for.
   * @default ['claude', 'cursor', 'copilot', 'codex']
   */
  tools?: AiTool[];
}

/**
 * Main plugin options interface
 */
export interface IWERPluginOptions {
  /**
   * XR device to emulate
   * @default 'metaQuest3'
   */
  device?: 'metaQuest2' | 'metaQuest3' | 'metaQuestPro' | 'oculusQuest1';

  /**
   * Synthetic Environment Module configuration
   * If undefined, SEM is not activated
   */
  sem?: SEMOptions;

  /**
   * MCP (Model Context Protocol) configuration
   * Enables AI agent control of the IWER runtime via WebSocket
   * If undefined, MCP is not activated
   */
  mcp?: MCPOptions | boolean;

  /**
   * Inject script during build phase (in addition to dev)
   * @default false
   */
  injectOnBuild?: boolean;

  /**
   * When to activate the WebXR emulation
   * 'localhost' - only activate when running on localhost (127.0.0.1, localhost)
   * 'always' - always activate the emulation
   * RegExp - activate when hostname matches the provided regex pattern
   * @default 'localhost'
   */
  activation?: 'localhost' | 'always' | RegExp;

  /**
   * Enable verbose logging
   * @default false
   */
  verbose?: boolean;

  /**
   * User-Agent exception pattern. If the UA matches this RegExp, the
   * runtime will NOT be injected even if activation passes.
   * Useful to avoid injecting on real XR browsers like OculusBrowser.
   * @default /OculusBrowser/
   */
  userAgentException?: RegExp;
}

/**
 * Internal processed options with all defaults applied
 */
export interface ProcessedIWEROptions {
  device: 'metaQuest2' | 'metaQuest3' | 'metaQuestPro' | 'oculusQuest1';
  sem?: {
    defaultScene: string;
  };
  mcp?: {
    port?: number;
    verbose: boolean;
    tools: AiTool[];
  };
  injectOnBuild: boolean;
  activation: 'localhost' | 'always' | RegExp;
  verbose: boolean;
  userAgentException?: RegExp | string;
}

/**
 * IWER injection bundle result
 */
export interface InjectionBundleResult {
  code: string;
  size: number;
}
