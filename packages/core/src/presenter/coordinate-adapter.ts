/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @file coordinate-adapter.ts
 * @brief Coordinate transformations between geographic, CRS, and scene coordinates
 *
 * Handles the math for converting between:
 * - Geographic (WGS84 lat/lon)
 * - Project CRS (e.g., EPSG:25833 UTM)
 * - ENU scene coordinates (origin-centered, meters)
 *
 * Key insight: For UTM-based CRS, ENU↔CRS is a simple translation because
 * UTM is already Cartesian in meters with axes aligned to ENU.
 *
 * Coordinate System Conventions:
 * - Three.js: X=Right, Y=Up, Z=Toward Camera (-North)
 * - ENU: East, North, Up (local tangent plane)
 * - CRS (UTM): Easting, Northing (Cartesian on ellipsoid)
 *
 * @category Runtime
 */

import { Vector3 } from 'three';
import type { GeographicCoords, ProjectCRS } from './presenter.js';

/** WGS84 ellipsoid semi-major axis in meters */
const WGS84_A = 6378137.0;

/** WGS84 ellipsoid eccentricity squared */
const WGS84_E2 = 6.69437999014e-3;

/**
 * Computed origin with all coordinate representations
 *
 * @internal
 */
interface ComputedOrigin {
  /** Latitude in degrees */
  lat: number;
  /** Longitude in degrees */
  lon: number;
  /** Height in meters */
  h: number;
  /** ECEF coordinates */
  ecef: { x: number; y: number; z: number };
  /** CRS coordinates */
  crs: { x: number; y: number };
}

/**
 * Proj4 function type (simplified for dynamic loading without type declarations)
 * @internal
 */
interface Proj4Function {
  (fromProj: string, toProj: string, coord: number[]): number[];
  defs(code: string, def?: string): string | undefined;
}

/** Lazy-loaded proj4 module reference */
let proj4Module: Proj4Function | null = null;

/**
 * Lazy-load proj4 to avoid bundling issues when not used
 *
 * @internal
 */
async function getProj4(): Promise<Proj4Function> {
  if (!proj4Module) {
    try {
      const module = await import('proj4');
      proj4Module = (module.default || module) as unknown as Proj4Function;
    } catch {
      throw new Error(
        'proj4 is required for coordinate transformations. Install it with: npm install proj4',
      );
    }
  }
  return proj4Module;
}

/**
 * Coordinate Adapter
 *
 * Provides bidirectional coordinate transformations between geographic (WGS84),
 * project CRS, and scene (ENU) coordinate systems.
 *
 * The adapter uses a local origin point to compute ENU (East-North-Up)
 * coordinates relative to that origin. This is essential for maintaining
 * precision when working with geographic coordinates that would otherwise
 * lose precision due to floating point limitations.
 *
 * @example
 * ```ts
 * const adapter = new CoordinateAdapter(
 *   { code: 'EPSG:25833', proj4: '+proj=utm +zone=33 +ellps=GRS80 ...' },
 *   { lat: 51.05, lon: 13.74, h: 0 }
 * );
 * await adapter.initialize();
 *
 * // Convert geographic to scene
 * const scenePos = adapter.geographicToENU(51.06, 13.75, 100);
 *
 * // Convert scene to geographic
 * const geoPos = adapter.enuToGeographic(scenePos);
 * ```
 *
 * @category Runtime
 */
export class CoordinateAdapter {
  private crsCode: string;
  private proj4Def: string;
  private origin: ComputedOrigin;
  private proj4: Proj4Function | null = null;
  private _initialized = false;

  /** Reusable Vector3 for intermediate calculations */
  private _tempVec = new Vector3();

  /**
   * Create a new CoordinateAdapter
   *
   * @param crs - Project CRS configuration
   * @param origin - Geographic origin point
   */
  constructor(crs: ProjectCRS, origin: GeographicCoords) {
    this.crsCode = crs.code;
    this.proj4Def = crs.proj4;
    this.origin = {
      lat: origin.lat,
      lon: origin.lon,
      h: origin.h || 0,
      ecef: { x: 0, y: 0, z: 0 },
      crs: { x: 0, y: 0 },
    };
  }

  /**
   * Whether the adapter has been initialized
   */
  get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Initialize async dependencies (proj4)
   *
   * Must be called before using any transformation methods.
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;

    this.proj4 = await getProj4();

    // Register CRS if not already defined
    if (!this.proj4.defs(this.crsCode)) {
      this.proj4.defs(this.crsCode, this.proj4Def);
    }

