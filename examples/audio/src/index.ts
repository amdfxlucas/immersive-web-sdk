import {
  AssetManager,
  AssetManifest,
  AssetType,
  AudioSource,
  EnvironmentType,
  LocomotionEnvironment,
  PanelUI,
  PlaybackMode,
  PokeInteractable,
  RayInteractable,
  ScreenSpace,
  SessionMode,
  World,
} from '@iwsdk/core';
import * as horizonKit from '@pmndrs/uikit-horizon';
import { LogInIcon, RectangleGogglesIcon } from '@pmndrs/uikit-lucide';
import { SettingsSystem } from './panel.js';
import { Spinner, SpinSystem } from './spin.js';

const assets: AssetManifest = {
  switchSound: {
    url: './audio/switch.mp3',
    type: AssetType.Audio,
    priority: 'background',
  },
  song: {
    url: './audio/beepboop.mp3',
    type: AssetType.Audio,
    priority: 'background',
  },
  webxrLogo: {
    url: './textures/webxr.jpg',
    type: AssetType.Texture,
    priority: 'critical',
  },
  environmentDesk: {
    url: './gltf/environmentDesk/environmentDesk.gltf',
    type: AssetType.GLTF,
    priority: 'critical',
  },
  robot: {
    url: './gltf/robot/robot.gltf',
    type: AssetType.GLTF,
    priority: 'critical',
  },
};

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    features: {
      handTracking: { required: true },
    },
  },
  features: {
    locomotion: true,
    spatialUI: { kits: [horizonKit, { LogInIcon, RectangleGogglesIcon }] },
  },
}).then((world) => {
  const { camera } = world;
  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  // Static environment floor
  const { scene: envMesh } = AssetManager.getGLTF('environmentDesk')!;
  envMesh.rotateY(Math.PI);
  envMesh.position.set(0, -0.107, 0);
  world
    .createTransformEntity(envMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  // Robot 1 (center) — playbackMode: restart
  const { scene: robotMesh1 } = AssetManager.getGLTF('robot')!;
  robotMesh1.scale.setScalar(0.5);
  robotMesh1.position.set(0, 0.95, -1.8);
  world
    .createTransformEntity(robotMesh1)
    .addComponent(RayInteractable)
    .addComponent(Spinner)
    .addComponent(AudioSource, {
      src: './audio/beepboop.mp3',
      positional: true,
      maxInstances: 5,
      playbackMode: PlaybackMode.Restart,
    });

  // Robot 2 (left) — playbackMode: fade-restart
  const robotMesh2 = robotMesh1.clone();
  robotMesh2.position.set(-0.5, 0.95, -1.8);
  world
    .createTransformEntity(robotMesh2)
    .addComponent(RayInteractable)
    .addComponent(Spinner)
    .addComponent(AudioSource, {
      src: './audio/beepboop.mp3',
      positional: true,
      maxInstances: 5,
      playbackMode: PlaybackMode.FadeRestart,
    });

  // Robot 3 (right) — playbackMode: overlap
  const robotMesh3 = robotMesh1.clone();
  robotMesh3.position.set(0.5, 0.95, -1.8);
  world
    .createTransformEntity(robotMesh3)
    .addComponent(RayInteractable)
    .addComponent(Spinner)
    .addComponent(AudioSource, {
      src: './audio/beepboop.mp3',
      positional: true,
      maxInstances: 5,
      playbackMode: PlaybackMode.Overlap,
    });

  // Welcome panel (screen-space)
  const panelEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: './ui/welcome.json',
      maxWidth: 1.8,
      maxHeight: 1.0,
    })
    .addComponent(RayInteractable)
    .addComponent(PokeInteractable)
    .addComponent(ScreenSpace, {
      top: '20px',
      left: '20px',
      height: '40%',
      right: 'auto',
      bottom: 'auto',
      width: 'auto',
      zOffset: 0.2,
    });
  panelEntity.object3D!.position.set(0, 1.6, -2.2);

  world.registerSystem(SettingsSystem).registerSystem(SpinSystem);
});
