---
name: catalog-assets
description: Catalog and index 3D model assets or image libraries by spawning parallel subagents. Use when the user wants to document, describe, or create a searchable index of asset files like GLB models, textures, or images.
argument-hint: [asset-folder-path]
---

# Asset Cataloging with Parallel Subagents

Create a searchable catalog of 3D models, images, or other assets by:

1. Examining preview images or asset files
2. Writing detailed descriptions
3. Organizing into category-based markdown files
4. Creating a master index

## Process

### Step 1: Discover Assets

First, list all assets and identify natural categories:

```bash
# For 3D models with previews
ls -1 [asset-folder]/Previews/*.png | xargs -n1 basename | sort

# For GLB files directly
ls -1 [asset-folder]/*.glb | xargs -n1 basename | sort
```

Group assets by prefix (e.g., `wall-*`, `door-*`, `shape-*`).

### Step 2: Create Catalog Directory

```bash
mkdir -p [asset-folder]/catalog
```

### Step 3: Spawn Parallel Subagents

Launch one subagent per category. Each subagent:

- Reads preview images (PNG) or examines assets
- Writes descriptions to a category markdown file
- Includes: visual description, proportions, suggested use cases

**CRITICAL: Launch ALL agents in a single message with multiple Task tool calls.**

Example agent prompt template:

```
Look at these preview images and write detailed descriptions for a model catalog.

Preview folder: [full-path]/Previews/

Models to examine (read each PNG image):
- [model-a].png
- [model-b].png
- [model-c].png

For each model, describe:
1. What it looks like visually (shape, style, colors)
2. Approximate proportions
3. Suggested use cases in a VR/3D scene

Write the catalog to: [full-path]/catalog/[category-name].md

Format as markdown with each model as a section. Include the GLB filename.
```

### Step 4: Write Master Index

After all agents complete, create `catalog/README.md` with:

- Summary statistics (total models, categories)
- Table linking to each category file
- Quick reference by use case
- Any metadata (animations, vertex counts, license info)

## Example: Kenney Prototype Kit

This pattern was used to catalog the Kenney Prototype Kit (143 models):

**Categories created (14 parallel agents):**
| Category | Models | Agent Task |
|----------|--------|------------|
| animals-figurines | 7 | Characters and creatures |
| buttons-levers | 6 | Interactive controls |
| columns | 6 | Architectural pillars |
| doors | 6 | Animated doorways |
| floors | 8 | Ground surfaces |
| indicators | 17 | Waypoints and markers |
| ladders-stairs | 11 | Vertical navigation |
| misc-props | 7 | Coins, crates, flags |
| numbers | 20 | Scoreboards, room numbers |
| pipes | 6 | Industrial segments |
| shapes | 18 | Geometric primitives |
| targets-weapons | 6 | Combat props |
| vehicles | 2 | Cars |
| walls | 25 | Room construction |

**Output structure:**

```
kenney_prototype-kit/catalog/
├── README.md              (Master index)
├── animals-figurines.md
├── buttons-levers.md
├── columns.md
├── doors.md
├── floors.md
├── indicators.md
├── ladders-stairs.md
├── misc-props.md
├── numbers.md
├── pipes.md
├── shapes.md
├── targets-weapons.md
├── vehicles.md
└── walls.md
```

## Tips

- **Maximize parallelism**: Launch all category agents in one message
- **Use general-purpose subagent**: It can read images and write files
- **Group by prefix**: Asset naming conventions usually reveal categories
- **Include file references**: Always note the actual asset filename (GLB, PNG, etc.)
- **Add use cases**: Descriptions are more useful when they suggest how to use the asset

## Reference Catalog

The Kenney Prototype Kit catalog is at:
`kenney_prototype-kit/catalog/README.md`