    // Compute ECEF for origin
    this.origin.ecef = this.geodeticToECEF(
      this.origin.lat,
      this.origin.lon,
      this.origin.h,
    );

    // Compute CRS coordinates for origin
    const crsCoords = this.proj4('EPSG:4326', this.crsCode, [
      this.origin.lon,
      this.origin.lat,
    ]);
    this.origin.crs = { x: crsCoords[0], y: crsCoords[1] };

    this._initialized = true;
  }

  // ============================================================================
  // ENU ↔ CRS TRANSFORMATIONS
  // ============================================================================

  /**
   * Convert ENU scene coordinates to project CRS coordinates
   *
   * Three.js convention: X=East, Y=Up, Z=-North (toward camera)
   * ENU convention: East, North, Up
   * CRS (UTM): Easting, Northing
   *
   * @param enu - ENU scene coordinates
   * @returns CRS coordinates
   */
  enuToCRS(enu: Vector3): { x: number; y: number; z: number } {
    return {
      x: enu.x + this.origin.crs.x, // East → Easting
      y: -enu.z + this.origin.crs.y, // -Z → North → Northing
      z: enu.y, // Y → Up → Height
    };
  }

  /**
   * Convert project CRS coordinates to ENU scene coordinates
   *
   * @param x - CRS Easting
   * @param y - CRS Northing
   * @param z - CRS Height (optional)
   * @returns ENU scene coordinates
   */
  crsToENU(x: number, y: number, z: number = 0): Vector3 {
    return new Vector3(
      x - this.origin.crs.x, // Easting → East (X)
      z, // Height → Up (Y)
      -(y - this.origin.crs.y), // Northing → -North (Z)
    );
  }

  // ============================================================================
  // GEOGRAPHIC ↔ ENU TRANSFORMATIONS
  // ============================================================================

  /**
   * Convert geographic coordinates to ENU scene coordinates
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @param h - Height in meters
   * @returns ENU scene coordinates
   */
  geographicToENU(lat: number, lon: number, h: number = 0): Vector3 {
    const ecef = this.geodeticToECEF(lat, lon, h);
    const enu = this.ecefToENU(ecef);

    return new Vector3(
      enu.east,
      enu.up,
      -enu.north, // Three.js Z points toward camera (south)
    );
  }

  /**
   * Convert ENU scene coordinates to geographic coordinates
   *
   * @param enu - ENU scene coordinates
   * @returns Geographic coordinates
   */
  enuToGeographic(enu: Vector3): GeographicCoords {
    const enuCoords = {
      east: enu.x,
      north: -enu.z, // Three.js Z points toward camera (south)
      up: enu.y,
    };

    const ecef = this.enuToECEF(enuCoords);
    return this.ecefToGeodetic(ecef);
  }

  // ============================================================================
  // GEOGRAPHIC ↔ CRS TRANSFORMATIONS
  // ============================================================================

  /**
   * Convert geographic coordinates to project CRS
   *
   * @param lat - Latitude in degrees
   * @param lon - Longitude in degrees
   * @returns CRS coordinates
   */
  geographicToCRS(lat: number, lon: number): { x: number; y: number } {
    if (!this.proj4) throw new Error('CoordinateAdapter not initialized');
    const result = this.proj4('EPSG:4326', this.crsCode, [lon, lat]);
    return { x: result[0], y: result[1] };
  }

  /**
   * Convert project CRS to geographic coordinates
   *
   * @param x - CRS Easting
   * @param y - CRS Northing
   * @returns Geographic coordinates
   */
  crsToGeographic(x: number, y: number): { lat: number; lon: number } {
    if (!this.proj4) throw new Error('CoordinateAdapter not initialized');
    const result = this.proj4(this.crsCode, 'EPSG:4326', [x, y]);
    return { lon: result[0], lat: result[1] };
  }

  // ============================================================================
  // ECEF TRANSFORMATIONS (Internal)
  // ============================================================================

  /**
   * Convert geodetic coordinates to ECEF
   *
   * @internal
   */
  private geodeticToECEF(
    lat: number,
    lon: number,
    h: number,
  ): { x: number; y: number; z: number } {
    const φ = (lat * Math.PI) / 180;
    const λ = (lon * Math.PI) / 180;

    const sinφ = Math.sin(φ);
    const cosφ = Math.cos(φ);
    const sinλ = Math.sin(λ);
    const cosλ = Math.cos(λ);

    // Radius of curvature in the prime vertical
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinφ * sinφ);

    return {
      x: (N + h) * cosφ * cosλ,
      y: (N + h) * cosφ * sinλ,
      z: (N * (1 - WGS84_E2) + h) * sinφ,
    };
  }

  /**
   * Convert ECEF to ENU relative to origin
   *
   * @internal
   */
  private ecefToENU(ecef: {
    x: number;
    y: number;
    z: number;
  }): { east: number; north: number; up: number } {
    const φ = (this.origin.lat * Math.PI) / 180;
    const λ = (this.origin.lon * Math.PI) / 180;

    // Difference from origin
    const dx = ecef.x - this.origin.ecef.x;
    const dy = ecef.y - this.origin.ecef.y;
    const dz = ecef.z - this.origin.ecef.z;

    const sinφ = Math.sin(φ);
    const cosφ = Math.cos(φ);
    const sinλ = Math.sin(λ);
    const cosλ = Math.cos(λ);

    // Rotation matrix from ECEF to ENU
    return {
      east: -sinλ * dx + cosλ * dy,
      north: -sinφ * cosλ * dx - sinφ * sinλ * dy + cosφ * dz,
      up: cosφ * cosλ * dx + cosφ * sinλ * dy + sinφ * dz,
    };
  }

  /**
   * Convert ENU to ECEF
   *
   * @internal
   */
  private enuToECEF(enu: {
    east: number;
    north: number;
    up: number;
  }): { x: number; y: number; z: number } {
    const φ = (this.origin.lat * Math.PI) / 180;
    const λ = (this.origin.lon * Math.PI) / 180;

    const sinφ = Math.sin(φ);
    const cosφ = Math.cos(φ);
    const sinλ = Math.sin(λ);
    const cosλ = Math.cos(λ);

    // Inverse rotation matrix from ENU to ECEF
    const dx =
      -sinλ * enu.east - sinφ * cosλ * enu.north + cosφ * cosλ * enu.up;
    const dy =
      cosλ * enu.east - sinφ * sinλ * enu.north + cosφ * sinλ * enu.up;
    const dz = cosφ * enu.north + sinφ * enu.up;

    return {
      x: dx + this.origin.ecef.x,
      y: dy + this.origin.ecef.y,
      z: dz + this.origin.ecef.z,
    };
  }

  /**
   * Convert ECEF to geodetic coordinates
   *
   * Uses Bowring's iterative method for accuracy.
   *
   * @internal
   */
  private ecefToGeodetic(ecef: {
    x: number;
    y: number;
    z: number;
  }): GeographicCoords {
    const { x, y, z } = ecef;

    // Semi-minor axis
    const b = Math.sqrt(WGS84_A * WGS84_A * (1 - WGS84_E2));

    // Second eccentricity squared
    const ep2 = (WGS84_A * WGS84_A - b * b) / (b * b);

    // Horizontal distance from Z axis
    const p = Math.sqrt(x * x + y * y);

    // Parametric latitude approximation
    const th = Math.atan2(WGS84_A * z, b * p);

    // Longitude
    const lon = Math.atan2(y, x);

    // Latitude using Bowring's formula
    const lat = Math.atan2(
      z + ep2 * b * Math.pow(Math.sin(th), 3),
      p - WGS84_E2 * WGS84_A * Math.pow(Math.cos(th), 3),
    );

    // Height
    const sinφ = Math.sin(lat);
    const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinφ * sinφ);
    const h = p / Math.cos(lat) - N;

    return {
      lat: (lat * 180) / Math.PI,
      lon: (lon * 180) / Math.PI,
      h: h,
    };
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Get the origin in all coordinate systems
   *
   * @returns Copy of the computed origin
   */
  getOrigin(): ComputedOrigin {
    return { ...this.origin };
  }

  /**
   * Update the geographic origin
   *
   * Recomputes ECEF and CRS coordinates for the new origin.
   *
   * @param lat - New latitude in degrees
   * @param lon - New longitude in degrees
   * @param h - New height in meters
   */
  setOrigin(lat: number, lon: number, h: number = 0): void {
    this.origin.lat = lat;
    this.origin.lon = lon;
    this.origin.h = h;
    this.origin.ecef = this.geodeticToECEF(lat, lon, h);

    if (this.proj4) {
      const crsCoords = this.proj4('EPSG:4326', this.crsCode, [lon, lat]);
      this.origin.crs = { x: crsCoords[0], y: crsCoords[1] };
    }
  }

  /**
   * Get the CRS code
   *
   * @returns EPSG code string
   */
  getCRS(): string {
    return this.crsCode;
  }

  /**
   * Get the proj4 definition string
   *
   * @returns Proj4 definition
   */
  getProj4Def(): string {
    return this.proj4Def;
  }
}
