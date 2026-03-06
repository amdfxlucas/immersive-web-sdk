import {
  AssetManifest,
  Color,
  FrontSide,
  Mesh,
  MeshStandardMaterial,
  PanelUI,
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PokeInteractable,
  RayInteractable,
  ScreenSpace,
  SessionMode,
  SphereGeometry,
  World,
} from '@iwsdk/core';
import * as horizonKit from '@pmndrs/uikit-horizon';
import { LogInIcon, RectangleGogglesIcon } from '@pmndrs/uikit-lucide';
import { SettingsSystem } from './panel.js';

const assets: AssetManifest = {};

World.create(document.getElementById('scene-container') as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    features: { handTracking: true },
  },
  level: './glxf/Composition.glxf',
  features: {
    grabbing: true,
    locomotion: true,
    physics: true,
    spatialUI: { kits: [horizonKit, { LogInIcon, RectangleGogglesIcon }] },
  },
}).then((world) => {
  const { scene, camera } = world;
  camera.position.set(5, 2, 5);
  camera.rotateY(Math.PI / 4);

  scene.background = new Color(0x808080);

  const body = new Mesh(
    new SphereGeometry(0.2),
    new MeshStandardMaterial({
      side: FrontSide,
      color: new Color(Math.random(), Math.random(), Math.random()),
    }),
  );
  body.position.set(-1, 1.5, 0.5);
  scene.add(body);
  const entity = world.createTransformEntity(body);
  entity.addComponent(PhysicsShape, {
    shape: PhysicsShapeType.Sphere,
    dimensions: [0.2, 0.2, 0.2],
  });
  entity.addComponent(PhysicsBody, { state: PhysicsState.Dynamic });
  entity.addComponent(PhysicsManipulation, { force: [10, 1, 1] });

  const panelEntity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: './ui/welcome.json',
      maxHeight: 0.4,
      maxWidth: 0.5,
    })
    .addComponent(RayInteractable)
    .addComponent(PokeInteractable)
    .addComponent(ScreenSpace, {
      top: '20px',
      left: '20px',
      height: '50%',
    });
  panelEntity.object3D!.position.set(0, 1.5, -1.4);

  world.registerSystem(SettingsSystem);
});
