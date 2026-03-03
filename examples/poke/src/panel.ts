import {
  createSystem,
  PanelUI,
  PanelDocument,
  eq,
  UIKitDocument,
  VisibilityState,
  AudioUtils,
} from '@iwsdk/core';

export class PanelSystem extends createSystem({
  welcomePanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, 'config', './ui/welcome.json')],
  },
}) {
  private clickCount = 0;

  init() {
    this.queries.welcomePanel.subscribe('qualify', (entity) => {
      const document = PanelDocument.data.document[
        entity.index
      ] as UIKitDocument;
      if (!document) {
        return;
      }

      // Set up the click counter button
      const counterButton = document.getElementById('counter-button');
      if (counterButton) {
        counterButton.addEventListener('click', () => {
          this.clickCount++;
          counterButton.setProperties({ text: `Click - ${this.clickCount}` });
          AudioUtils.play(entity);
        });
      }

      // Set up XR button to launch XR
      const xrButton = document.getElementById('xr-button');
      if (xrButton) {
        xrButton.addEventListener('click', () => {
          this.world.launchXR();
        });
      }

      // Set up exit button to exit XR
      const exitButton = document.getElementById('exit-button');
      if (exitButton) {
        exitButton.addEventListener('click', () => {
          this.world.exitXR();
        });
      }

      // Toggle button visibility based on XR state
      this.world.visibilityState.subscribe((visibilityState) => {
        const is2D = visibilityState === VisibilityState.NonImmersive;
        if (xrButton) {
          xrButton.setProperties({ display: is2D ? 'flex' : 'none' });
        }
        if (exitButton) {
          exitButton.setProperties({ display: is2D ? 'none' : 'flex' });
        }
      });
    });
  }
}
