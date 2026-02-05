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