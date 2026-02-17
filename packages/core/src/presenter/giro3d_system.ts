import { MapLayerComponent } from "./map3d_components";
import { createSystem } from "../ecs";

/**
 * @brief synchronizes Layers between the ECS world and 
 *         the MapPresenter's Giro3D Map
 * @details user can spawn layers (entities with MapLayerComponent)
 *          and they'll be picked up by this system.
 */
export class Giro3DSystem extends createSystem({
    layers: {
        required: [MapLayerComponent],
    }
})
{
    map_presenter: any;

    setPresenter(presenter: any) {
        this.map_presenter = presenter;
        if (this.map_presenter) {
            this.queries.layers.subscribe('qualify', (entity) => {
                this.map_presenter._addECSLayerImpl?.(entity);
            });

            this.map_presenter._addECSLayers();

        }

    }

    init() {

    }
};