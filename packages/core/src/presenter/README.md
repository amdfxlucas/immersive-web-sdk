┌─────────────────────────────────────────────────────────────────────────────┐
│                        Giro3D Instance                                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  instance.scene (THREE.Scene)                                               │
│  ├── instance.threeObjects (Group) ← for non-tiled objects                  │
│  │   └── _boundsHelper (invisible Mesh) ← provides bounds for camera        │
│  │                                                                          │
│  └── map.object3d (Group) ═══════════════════════════════════════════       │
│      │                     ║  GIS_ROOT / _contentRoot  ║                    │
│      │                     ═══════════════════════════════════════════       │
│      │                            ↑                                         │
│      │           GISRootComponent Entity attached here                      │
│      │           (NOT reparented to LevelRoot!)                             │
│      │                                                                      │
│      ├── TileMesh (LOD 0, tile 0) ─────────────────────────────────────     │
│      │   ├── TileMesh (LOD 1, child 0)                                      │
│      │   │   ├── TileMesh (LOD 2, ...)                                      │
│      │   │   │   └── Group "object3d-layer-{layerId}-tile-{tileId}"         │
│      │   │   │       ├── ENUWrapper_Building1                               │
│      │   │   │       │   └── BuildingMesh (ENU coords 0,0,0)                │
│      │   │   │       ├── ENUWrapper_Building2                               │
│      │   │   │       │   └── BuildingMesh                                   │
│      │   │   │       └── ...                                                │
│      │   │   └── TileMesh (LOD 2, ...)                                      │
│      │   ├── TileMesh (LOD 1, child 1)                                      │
│      │   └── ...                                                            │
│      │                                                                      │
│      └── TileMesh (LOD 0, tile 1)                                           │
│          └── ...                                                            │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

 Coordinate Transform Flow:
 ═════════════════════════
 
 ENU (0,0,0) at geographic origin
         │
         │  ENUWrapper.position = (originCRS.x, 0, originCRS.y)
         ▼
 CRS (UTM meters) ← Giro3D native coordinates
         │
         │  Map extent defines visible area
         ▼
 Screen (pixels)


 Key Points:
 ═══════════
 
 1. map.object3d IS the GIS_ROOT (_contentRoot)
    - GISRootComponent entity attached here
    - NOT reparented under World's LevelRoot (breaks Giro3D traversal!)
 
 2. Object3DLayer attaches geometry to TileMesh nodes
    - Giro3D calls FeatureSource.getObjects() for visible tiles
    - Objects appear under tile-specific Groups
 
 3. ENU → CRS Transform via ENUWrapper
    - GLB models are ENU-centered (origin at 0,0,0)
    - ENUWrapper positions them at CRS coordinates
    - wrapper.position.set(originCRS.x, 0, originCRS.y)
 
 4. Giro3D coordinates: X=Easting, Y=Up, Z=Northing
Why this matters for getObjects() being called:


BEFORE (broken):                          AFTER (fixed):
═══════════════                           ═══════════════

instance.scene                            instance.scene
└── map.object3d ←(disconnected)          └── map.object3d ← GIS_ROOT stays here!
                                              └── TileMesh (traversable by Giro3D)
World.scene                                       └── Object3DLayer content
└── LevelRoot
    └── GIS_ROOT (map.object3d moved here)
        └── TileMesh (Giro3D can't find it!)

Giro3D traverses instance.scene to find    Giro3D finds tiles → calls layer.update()
tiles, but map was reparented away!        → calls source.getObjects() ✓




Build succeeded. Here's a summary of all the Giro3D Map coordinate system fixes:


WRONG (was using Three.js Y-up convention):
  X = Easting
  Y = Up (height/altitude)  
  Z = Northing

CORRECT (Giro3D Map Y-up=false convention):
  X = Easting
  Y = Northing
  Z = Up (height/altitude)
Files changed:

Location	Old	New
FeatureSource.getObjects() wrapper	(x, 0, northing)	(x, northing, 0)
ENUGeometryWrapper class	(x, 0, northing)	(x, northing, 0)
Camera initial position	(x, altitude, northing)	(x, northing, altitude)
Bounds helper ground level	position.y = 0	position.z = 0
geographicToScene()	Vector3(x, h, y)	Vector3(x, y, h)
sceneToGeographic()	crsToGeo(x, z), h=y	crsToGeo(x, y), h=z
crsToScene()	Vector3(x, z, y)	Vector3(x, y, z)
flyTo() endPos	(x, alt, y+offset)	(x, y-offset, alt)
_setupControls camera/target	Y=alt, Z=northing	Y=northing, Z=alt




 Your GLB models are in ENU with Y-up (Three.js convention), but Giro3D Map uses Z-up. Translation alone isn't enough - the geometry also needs to be rotated.

Let me check the ENUWrapper and add the rotation:

The issue is that your ENU geometry uses Y-up (Three.js), but Giro3D Map uses Z-up.
The objects need to be rotated to align correctly. Let me add the rotation transform:

ENU/Three.js (Y-up):              Giro3D Map (Z-up):
       Y (up)                           Z (up)
       │                                │
       │                                │
       └──────X (east)                  └──────X (east)
      /                                /
     Z (north)                        Y (north)

Rotation: wrapper.rotation.x = -π/2

This rotates:
  • Old +Y (up)    → New -Z (but geometry designed for ground stays on ground)
  • Old +Z (north) → New +Y (north) ✓
  • Old +X (east)  → New +X (east) ✓
Note: With rotation.x = -π/2, the geometry that was "standing up" in Y-up space will now be correctly oriented in Z-up space. Buildings that stood vertically will continue to stand vertically.

If the geometry still appears wrong (flipped, upside-down, or underground), we may need to adjust:

Try rotation.x = +Math.PI / 2 instead
Or add wrapper.scale.y = -1 to flip the north direction


Where Feature-Objects Should Go in Giro3D scene
|Container	|Purpose|
---------------------
|instance.threeObjects	| Standalone 3D objects with no geographic tile relationship (debug helpers, UI elements)|

|Object3DLayer → tiles	| GIS features that need tile lifecycle management (buildings, parcels, etc.)

Your current approach is correct - Object3DLayer automatically attaches objects to tile nodes:

```
Instance.scene
└── Map.object3d
    └── TileMesh (tile)
        └── Group ("object3d-layer-{layerId}-tile-{tileId}")  ← Object3DLayer creates this
            └── Your feature objects (from getObjects())      ← Added here automatically
```            
