#!/usr/bin/env node
/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lockfilePath = path.join(__dirname, '..', 'pnpm-lock.yaml');

const EXPECTED_THREE_VERSION = 'super-three@0.177.0';
const EXPECTED_TYPES_VERSION = '@types/three@0.177.0';

/**
 * Check that pnpm-lock.yaml only contains the correct three.js version
 * to prevent accidental dependency on multiple three.js versions.
 */
function checkThreeVersion() {
  if (!fs.existsSync(lockfilePath)) {
    console.error('❌ pnpm-lock.yaml not found at:', lockfilePath);
    process.exit(1);
  }

  const lockfile = fs.readFileSync(lockfilePath, 'utf-8');
  const lines = lockfile.split('\n');

  const errors = [];
  const allowedPatterns = [
    EXPECTED_THREE_VERSION,
    EXPECTED_TYPES_VERSION,
    'three-mesh-bvh', // Separate package, not three.js
    'three:', // Peer dependency declarations (not actual versions)
    "three: '", // Peer dependency version ranges
  ];

  lines.forEach((line, index) => {
    // Look for lines that reference three@ (actual version resolution)
    if (line.includes('three@') || line.includes('three:')) {
      // Skip if it's one of the allowed patterns
      const isAllowed = allowedPatterns.some((pattern) =>
        line.includes(pattern),
      );
      if (isAllowed) {
        return;
      }

      // Skip peer dependency declarations and version ranges
      if (
        line.includes('peerDependencies:') ||
        line.includes('>=') ||
        line.includes('^') ||
        line.includes('~') ||
        line.trim().startsWith('three:') // Peer dep line
      ) {
        return;
      }

      // If we get here, it's a potential issue
      errors.push({
        line: index + 1,
        content: line.trim(),
      });
    }
  });

  if (errors.length > 0) {
    console.error('❌ Found incorrect three.js versions in pnpm-lock.yaml:\n');
    errors.forEach((error) => {
      console.error(`  Line ${error.line}: ${error.content}`);
    });
    console.error(
      `\n✅ Expected version: ${EXPECTED_THREE_VERSION} (aliased as "three")`,
    );
    console.error(
      `✅ Expected types: ${EXPECTED_TYPES_VERSION}\n`,
    );
    console.error('To fix this:');
    console.error('  1. Check package.json files for direct dependencies on "three"');
    console.error('  2. Ensure all packages use: "three": "npm:super-three@0.177.0"');
    console.error('  3. Run: rm -rf node_modules pnpm-lock.yaml && pnpm install');
    process.exit(1);
  }

  console.log('✅ Three.js version check passed');
  console.log(`   All packages correctly use: ${EXPECTED_THREE_VERSION}`);
}

checkThreeVersion();
