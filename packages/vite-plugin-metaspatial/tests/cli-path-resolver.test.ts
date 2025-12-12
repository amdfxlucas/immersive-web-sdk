/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getHighestVersion, resolveMetaSpatialCliPath, validateCliPath } from '../src/generate-glxf/cli-path-resolver.js';
import fs from 'fs-extra';
import * as path from 'path';

// Mock fs module
vi.mock('fs-extra');

describe('CLI Path Resolver', () => {
  let originalPlatform: string;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original values
    originalPlatform = process.platform;
    originalEnv = { ...process.env };

    // Clear mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original values
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
    process.env = originalEnv;
  });

  describe('getHighestVersion', () => {
    it('should return the highest version number', () => {
      const mockFiles = ['v1', 'v2', 'v9', 'v11', 'v12', 'v20', 'other-file.txt'];

      vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
      vi.mocked(fs.statSync).mockImplementation((filePath: any) => {
        const fileName = path.basename(filePath.toString());
        return {
          isDirectory: () => /^v\d+$/.test(fileName),
        } as any;
      });

      const result = getHighestVersion('C:\\Program Files\\Meta Spatial Editor\\');

      expect(result).toBe('v20');
    });

    it('should handle single version directory', () => {
      const mockFiles = ['v5'];

      vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
      vi.mocked(fs.statSync).mockImplementation((filePath: any) => {
        const fileName = path.basename(filePath.toString());
        return {
          isDirectory: () => /^v\d+$/.test(fileName),
        } as any;
      });

      const result = getHighestVersion('C:\\Program Files\\Meta Spatial Editor\\');

      expect(result).toBe('v5');
    });

    it('should return null when no version directories exist', () => {
      const mockFiles = ['other-file.txt', 'config.json'];

      vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
      vi.mocked(fs.statSync).mockImplementation(() => {
        return {
          isDirectory: () => false,
        } as any;
      });

      const result = getHighestVersion('C:\\Program Files\\Meta Spatial Editor\\');

      expect(result).toBeNull();
    });

    it('should correctly sort multi-digit version numbers', () => {
      const mockFiles = ['v2', 'v100', 'v20', 'v3'];

      vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
      vi.mocked(fs.statSync).mockImplementation((filePath: any) => {
        const fileName = path.basename(filePath.toString());
        return {
          isDirectory: () => /^v\d+$/.test(fileName),
        } as any;
      });

      const result = getHighestVersion('C:\\Program Files\\Meta Spatial Editor\\');

      expect(result).toBe('v100');
    });

    it('should handle directory read errors gracefully', () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error('Directory not found');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = getHighestVersion('C:\\Program Files\\Meta Spatial Editor\\');

      expect(result).toBeNull();
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('resolveMetaSpatialCliPath', () => {
    it('should use META_SPATIAL_EDITOR_CLI_PATH environment variable if set', () => {
      process.env.META_SPATIAL_EDITOR_CLI_PATH = '/custom/path/to/CLI';

      const result = resolveMetaSpatialCliPath();

      expect(result).toBe('/custom/path/to/CLI');
    });

    it('should return macOS path when platform is darwin and no env var is set', () => {
      delete process.env.META_SPATIAL_EDITOR_CLI_PATH;
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      });

      const result = resolveMetaSpatialCliPath();

      expect(result).toBe('/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI');
    });

    it('should return Windows path with highest version when platform is win32', () => {
      delete process.env.META_SPATIAL_EDITOR_CLI_PATH;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      });

      const mockFiles = ['v1', 'v2', 'v20'];
      vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
      vi.mocked(fs.statSync).mockImplementation((filePath: any) => {
        const fileName = path.basename(filePath.toString());
        return {
          isDirectory: () => /^v\d+$/.test(fileName),
        } as any;
      });

      const result = resolveMetaSpatialCliPath();

      expect(result).toContain('v20');
      expect(result).toContain('Resources');
      expect(result).toContain('CLI.exe');
    });

    it('should return Windows fallback path when no version directories found', () => {
      delete process.env.META_SPATIAL_EDITOR_CLI_PATH;
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      });

      const mockFiles = ['other-file.txt'];
      vi.mocked(fs.readdirSync).mockReturnValue(mockFiles as any);
      vi.mocked(fs.statSync).mockImplementation(() => {
        return {
          isDirectory: () => false,
        } as any;
      });

      const result = resolveMetaSpatialCliPath();

      expect(result).toContain('Resources');
      expect(result).toContain('CLI.exe');
      expect(result).not.toContain('v');
    });

    it('should return MetaSpatialEditorCLI for Linux platform', () => {
      delete process.env.META_SPATIAL_EDITOR_CLI_PATH;
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      });

      const result = resolveMetaSpatialCliPath();

      expect(result).toBe('MetaSpatialEditorCLI');
    });

    it('should prioritize environment variable over platform detection', () => {
      process.env.META_SPATIAL_EDITOR_CLI_PATH = '/override/path';
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      });

      const result = resolveMetaSpatialCliPath();

      expect(result).toBe('/override/path');
      expect(result).not.toBe('/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI');
    });
  });

  describe('validateCliPath', () => {
    beforeEach(() => {
      // Reset to darwin for most tests
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
      });
    });

    it('should pass validation when CLI exists and is executable on macOS', async () => {
      const cliPath = '/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI';

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      await expect(validateCliPath(cliPath)).resolves.toBeUndefined();
    });

    it('should pass validation when CLI exists on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      });

      const cliPath = 'C:\\Program Files\\Meta Spatial Editor\\v20\\Resources\\CLI.exe';

      vi.mocked(fs.pathExists).mockResolvedValue(true);

      await expect(validateCliPath(cliPath)).resolves.toBeUndefined();
    });

    it('should skip validation for Linux with non-absolute path', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
      });

      const cliPath = 'MetaSpatialEditorCLI';

      await expect(validateCliPath(cliPath)).resolves.toBeUndefined();
      expect(fs.pathExists).not.toHaveBeenCalled();
    });

    it('should throw helpful error when CLI does not exist on macOS', async () => {
      const cliPath = '/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI';

      vi.mocked(fs.pathExists).mockResolvedValue(false);

      await expect(validateCliPath(cliPath)).rejects.toThrow('Meta Spatial Editor CLI not found');
      await expect(validateCliPath(cliPath)).rejects.toThrow('meta-spatial-editor-for-mac');
      await expect(validateCliPath(cliPath)).rejects.toThrow('META_SPATIAL_EDITOR_CLI_PATH');
    });

    it('should throw helpful error when CLI does not exist on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
      });

      const cliPath = 'C:\\Program Files\\Meta Spatial Editor\\v20\\Resources\\CLI.exe';

      vi.mocked(fs.pathExists).mockResolvedValue(false);

      await expect(validateCliPath(cliPath)).rejects.toThrow('Meta Spatial Editor CLI not found');
      await expect(validateCliPath(cliPath)).rejects.toThrow('meta-spatial-editor-for-windows');
    });

    it('should throw helpful error when CLI exists but is not executable on macOS', async () => {
      const cliPath = '/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI';

      vi.mocked(fs.pathExists).mockResolvedValue(true);
      vi.mocked(fs.access).mockRejectedValue(new Error('Permission denied'));

      await expect(validateCliPath(cliPath)).rejects.toThrow('not executable');
      await expect(validateCliPath(cliPath)).rejects.toThrow('chmod +x');
    });

    it('should include download link in error message for unknown errors', async () => {
      const cliPath = '/Applications/Meta Spatial Editor.app/Contents/MacOS/CLI';

      vi.mocked(fs.pathExists).mockRejectedValue(new Error('Unknown error'));

      await expect(validateCliPath(cliPath)).rejects.toThrow('Error checking Meta Spatial Editor CLI');
      await expect(validateCliPath(cliPath)).rejects.toThrow('download');
    });
  });
});
