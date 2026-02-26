/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { spawn, type ChildProcess } from 'child_process';
import { existsSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import * as path from 'path';
import type { Plugin, ResolvedConfig, ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { buildInjectionBundle } from './injection-bundler.js';
import { createRelayHandler } from './mcp-relay.js';
import type {
  IWERPluginOptions,
  ProcessedIWEROptions,
  InjectionBundleResult,
} from './types.js';

// Export types for users
export type { IWERPluginOptions, SEMOptions, MCPOptions } from './types.js';

/**
 * Warm up the RAG MCP server by spawning it and waiting for initialization.
 * This downloads the HuggingFace embedding model if not already cached.
 * The process is killed after initialization completes.
 */
function warmupRagMcp(ragMcpServerPath: string, verbose: boolean): void {
  if (!existsSync(ragMcpServerPath)) {
    if (verbose) {
      console.log('[RAG-MCP] Server not found, skipping warmup');
    }
    return;
  }

  console.log('📚 RAG-MCP: Warming up (downloading model if needed)...');

  const warmupProcess: ChildProcess = spawn('node', [ragMcpServerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let initialized = false;

  warmupProcess.stderr?.on('data', (data: Buffer) => {
    const output = data.toString();
    if (verbose) {
      // Print warmup progress
      process.stderr.write(`[RAG-MCP Warmup] ${output}`);
    }

    // Check if initialization is complete
    if (output.includes('IWSDK RAG MCP Server is ready')) {
      initialized = true;
      clearTimeout(warmupTimeout);
      console.log('📚 RAG-MCP: Model cached successfully');
      warmupProcess.kill('SIGTERM');
    }
  });

  warmupProcess.on('error', (error) => {
    if (verbose) {
      console.error('[RAG-MCP] Warmup error:', error.message);
    }
  });

  warmupProcess.on('exit', (code) => {
    if (!initialized && code !== 0 && verbose) {
      console.warn(`[RAG-MCP] Warmup process exited with code ${code}`);
    }
  });

  // Safety timeout - kill after 5 minutes if still running
  const warmupTimeout = setTimeout(
    () => {
      if (!initialized && !warmupProcess.killed) {
        console.warn('[RAG-MCP] Warmup timeout, killing process');
        warmupProcess.kill('SIGTERM');
      }
    },
    5 * 60 * 1000,
  );
}

/**
 * Process and normalize plugin options with defaults
 */
function processOptions(options: IWERPluginOptions = {}): ProcessedIWEROptions {
  const processed: ProcessedIWEROptions = {
    device: options.device || 'metaQuest3',
    injectOnBuild: options.injectOnBuild || false,
    activation: options.activation || 'localhost',
    verbose: options.verbose || false,
    userAgentException:
      options.userAgentException || new RegExp('OculusBrowser'),
  };

  // Process SEM options if provided
  if (options.sem) {
    processed.sem = {
      defaultScene: options.sem.defaultScene || 'living_room',
    };
  }

  // Process MCP options - enabled by default unless explicitly disabled
  const mcpOption = options.mcp ?? true;
  if (mcpOption) {
    if (typeof mcpOption === 'boolean') {
      processed.mcp = { verbose: false };
    } else {
      processed.mcp = {
        port: mcpOption.port,
        verbose: mcpOption.verbose ?? false,
      };
    }
  }

  return processed;
}

/**
 * Vite plugin for IWER (Immersive Web Emulation Runtime) injection
 * Injects WebXR emulation runtime during development and optionally during build
 */
export function injectIWER(options: IWERPluginOptions = {}): Plugin {
  const pluginOptions = processOptions(options);
  let injectionBundle: InjectionBundleResult | null = null;
  let config: ResolvedConfig;
  let mcpWss: WebSocketServer | null = null;
  let mcpClients: Set<WebSocket> | null = null;
  const VIRTUAL_ID = '/@iwer-injection-runtime';
  const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

  return {
    name: 'inject-iwer',

    configResolved(resolvedConfig) {
      config = resolvedConfig;

      if (pluginOptions.verbose) {
        console.log('🔧 IWER Plugin Configuration:');
        console.log(`  - Device: ${pluginOptions.device}`);
        console.log(
          `  - SEM: ${pluginOptions.sem ? 'enabled (' + pluginOptions.sem.defaultScene + ')' : 'disabled'}`,
        );
        console.log(`  - MCP: ${pluginOptions.mcp ? 'enabled' : 'disabled'}`);
        console.log(`  - Activation: ${pluginOptions.activation}`);
        if (pluginOptions.userAgentException) {
          console.log('  - UA exception: enabled');
        }
        console.log(`  - Inject on build: ${pluginOptions.injectOnBuild}`);
      }
    },

    configureServer(server: ViteDevServer) {
      if (!pluginOptions.mcp) {
        return;
      }

      // Initialize WebSocket server and client tracking
      mcpClients = new Set();
      mcpWss = new WebSocketServer({ noServer: true });

      // First-response-wins relay handler (extracted for testability)
      const relay = createRelayHandler({
        verbose: pluginOptions.mcp?.verbose,
      });

      // Clean up stale entries every 60 seconds
      const relayCleanupInterval = setInterval(() => {
        relay.cleanStale(60000);
      }, 60000);
      relayCleanupInterval.unref();

      mcpWss.on('connection', (ws: WebSocket) => {
        mcpClients!.add(ws);

        if (pluginOptions.mcp?.verbose || pluginOptions.verbose) {
          console.log('[MCP-IWER] Client connected');
        }

        ws.on('message', (data: Buffer) => {
          const message = data.toString();
          if (pluginOptions.mcp?.verbose) {
            console.log(
              '[MCP-IWER] Message received:',
              message.substring(0, 100),
            );
          }

          relay.onMessage(ws, message, mcpClients!);
        });

        ws.on('close', () => {
          mcpClients!.delete(ws);
          if (pluginOptions.mcp?.verbose || pluginOptions.verbose) {
            console.log('[MCP-IWER] Client disconnected');
          }
        });

        ws.on('error', (error) => {
          if (pluginOptions.mcp?.verbose || pluginOptions.verbose) {
            console.error('[MCP-IWER] WebSocket error:', error);
          }
        });
      });

      // Set up WebSocket endpoint for MCP - handle upgrade requests
      server.httpServer?.on('upgrade', (request, socket, head) => {
        if (request.url !== '/__iwer_mcp') {
          return;
        }

        if (pluginOptions.mcp?.verbose || pluginOptions.verbose) {
          console.log('[MCP-IWER] WebSocket upgrade request received');
        }

        mcpWss!.handleUpgrade(request, socket, head, (ws) => {
          mcpWss!.emit('connection', ws, request);
        });
      });

      if (pluginOptions.verbose) {
        console.log(
          '🔌 MCP-IWER: WebSocket endpoint registered at /__iwer_mcp',
        );
      }

      // Generate .mcp.json for Claude Code integration after server starts
      // We wait for the 'listening' event to get the actual port (in case configured port was busy)
      const mcpJsonPath = path.join(config.root, '.mcp.json');

      // Find the path to the MCP server script
      // It's installed in node_modules/@iwsdk/vite-plugin-iwer/dist/mcp-server.js
      const mcpServerPath = path.join(
        config.root,
        'node_modules',
        '@iwsdk',
        'vite-plugin-iwer',
        'dist',
        'mcp-server.js',
      );

      // Find the path to the RAG MCP server
      const ragMcpServerPath = path.join(
        config.root,
        'node_modules',
        '@felixtz',
        'iwsdk-rag-mcp',
        'dist',
        'index.js',
      );

      const writeMcpJson = (actualPort: number) => {
        const mcpConfig: { mcpServers: Record<string, { command: string; args: string[] }> } = {
          mcpServers: {
            iwer: {
              command: 'node',
              args: [mcpServerPath, '--port', String(actualPort)],
            },
          },
        };

        // Only include RAG MCP server if the package is actually installed
        if (existsSync(ragMcpServerPath)) {
          mcpConfig.mcpServers['iwsdk-rag-local'] = {
            command: 'node',
            args: [ragMcpServerPath],
          };
        }

        writeFile(mcpJsonPath, JSON.stringify(mcpConfig, null, 2))
          .then(() => {
            if (pluginOptions.verbose) {
              console.log(
                `📝 MCP-IWER: Generated ${mcpJsonPath} (port: ${actualPort})`,
              );
              console.log(
                `   Claude Code can now use IWER tools when launched in this project`,
              );
            }
          })
          .catch((error) => {
            console.error('[MCP-IWER] Failed to write .mcp.json:', error);
          });
      };

      // Wait for server to start listening to get the actual port
      server.httpServer?.on('listening', () => {
        const address = server.httpServer?.address();
        const actualPort =
          typeof address === 'object' && address
            ? address.port
            : server.config.server.port || 5173;
        writeMcpJson(actualPort);

        // Warm up RAG MCP server (downloads embedding model if needed)
        // This ensures the model is cached before Claude Code tries to use it
        warmupRagMcp(ragMcpServerPath, pluginOptions.verbose);
      });

      // Clean up WebSocket server and .mcp.json when Vite server closes
      server.httpServer?.on('close', () => {
        if (mcpWss) {
          for (const client of mcpClients || []) {
            client.close();
          }
          mcpClients?.clear();
          mcpWss.close();
          mcpWss = null;
        }
        unlink(mcpJsonPath).catch(() => {
          // Ignore errors - file may not exist
        });
      });
    },

    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_VIRTUAL_ID;
      }
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        if (!injectionBundle) {
          return 'console.warn("[IWER Plugin] Runtime not available - injection bundle not loaded");';
        }
        return injectionBundle.code;
      }
    },

    async buildStart() {
      // Determine if we should generate injection script
      const shouldInject =
        config.command === 'serve' ||
        (config.command === 'build' && pluginOptions.injectOnBuild);

      if (!shouldInject) {
        if (pluginOptions.verbose && config.command === 'build') {
          console.log(
            '⏭️  IWER Plugin: Skipping build injection (injectOnBuild: false)',
          );
        }
        return;
      }

      try {
        if (pluginOptions.verbose) {
          console.log(
            '🚀 IWER Plugin: Starting injection bundle generation...',
          );
        }

        injectionBundle = await buildInjectionBundle(pluginOptions);

        if (pluginOptions.verbose) {
          console.log('✅ IWER Plugin: Injection bundle ready');
        }
      } catch (error) {
        console.error(
          '❌ IWER Plugin: Failed to generate injection bundle:',
          error,
        );
        // Continue without injection rather than failing the build
      }
    },

    transformIndexHtml: {
      order: 'pre', // Run before other HTML transformations
      handler(html) {
        // Check if we should inject
        const shouldInject =
          config.command === 'serve' ||
          (config.command === 'build' && pluginOptions.injectOnBuild);

        if (!shouldInject || !injectionBundle) {
          return html;
        }

        if (pluginOptions.verbose) {
          console.log('💉 IWER Plugin: Injecting runtime script into HTML');
        }

        // Inject the script using Vite's tag API for robustness
        return {
          tags: [
            {
              tag: 'script',
              attrs: { type: 'module', src: VIRTUAL_ID },
              injectTo: 'head',
            },
          ],
        } as any;
      },
    },

    // Display summary at the end of build process
    closeBundle: {
      order: 'post',
      async handler() {
        // Only show summary when injection actually happened
        const shouldInject =
          config.command === 'serve' ||
          (config.command === 'build' && pluginOptions.injectOnBuild);

        if (shouldInject && injectionBundle) {
          const mode = config.command === 'serve' ? 'Development' : 'Build';
          console.log(`\n🥽 IWER Plugin Summary (${mode}):`);
          console.log(`  - Device: ${pluginOptions.device}`);
          console.log(
            `  - Runtime injected: ${(injectionBundle.size / 1024).toFixed(1)}KB`,
          );
          console.log(`  - Activation mode: ${pluginOptions.activation}`);

          if (pluginOptions.sem) {
            console.log(
              `  - SEM environment: ${pluginOptions.sem.defaultScene}`,
            );
          }

          if (pluginOptions.mcp) {
            console.log('  - MCP: enabled (WebSocket at /__iwer_mcp)');
          }

          if (pluginOptions.activation === 'localhost') {
            console.log(
              '  - Note: Runtime only activates on localhost/local networks',
            );
          }

          console.log(''); // Extra line for spacing
        }
      },
    },
  };
}
