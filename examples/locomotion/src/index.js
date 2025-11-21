/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { AssetType, SessionMode, World } from '@iwsdk/core';

import { SettingsSystem } from './panel.js';
import { ElevatorSystem } from './elevator.js';
import * as horizonKit from '@pmndrs/uikit-horizon';
import { LogInIcon, RectangleGogglesIcon } from '@pmndrs/uikit-lucide';

const assets = {
  switchSound: {
    url: '/audio/switch.mp3',
    type: AssetType.Audio,
    priority: 'background',
  },
};

World.create(document.getElementById('scene-container'), {
  assets,
  render: {
    near: 0.001,
    far: 300,
  },
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    features: {
      handTracking: { required: true },
    },
  },
  level: '/glxf/Composition.glxf',
  features: {
    grabbing: true,
    locomotion: true,
    spatialUI: {
      kits: [horizonKit, { LogInIcon, RectangleGogglesIcon }],
    },
  },
}).then((world) => {
  const { camera } = world;
  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  world.registerSystem(SettingsSystem).registerSystem(ElevatorSystem);
});
