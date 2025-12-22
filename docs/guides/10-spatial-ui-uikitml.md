---
outline: [2, 4]
---

# Chapter 10: Spatial UI with UIKitML

This chapter teaches you how to create immersive spatial user interfaces using [pmndrs/uikit](https://pmndrs.github.io/uikit/docs/), specifically uikitml – IWSDK's spatial UI system.

## What You'll Learn

By the end of this chapter, you'll be able to:

- Understand spatial UI design principles
- Create UI layouts using UIKitML markup
- Position and scale interfaces in 3D space
- Handle user interactions with spatial UI elements
- Implement common UI patterns for WebXR

## Spatial UI Principles

Great spatial interfaces follow these principles:

1. **World-scale**: UI elements have a physical presence in 3D space
2. **Natural interaction**: Use pointing, grabbing, and gestures
3. **Readable at distance**: Text and icons scale appropriately
4. **Contextual placement**: UI appears near relevant objects
5. **Comfortable viewing**: Positioned to avoid neck strain

## Introduction to Building Spatial User Interfaces in IWSDK

The unavailability of HTML in WebXR has been a big challenge for developers, since manually placing user interface elements is very cumbersome. That's why IWSDK uses [pmndrs/uikit](https://pmndrs.github.io/uikit/docs/), a GPU-accelerated UI rendering system that provides an API aligned with HTML and CSS, allowing developers to feel right at home. To make UI authoring even more natural, IWSDK uses the [uikitml](https://github.com/pmndrs/uikitml) language, which allows developers to write user interfaces using an HTML-like syntax, including features such as CSS classes. This integration allows IWSDK developers to reuse their HTML knowledge to quickly build high-performance, GPU-accelerated user interfaces for WebXR. Furthermore, IWSDK makes use of the pre-built component collections offered by the uikit project: the Default Kit (based on shadcn) and the Horizon Kit (based on the Reality Labs Design System).

### Key Features

- **Declarative markup**: Describe UI structure, not implementation
- **3D layout system**: Flexbox-like layouts in 3D space
- **Component Kits**: Pre-built buttons, panels, sliders, etc.
- **Event system**: Handle clicks, hovers, and other interactions
- **Theming support**: Consistent styling across your application

### Basic Syntax

UIKitML uses HTML-style markup with CSS properties for styling and layouting:

```html
<!-- Basic panel with text -->
<div class="panel" style="width: 400; height:300; background-color: #2a2a2a">
  <text style="fontSize:24px; color: white">Hello WebXR!</text>
  <button>Click Me</button>
</panel>
```

## Setting Up UIKitML with IWSDK

### Vite Plugin Configuration

IWSDK includes a Vite plugin that compiles UIKitML files:

```typescript
// vite.config.js
import { defineConfig } from 'vite';
import { compileUIKit } from '@iwsdk/vite-plugin-uikitml';

export default defineConfig({
  plugins: [
    compileUIKit({
      sourceDir: 'ui', // Directory containing .uikitml files
      outputDir: 'public/ui', // Where compiled .json files are written
      verbose: true, // Enable build logging
    }),
  ],
});
```

### Creating Your First UIKitML File

Create `src/ui/main-menu.uikitml` and insert the following content, which uses the Panel, Button, ButtonIcon, and LoginIcon components from the Horizon Kit to design a panel with a button:

```html
<style>
  .panel-root {
    padding: 16px;
    flex-direction: column;
    width: 344px;
  }
</style>
<Panel class="panel-root">
  <button id="xr-button">
    <ButtonIcon>
      <LoginIcon></LoginIcon>
    </ButtonIcon>
    Enter XR
  </button>
</Panel>
```

### Loading UI in Your Application

We can add our `panelWithButton` uikitml user interface to our IWSDK scene using the `PanelUI` and `PanelDocument` components:

```typescript
export class PanelSystem extends createSystem({
  panelWithButton: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', '/ui/main-menu.json')],
  },
}) {}
```

### Component Kits

Component kits provide pre-built UI components like buttons, panels, inputs, and icons. IWSDK supports multiple kits that can be combined in your application.

#### Available Component Kits

- **`@pmndrs/uikit-horizon`** - Reality Labs design system (buttons, panels, inputs)
- **`@pmndrs/uikit-lucide`** - Icon library with 1000+ icons
- **`@pmndrs/uikit-default`** - Default kit based on shadcn design system

#### Basic Kit Configuration

Configure kits in the `spatialUI` feature when creating your world:

```typescript
import * as horizonKit from '@pmndrs/uikit-horizon';

World.create(document.getElementById('scene-container'), {
  features: {
    spatialUI: {
      kits: [horizonKit],
    },
  },
});
```

#### Combining Multiple Kits

You can use components from multiple kits by passing them as an array:

```typescript
import * as horizonKit from '@pmndrs/uikit-horizon';
import * as defaultKit from '@pmndrs/uikit-default';

World.create(document.getElementById('scene-container'), {
  features: {
    spatialUI: {
      kits: [horizonKit, defaultKit],
    },
  },
});
```

#### Optimizing Bundle Size with Selective Imports

For large icon libraries like `@pmndrs/uikit-lucide` (which contains over 1000 icons), importing the entire package can significantly increase your bundle size. Instead, import only the icons you need:

```typescript
import * as horizonKit from '@pmndrs/uikit-horizon';
import {
  LogInIcon,
  RectangleGogglesIcon,
  SettingsIcon,
} from '@pmndrs/uikit-lucide';

World.create(document.getElementById('scene-container'), {
  features: {
    spatialUI: {
      kits: [
        horizonKit,
        { LogInIcon, RectangleGogglesIcon, SettingsIcon }, // Only these icons
      ],
    },
  },
});
```

This technique works with any kit component - just import what you need and pass it as an object in the kits array.

## Color Scheme & Theming

UIKitML supports automatic light and dark mode theming that can follow system preferences or be explicitly set.

### Configuring Color Scheme

Set the preferred color scheme when creating your world:

```typescript
import { ColorSchemeType } from '@iwsdk/core';

World.create(document.getElementById('scene-container'), {
  features: {
    spatialUI: {
      preferredColorScheme: ColorSchemeType.Dark, // Force dark mode
    },
  },
});
```

**Available color schemes:**

- `ColorSchemeType.System` - Automatically follows browser/OS preference (default)
- `ColorSchemeType.Light` - Force light mode
- `ColorSchemeType.Dark` - Force dark mode

### Changing Color Scheme at Runtime

You can dynamically change the color scheme after initialization:

```typescript
const world = await World.create(container, {
  /* ... */
});
const panelSystem = world.getSystem(PanelUISystem);

// Switch to light mode
panelSystem.config.preferredColorScheme.value = ColorSchemeType.Light;

// Switch to dark mode
panelSystem.config.preferredColorScheme.value = ColorSchemeType.Dark;

// Follow system preference
panelSystem.config.preferredColorScheme.value = ColorSchemeType.System;
```

### Dark Mode Styling

Use the `:dark` pseudo-selector to define styles that apply only in dark mode:

```html
<style>
  .heading {
    color: #272727; /* Light mode color */
    font-size: 24px;
    font-weight: 700;
  }

  .heading:dark {
    color: rgba(255, 255, 255, 0.9); /* Dark mode color */
  }

  .panel {
    background-color: #ffffff;
    border: 1px solid #e0e0e0;
  }

  .panel:dark {
    background-color: #1a1a1a;
    border: 1px solid #333333;
  }
</style>

<Panel class="panel">
  <span class="heading">Hello, Immersive Web!</span>
</Panel>
```

The UI automatically updates when the color scheme changes, with no additional code needed.

## Overview of Properties and Features Available for Building Spatial User Interfaces

When authoring a User Interface with IWSDK, developers can use almost all the features they know and love from HTML.
The following section shows all the available element types and styling methods for designing Spatial User Interfaces.

### Element Types

#### Container Elements

Most HTML elements become containers that can hold children and text.

```html
<div>Layout container</div>
<p>Paragraph text</p>
<h1>Main heading</h1>
<button>Click me</button>
<ul>
  <li>List item</li>
</ul>
```

#### Image Elements

Display bitmap images in your 3D UI.

```html
<img src="photo.jpg" alt="Description" />
<img src="icon.png" class="avatar" />
<img src="icon.svg" />
```

**Required:** `src` attribute

#### Inline SVG Elements

Embed SVG markup directly in your UI.

```html
<svg viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="40" fill="blue" />
  <rect x="10" y="10" width="30" height="30" fill="red" />
</svg>
```

**Content:** Raw SVG markup is preserved and rendered

#### Video Elements

Display video content with standard HTML5 video attributes.

```html
<video src="movie.mp4" controls autoplay /> <video src="demo.webm" loop muted />
```

**Required:** `src` attribute
**Supports:** All standard HTML5 video attributes

#### Input Elements

Create interactive input fields for user data.

```html
<input type="text" placeholder="Enter your name" />
<input type="email" value="user@example.com" />
<textarea placeholder="Multi-line text input">Default content</textarea>
```

#### Component Kits

In addition to these elements, developers can also use the installed kits.

```html
<button id="xr-button">
  <ButtonIcon>
    <LoginIcon></LoginIcon>
  </ButtonIcon>
  Enter XR
</button>
```

## Styling System

### Inline Styles

Use familiar CSS properties with kebab-casing directly on elements:

```html
<div style="background-color: blue; padding: 20px; border-radius: 8px;">
  Styled container
</div>
```

### CSS Classes

Define reusable styles with full pseudo-selector support using the `<style>` tag:

```html
<style>
  .button {
    background-color: #3b82f6;
    color: white;
    padding: 12px 24px;
    border-radius: 6px;
    cursor: pointer;
  }

  .button:hover {
    background-color: #2563eb;
    transform: scale(1.05);
  }

  .button:active {
    background-color: #1d4ed8;
    transform: scale(0.95);
  }

  /* Responsive styles */
  .button:sm {
    padding: 8px 16px;
    font-size: 14px;
  }

  .button:lg {
    padding: 16px 32px;
    font-size: 18px;
  }
</style>

<button class="button">Interactive Button</button>
```

**Supported selectors:**

- **States:** `:hover`, `:active`, `:focus`
- **Theme:** `:dark` - Applies styles in dark mode
- **Responsive:** `:sm`, `:md`, `:lg`, `:xl`, `:2xl`

### ID-Based Styling

Style specific elements using ID selectors:

```html
<style>
  #header {
    background-color: #ff6b6b;
    padding: 20px;
    justify-content: center;
  }

  #header:hover {
    opacity: 0.9;
  }
</style>

<div id="header">
  <h1>Welcome to uikitml</h1>
</div>
```

## Handling User Interactions

UIKitML provides an event system for handling user interactions:

```typescript
export class PanelSystem extends createSystem({
  welcomePanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', '/ui/main-menu.json')],
  },
}) {
  init() {
    this.queries.welcomePanel.subscribe('qualify', (entity) => {
      const document = PanelDocument.data.document[
        entity.index
      ] as UIKitDocument;
      if (!document) return;

      const xrButton = document.getElementById('xr-button') as UIKit.Text;
      xrButton.addEventListener('click', () => {
        // TODO: add your interactivity here
      });
    });
  }
}
```

## Troubleshooting

### UI Not Appearing

**UI document loads but nothing shows?**

- Check that the position is in front of the player
- Verify the scale is appropriate (try 0.001 for pixel-based layouts)
- Ensure UISystem is registered with the world
- Ensure your elements have a color different then their background

### Interaction Issues

**Clicks not working?**

- Verify event listeners are attached to the UI element
- Check if anything is blocking the UI

### Layout Issues

**Elements not positioning correctly?**

- Check `flexDirection` and alignment properties
- Verify the parent container has appropriate dimensions
- Use the UIKitML VSCode extension to understand the size and position of individual elements by hovering over them
