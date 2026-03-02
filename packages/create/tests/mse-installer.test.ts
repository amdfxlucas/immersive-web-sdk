/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  detectPlatform,
  isVersionSufficient,
  normalizeVersion,
} from '../src/mse-installer.js';
import {
  MSE_MIN_VERSION,
  MSE_APP_NAMES,
  getAppcastUrl,
} from '../src/mse-config.js';

describe('MSE Installer', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = process.platform;
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  describe('normalizeVersion', () => {
    it('should pad version to 3 parts', () => {
      expect(normalizeVersion('11')).toBe('11.0.0');
      expect(normalizeVersion('11.0')).toBe('11.0.0');
      expect(normalizeVersion('11.0.0')).toBe('11.0.0');
    });

    it('should truncate version to 3 parts', () => {
      expect(normalizeVersion('11.0.0.10.576')).toBe('11.0.0');
      expect(normalizeVersion('9.1.2.3.4.5')).toBe('9.1.2');
    });

    it('should handle single digit versions', () => {
      expect(normalizeVersion('9')).toBe('9.0.0');
    });

    it('should preserve full 3-part versions', () => {
      expect(normalizeVersion('9.1.2')).toBe('9.1.2');
      expect(normalizeVersion('12.5.3')).toBe('12.5.3');
    });
  });

  describe('detectPlatform', () => {
    it('should return darwin for macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      expect(detectPlatform()).toBe('darwin');
    });

    it('should return win32 for Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(detectPlatform()).toBe('win32');
    });

    it('should return linux for Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(detectPlatform()).toBe('linux');
    });

    it('should return linux for unknown platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      expect(detectPlatform()).toBe('linux');
    });
  });

  describe('isVersionSufficient', () => {
    it('should return true for versions >= minimum', () => {
      expect(isVersionSufficient('14.0.0')).toBe(true);
      expect(isVersionSufficient('14.0.1')).toBe(true);
      expect(isVersionSufficient('16.0.0')).toBe(true);
      expect(isVersionSufficient('20.0.0')).toBe(true);
    });

    it('should return false for versions < minimum', () => {
      expect(isVersionSufficient('13.9.9')).toBe(false);
      expect(isVersionSufficient('9.0.0')).toBe(false);
      expect(isVersionSufficient('1.0.0')).toBe(false);
    });

    it('should accept custom minimum version', () => {
      expect(isVersionSufficient('10.0.0', '10.0.0')).toBe(true);
      expect(isVersionSufficient('9.9.9', '10.0.0')).toBe(false);
    });

    it('should return false for invalid versions', () => {
      expect(isVersionSufficient('invalid')).toBe(false);
      expect(isVersionSufficient('')).toBe(false);
    });
  });

  describe('MSE Config', () => {
    it('should have correct app names for all platforms', () => {
      expect(MSE_APP_NAMES.darwin).toBe('cosmo_studio_for_macos');
      expect(MSE_APP_NAMES.win32).toBe('cosmo_studio_for_windows');
      expect(MSE_APP_NAMES.linux).toBe('cosmo_studio_cli_for_linux');
    });

    it('should generate correct appcast URLs', () => {
      expect(getAppcastUrl('darwin')).toContain('cosmo_studio_for_macos');
      expect(getAppcastUrl('darwin')).toContain('appcast.xml');
      expect(getAppcastUrl('win32')).toContain('cosmo_studio_for_windows');
      expect(getAppcastUrl('linux')).toContain('cosmo_studio_cli_for_linux');
    });

    it('should have minimum version set', () => {
      expect(MSE_MIN_VERSION).toBe('14.0.0');
    });
  });

  describe('Version comparison edge cases', () => {
    it('should correctly compare normalized versions', () => {
      // These should be considered equal after normalization
      const v1 = normalizeVersion('11.0');
      const v2 = normalizeVersion('11.0.0.10.576');
      expect(v1).toBe(v2);
    });

    it('should handle version upgrade detection', () => {
      const installed = normalizeVersion('10.0');
      const latest = normalizeVersion('11.0.0.10.576');
      expect(installed).not.toBe(latest);
      expect(isVersionSufficient(installed, latest)).toBe(false);
    });
  });
});
