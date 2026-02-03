/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import semver from 'semver';
import {
  MSE_MIN_VERSION,
  MSE_INSTALL_PATHS,
  MSE_LINUX_CLI_NAME,
} from './mse-config.js';
import type { Platform } from './types.js';

/** Normalize version to major.minor.patch for comparison */
export function normalizeVersion(v: string): string {
  const parts = v.split('.');
  while (parts.length < 3) parts.push('0');
  return parts.slice(0, 3).join('.');
}

export function detectPlatform(): Platform {
  const p = process.platform;
  return p === 'darwin' || p === 'win32' ? p : 'linux';
}

/** Get highest version directory (e.g., v20) from Windows install path */
function getHighestVersion(directoryPath: string): string | null {
  try {
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const versions = entries
      .filter((e) => e.isDirectory() && /^v\d+$/.test(e.name))
      .map((e) => parseInt(e.name.slice(1), 10));
    return versions.length ? `v${Math.max(...versions)}` : null;
  } catch {
    return null;
  }
}

function getMacOSAppVersion(appPath: string): string | null {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  try {
    const output = execSync(
      `plutil -extract CFBundleShortVersionString raw "${plistPath}"`,
      { encoding: 'utf-8', timeout: 5000 },
    );
    return output.trim();
  } catch {
    return null;
  }
}

function getWindowsAppVersion(basePath: string): string | null {
  const highestVersion = getHighestVersion(basePath);
  if (!highestVersion) return null;
  const vNum = parseInt(highestVersion.substring(1), 10);
  return `${vNum}.0.0`;
}

function parseVersionFromOutput(output: string): string | null {
  const match = output.match(/v?(\d+\.\d+\.\d+)/);
  return match ? match[1] : null;
}

export async function detectMSEVersion(platform: Platform): Promise<string | null> {
  if (platform === 'linux') {
    const cliPath = path.join(MSE_INSTALL_PATHS.linux, MSE_LINUX_CLI_NAME);

    if (fs.existsSync(cliPath)) {
      try {
        const output = execSync(`"${cliPath}" --version`, { encoding: 'utf-8', timeout: 5000 });
        return parseVersionFromOutput(output);
      } catch {
        return null;
      }
    }

    try {
      const output = execSync('MetaSpatialEditorCLI --version', { encoding: 'utf-8', timeout: 5000 });
      return parseVersionFromOutput(output);
    } catch {
      return null;
    }
  }

  const installPath = MSE_INSTALL_PATHS[platform];
  if (!installPath || !fs.existsSync(installPath)) return null;

  return platform === 'darwin' ? getMacOSAppVersion(installPath) : getWindowsAppVersion(installPath);
}

export function isVersionSufficient(installed: string, required: string = MSE_MIN_VERSION): boolean {
  try {
    return semver.gte(installed, required);
  } catch {
    return false;
  }
}
