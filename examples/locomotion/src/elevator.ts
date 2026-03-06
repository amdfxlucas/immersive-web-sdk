import { createComponent, createSystem, Types } from '@iwsdk/core';

export const Elevator = createComponent('Elevator', {
  deltaY: { type: Types.Float32, default: 4 },
  speed: { type: Types.Float32, default: 0.5 },
});

export class ElevatorSystem extends createSystem({
  elevator: { required: [Elevator] },
}) {
  update(_delta: number, time: number) {
    this.queries.elevator.entities.forEach((entity) => {
      const speed = entity.getValue(Elevator, 'speed');
      const deltaY = entity.getValue(Elevator, 'deltaY');
      entity.object3D!.position.y = Math.sin(time * speed!) * deltaY!;
    });
  }
}
