/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect } from 'vitest';
import { getSceneHierarchy, type HierarchyNode } from '../../src/mcp/scene-tools.js';

// ---------------------------------------------------------------------------
// Minimal Object3D mock (only the properties scene-tools uses)
// ---------------------------------------------------------------------------

let uuidCounter = 0;

function createMockObject3D(
  name: string,
  children: any[] = [],
): any {
  return {
    name,
    uuid: `uuid-${++uuidCounter}`,
    children,
    getObjectByProperty: function (prop: string, value: string): any {
      if ((this as any)[prop] === value) return this;
      for (const child of this.children) {
        const found = child.getObjectByProperty(prop, value);
        if (found) return found;
      }
      return undefined;
    },
  };
}

function createMockWorld(sceneChildren: any[] = []): any {
  return {
    scene: createMockObject3D('Scene', sceneChildren),
    player: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('getSceneHierarchy', () => {
  describe('breadth limit', () => {
    it('should include all children when count is within default limit', () => {
      const children = Array.from({ length: 10 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, {});

      expect(result.children).toHaveLength(10);
      expect(result.truncatedChildren).toBeUndefined();
    });

    it('should truncate children when count exceeds default limit (50)', () => {
      const children = Array.from({ length: 80 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, {});

      expect(result.children).toHaveLength(50);
      expect(result.truncatedChildren).toBe(30);
    });

    it('should respect custom maxChildren parameter', () => {
      const children = Array.from({ length: 20 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, { maxChildren: 5 });

      expect(result.children).toHaveLength(5);
      expect(result.truncatedChildren).toBe(15);
      // Verify we got the first 5 children
      expect(result.children![0].name).toBe('child-0');
      expect(result.children![4].name).toBe('child-4');
    });

    it('should apply breadth limit recursively to nested children', () => {
      const grandchildren = Array.from({ length: 10 }, (_, i) =>
        createMockObject3D(`grandchild-${i}`),
      );
      const child = createMockObject3D('parent', grandchildren);
      const world = createMockWorld([child]);

      const result = getSceneHierarchy(world, { maxChildren: 3 });

      // Top level: 1 child (within limit)
      expect(result.children).toHaveLength(1);
      expect(result.truncatedChildren).toBeUndefined();

      // Nested level: 3 of 10 grandchildren
      const nestedNode = result.children![0];
      expect(nestedNode.children).toHaveLength(3);
      expect(nestedNode.truncatedChildren).toBe(7);
    });

    it('should not add truncatedChildren when exactly at the limit', () => {
      const children = Array.from({ length: 5 }, (_, i) =>
        createMockObject3D(`child-${i}`),
      );
      const world = createMockWorld(children);

      const result = getSceneHierarchy(world, { maxChildren: 5 });

      expect(result.children).toHaveLength(5);
      expect(result.truncatedChildren).toBeUndefined();
    });
  });

  describe('depth limit', () => {
    it('should respect maxDepth parameter', () => {
      const deep = createMockObject3D('level3');
      const mid = createMockObject3D('level2', [deep]);
      const top = createMockObject3D('level1', [mid]);
      const world = createMockWorld([top]);

      const result = getSceneHierarchy(world, { maxDepth: 2 });

      // depth 0: Scene, depth 1: level1, depth 2: level2 (at limit, no children)
      expect(result.children![0].children![0].children).toBeUndefined();
    });
  });

  describe('entityIndex', () => {
    it('should include entityIndex when entityIdx property exists', () => {
      const obj = createMockObject3D('entity-obj');
      obj.entityIdx = 42;
      const world = createMockWorld([obj]);

      const result = getSceneHierarchy(world, {});

      expect(result.children![0].entityIndex).toBe(42);
    });

    it('should not include entityIndex when entityIdx is absent', () => {
      const obj = createMockObject3D('plain-obj');
      const world = createMockWorld([obj]);

      const result = getSceneHierarchy(world, {});

      expect(result.children![0].entityIndex).toBeUndefined();
    });
  });

  describe('parentId', () => {
    it('should throw when parentId is not found', () => {
      const world = createMockWorld([]);

      expect(() =>
        getSceneHierarchy(world, { parentId: 'nonexistent' }),
      ).toThrow('Object not found');
    });

    it('should root hierarchy at the specified parentId', () => {
      const child = createMockObject3D('target-child');
      const target = createMockObject3D('target', [child]);
      const world = createMockWorld([target]);

      const result = getSceneHierarchy(world, { parentId: target.uuid });

      expect(result.name).toBe('target');
      expect(result.children).toHaveLength(1);
      expect(result.children![0].name).toBe('target-child');
    });
  });
});
