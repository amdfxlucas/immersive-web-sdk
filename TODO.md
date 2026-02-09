[Giro3D DrawTool Example](https://giro3d.org/latest/examples/draw-tool.html?view=971027%2C6298491%2C3000%2C972027%2C6299491%2C200)

## right click on parcel produces the following DOM events:
Giro3D PointerEvent: pointerdown
Giro3D Map mousedown
Giro3D Map contextmenu
10x Giro3D PointerEvent: hover
Giro3D PointerEvent: pointerup
Giro3D Map mouseup


i have a question. if you've read the source of UnifiedInputSystem you've noticed the installation of event-listeners on the scene's object3D's and batchedMeshes in onEntityQualify(). Shouldn't this be enough and enable raycasting events out-of-the box for the MapPresenter's scene as well ?! Given that the provided 'fetcher' for the FeatureSource's loads the exact same entitties, in the exact same way into the Giro3d scene just as it does in the XRPresenter's WebXR scene ... 