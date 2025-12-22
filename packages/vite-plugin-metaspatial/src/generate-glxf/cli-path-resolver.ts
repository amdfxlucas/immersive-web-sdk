/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as path from 'path';
import fs from 'fs-extra';

/**
 * Download URLs for Meta Spatial Editor by platform
 */
const DOWNLOAD_URLS = {
  darwin:
    'https://developers.meta.com/horizon/downloads/package/meta-spatial-editor-for-mac',
  win32:
    'https://developers.meta.com/horizon/downloads/package/meta-spatial-editor-for-windows',
  linux:
    'https://developers.meta.com/horizon/downloads/package/meta-spatial-editor-for-linux',
  default: 'https://developers.meta.com/horizon/downloads/spatial-sdk/',
} as const;

/**
 * Get the highest version directory from Meta Spatial Editor installation
 * @param directoryPath - Base directory path
 * @returns The version folder with the highest version number (e.g., 'v20')
 */
export function getHighestVersion(directoryPath: string): string | null {
  try {
    const files = fs.readdirSync(directoryPath);

    // Filter for version directories (e.g., v1, v2, v20)
    const versionDirs = files.filter((file) => {
      const fullPath = path.join(directoryPath, file);
      return fs.statSync(fullPath).isDirectory() && /^v\d+$/.test(file);
    });

    if (versionDirs.length === 0) {
      return null;
    }

    // Sort by version number (extract number from 'vN' format)
    versionDirs.sort((a, b) => {
      const numA = parseInt(a.substring(1), 10);
      const numB = parseInt(b.substring(1), 10);
      return numB - numA; // Descending order (highest first)
    });

    return versionDirs[0];
  } catch (error) {
    console.warn(`Warning: Could not read directory ${directoryPath}:`, error);
    return null;
  }
}

/**
 * Resolve the Meta Spatial CLI path based on environment and platform
 * @returns The path to the Meta Spatial CLI executable
 */
export function resolveMetaSpatialCliPath(): string {
  // First, check if META_SPATIAL_EDITOR_CLI_PATH environment variable is set
  if (process.env.META_SPATIAL_EDITOR_CLI_PATH) {
    return process.env.META_SPATIAL_EDITOR_CLI_PATH;
  }

  // Fall back to platform-specific defaults
  const os = process.platform;

  if (os === 'darwin') {
    return '/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI';
  } else if (os === 'win32') {
    const directoryPath = 'C:\\Program Files\\Meta Spatial Editor\\';
    const highestVersion = getHighestVersion(directoryPath);

    if (highestVersion) {
      return path.join(directoryPath, highestVersion, 'Resources', 'CLI.exe');
    } else {
      // Fallback to a default path if no version directories found
      return path.join(directoryPath, 'Resources', 'CLI.exe');
    }
  } else {
    // Linux - assume MetaSpatialEditorCLI is in PATH
    return 'MetaSpatialEditorCLI';
  }
}

/**
 * Validate that the Meta Spatial CLI exists and is accessible
 * @param cliPath - Path to the CLI executable
 * @throws Error with helpful message including download link if CLI not found
 */
export async function validateCliPath(cliPath: string): Promise<void> {
  const platform = process.platform as keyof typeof DOWNLOAD_URLS;
  const downloadUrl = DOWNLOAD_URLS[platform] || DOWNLOAD_URLS.default;

  // For Linux, the CLI might be in PATH, so we skip file existence check
  // The spawn process will handle the error if it's not found
  if (platform === 'linux' && !path.isAbsolute(cliPath)) {
    return;
  }

  try {
    const exists = await fs.pathExists(cliPath);

    if (!exists) {
      const errorMessage = [
        `❌ Meta Spatial Editor CLI not found at: ${cliPath}`,
        '',
        '📥 Please download and install Meta Spatial Editor:',
        `   ${downloadUrl}`,
        '',
        '🔧 Alternative solutions:',
        '   1. Set the META_SPATIAL_EDITOR_CLI_PATH environment variable to the correct path',
        '   2. Specify metaSpatialCliPath in your vite.config.js generateGLXF options',
        '',
      ].join('\n');

      throw new Error(errorMessage);
    }

    // Check if the file is executable (Unix-like systems)
    if (platform !== 'win32') {
      try {
        await fs.access(cliPath, fs.constants.X_OK);
      } catch (error) {
        const errorMessage = [
          `❌ Meta Spatial Editor CLI found but is not executable: ${cliPath}`,
          '',
          '🔧 Make the file executable by running:',
          `   chmod +x "${cliPath}"`,
          '',
        ].join('\n');

        throw new Error(errorMessage);
      }
    }
  } catch (error) {
    // Re-throw our custom errors, or wrap system errors
    if (
      error instanceof Error &&
      error.message.includes('Meta Spatial Editor')
    ) {
      throw error;
    }

    const errorMessage = [
      `❌ Error checking Meta Spatial Editor CLI at: ${cliPath}`,
      `   ${error instanceof Error ? error.message : String(error)}`,
      '',
      '📥 If you need to install Meta Spatial Editor, download it from:',
      `   ${downloadUrl}`,
      '',
    ].join('\n');

    throw new Error(errorMessage);
  }
}
