import {
  createSystem,
  eq,
  PanelDocument,
  PanelUI,
  VisibilityState,
} from '@iwsdk/core';

export class SettingsSystem extends createSystem({
  configuredPanels: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/welcome.json')],
  },
}) {
  init() {
    this.queries.configuredPanels.subscribe('qualify', (entity) => {
      const document = (PanelDocument as any).data.document[entity.index];
      if (!document) {
        return;
      }

      const xrButton = document.getElementById('xr-button');
      xrButton.addEventListener('click', () => {
        this.world.launchXR();
      });

      const exitButton = document.getElementById('exit-button');
      exitButton.addEventListener('click', () => {
        this.world.exitXR();
      });
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
      });
    });
  }
}
