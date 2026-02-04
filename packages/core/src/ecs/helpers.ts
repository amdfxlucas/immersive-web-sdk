/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { Entity } from 'elics';
import type { AnyComponent, TypedArray } from 'elics/lib/types.js';

type VectorType = 'Vec2' | 'Vec3' | 'Vec4';
const VECTOR_TYPES: VectorType[] = ['Vec4', 'Vec3', 'Vec2'];

/**
 * Check whether or not the entity has a value for the given key that matches
 * the default value from component storage initialization.
 *
 * @param entity - The entity to check
 * @param component - The component containing the schema
 * @param key - The schema key to check
 * @returns boolean indicating if the value matches the default
 */
export function hasDefaultValue(
  entity: Entity,
  component: AnyComponent,
  key: string,
): boolean {
  const schemaField = component.schema[key];
  const defaultVal = schemaField?.default;

  const id = entity.index;
  const dataStore = component.data[key];
  const val = Array.isArray(dataStore) ? dataStore[id] : undefined;
  return val === defaultVal;
}

/**
 * Get a copy of an entity's component data with its current values.
 * Modifying the return value will have no effect on the ECS system.
 *
 * NOTE: Output will contain default values from initializeComponentStorage
 * for fields that aren't set manually.
 *
 * @param component - The component to get data from
 * @param entity - The entity or entity index to get component data for
 * @returns A copy of the component data, or null if inputs are invalid
 */
export function getComponent(
  component: AnyComponent,
  entity: Entity | number,
): Record<string, unknown> | null {
  const obj: Record<string, unknown> = {};

  if (
    !component ||
    !(Number.isInteger(entity) || Number.isInteger((entity as Entity)?.index))
  ) {
    return null;
  }

  const id = Number.isInteger(entity) ? (entity as number) : (entity as Entity).index;
  const entityObj = Number.isInteger(entity) ? null : (entity as Entity);

  for (const k of Object.keys(component.schema)) {
    const schemaField = component.schema[k];
    if (VECTOR_TYPES.includes(schemaField.type as VectorType)) {
      if (entityObj) {
        obj[k] = entityObj.getVectorView(component, k as never);
      }
    } else {
      const dataStore = component.data[k];
      if (Array.isArray(dataStore) || ArrayBuffer.isView(dataStore)) {
        obj[k] = (dataStore as unknown[])[id];
      }
    }
  }
  return obj;
}

/**
 * A setValue() wrapper for multiple properties at once.
 *
 * @param component - The Component that shall be set on the entity
 * @param entity - The entity or entity index whose Component values shall be updated
 * @param values - An object with the same structure/keys as the Component schema
 * @throws Error if inputs are invalid
 * @attention Overwrites existing values
 */
export function setComponent(
  component: AnyComponent,
  entity: Entity | number,
  values: Record<string, unknown>,
): void {
  if (!values || !component || !entity) {
    throw new Error('input error');
  }

  const id = Number.isInteger(entity) ? (entity as number) : (entity as Entity).index;
  const entityObj = Number.isInteger(entity) ? null : (entity as Entity);

  for (const k of Object.keys(component.schema)) {
    const schemaField = component.schema[k];
    if (VECTOR_TYPES.includes(schemaField.type as VectorType)) {
      if (entityObj && values[k] !== undefined) {
        const view = entityObj.getVectorView(component, k as never) as TypedArray;
        view.set(values[k] as ArrayLike<number>);
      }
    } else {
      const dataStore = component.data[k];
      if (
        (Array.isArray(dataStore) || ArrayBuffer.isView(dataStore)) &&
        values[k] !== undefined
      ) {
        (dataStore as unknown[])[id] = values[k];
      }
    }
  }
}

/**
 * A setValue() wrapper for multiple properties at once.
 * Only adds new/missing keys from values that aren't present. Does not override existing values.
 *
 * @param component - The Component that shall be set on the entity
 * @param entity - The entity or entity index whose Component values shall be updated
 * @param values - An object with the same structure/keys as the Component schema
 * @param except - Keys to exclude from setting
 * @throws Error if inputs are invalid
 */
export function setComponentWeak(
  component: AnyComponent,
  entity: Entity | number,
  values: Record<string, unknown>,
  except: string[] = [],
): void {
  if (!values || !component || !entity) {
    throw new Error('input error');
  }

  const id = Number.isInteger(entity) ? (entity as number) : (entity as Entity).index;
  const entityObj = Number.isInteger(entity) ? null : (entity as Entity);

  for (const k of Object.keys(values)) {
    if (!Object.prototype.hasOwnProperty.call(component.schema, k)) {
      // log.warn(`Invalid key '${k}' for Component ${component.id}`);
      continue;
    }

    if (!except.includes(k)) {
      const schemaField = component.schema[k];
      if (VECTOR_TYPES.includes(schemaField.type as VectorType)) {
        if (entityObj && values[k] !== undefined) {
          const view = entityObj.getVectorView(component, k as never) as TypedArray;
          view.set(values[k] as ArrayLike<number>);
        }
      } else {
        const dataStore = component.data[k];
        if (
          (Array.isArray(dataStore) || ArrayBuffer.isView(dataStore)) &&
          values[k] !== undefined
        ) {
          (dataStore as unknown[])[id] = values[k];
        }
      }
    }
  }
}
