

add 'createGISEntity()' method to world in addition to createEntity and createTransformEntity().
GISEntities will have a GISFeatureComponent, which contains their GEOJSON coordinates .. 





chunk-3EANIMQW.js?v=91575543:835 Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'bitmask')
    at QueryManager.registerQuery (chunk-3EANIMQW.js?v=91575543:835:21)
    at chunk-3EANIMQW.js?v=91575543:1001:46
    at Array.forEach (<anonymous>)
    at _GISWorld.registerSystem (chunk-3EANIMQW.js?v=91575543:1000:41)
    at registerCoreSystems (chunk-3EANIMQW.js?v=91575543:50611:248)
    at initImpl (chunk-3EANIMQW.js?v=91575543:50459:5)
    at world.onSetPresenter (chunk-3EANIMQW.js?v=91575543:50490:7)
    at _GISWorld.setPresenter (chunk-3EANIMQW.js?v=91575543:50739:12)
    at App.initPresenter (app.js:477:18)
registerQuery	@	chunk-3EANIMQW.js?v=91575543:835
(anonymous)	@	chunk-3EANIMQW.js?v=91575543:1001
registerSystem	@	chunk-3EANIMQW.js?v=91575543:1000
registerCoreSystems	@	chunk-3EANIMQW.js?v=91575543:50611
initImpl	@	chunk-3EANIMQW.js?v=91575543:50459
world.onSetPresenter	@	chunk-3EANIMQW.js?v=91575543:50490
setPresenter	@	chunk-3EANIMQW.js?v=91575543:50739
initPresenter	@	app.js:477
await in initPresenter		
loadProject	@	app.js:507
await in loadProject		




Analysis: Should BatchedMeshManager be part of PresenterContext / IWSDK core?
What the App's Batching System Does
The app has a substantial batching stack:

BatchedMeshManager — geometry aggregation, instance tracking, FID-to-instanceId maps
BatchingStrategyManager — two strategies for per-instance coloring (custom DataTexture vs. @three.ez/batched-mesh-extensions)
DisplaySystemBatchingMixin — deferred material creation/application, style-to-batch bridging
DisplayStyleComponent.batchedInstances — ECS component field linking entities to batch instance IDs
UnifiedInputSystem — instance-to-entity reverse lookup for picking
Arguments FOR putting it in PresenterContext / IWSDK core
BatchedMesh is renderer-coupled: BVH computation (computeBoundsTree) requires the renderer. The @three.ez extensions strategy needs renderer for initialization. If the renderer lives in PresenterContext, batching naturally belongs near it.

Picking needs presenter cooperation: Both XRPresenter and MapPresenter already emit PointerEventData with instanceId and batchName fields (see presenter.ts:170-172). The plumbing for batch picking is already in the presenter interface — but the instance-to-entity resolution lives in the app. Centralizing this eliminates duplication for every consumer.

Visibility system gap: The core VisibilitySystem has a TODO noting that "BatchedMesh instance entities not yet handled." If batching were in core, visibility toggling per-instance would be built-in rather than requiring app-level workarounds.

Cross-presenter consistency: Both XR and Map presenters need to render the same batched content. If the app manages batching independently, it must handle the XR→Map migration of BatchedMesh instances (including BVH, materials, instance maps). If core owned this, deactivate()/initialize() could handle migration transparently.

Draw-call reduction is universal: Any IWSDK app rendering thousands of features (parcels, buildings, infrastructure) will need batching. It's a performance primitive, not a domain-specific feature.

Identity preservation is an IWSDK principle: The whole Presenter abstraction is built on preserving entity identity across views. BatchedMesh breaks this unless you have the fidToInstance/instanceToFid mapping. Making this a framework concern ensures every presenter implementation gets it right.

Arguments AGAINST putting it in PresenterContext / IWSDK core
Application-domain coupling: The batching decision (shouldBatch) depends on geometry type (Polygon vs. Line), feature class names ("segment", "cable"), and threshold heuristics (>5 meshes). These are GIS/domain decisions, not framework decisions. IWSDK core shouldn't know what a "parcel" or "segment" is.

Material strategy is opinionated: The app supports two coloring strategies (DataTexture vs. extensions library). This is a rendering policy choice — core shouldn't force one approach or ship both as options. The custom strategy depends on fragile Three.js shader internals; the extensions strategy depends on @three.ez/batched-mesh-extensions. Neither belongs as a framework dependency.

DisplayModel coupling: Material creation is driven by the DisplayModel/DisplaySystem, which maps feature class styles to materials. The batching mixin (applyBatchMaterial, setBatchInstanceColor) is tightly coupled to this style resolution pipeline. IWSDK core has no concept of display models.

PresenterContext is intentionally thin: It owns renderer + container + swappable scene/camera. Adding batching state (batch maps, strategies, BVH) would bloat it into a "rendering manager" rather than a clean context object. The context should be infrastructure, not policy.

Giro3D/MapPresenter has its own batching path: MapPresenter uses Giro3D's tiling system which manages Object3DLayers independently. Feature objects loaded via FeatureSource may already be batched differently. A single BatchedMeshManager would need to handle both XR (direct scene) and Map (Giro3D tile hierarchy) paths — complexity that may not compose cleanly.

The app's stack works well as-is: The separation — manager does geometry, strategy does materials, mixin bridges to DisplaySystem, input system does picking — is clean and modular. Pulling parts into core risks splitting a coherent design across two packages with different release cycles.

Entity component coupling: DisplayStyleComponent.batchedInstances stores { batchName: instanceId[] } directly on the component. This is a tight coupling between component schema and batching implementation. Framework components should be more generic.

Middle Ground: What COULD go into core
Rather than the full BatchedMeshManager, IWSDK could provide primitives that make app-level batching easier:

Primitive	Where	Purpose
PointerEventData.instanceId/batchName	Already in presenter.ts	Batch picking plumbing (done)
VisibilitySystem BatchedMesh support	Core visibility system	Per-instance visibility via component
A BatchedMeshComponent	Core ECS component	Generic { meshRef, instanceIds } without domain coupling
Batch-aware raycasting helpers	Core input system	Resolve (batchedMesh, instanceId) → entity generically
This keeps the decision-making (what to batch, which strategy, how to style) in the app, while giving the infrastructure (picking, visibility, entity resolution) to the framework.

Recommendation
Don't put BatchedMeshManager in PresenterContext. The context should remain a thin rendering infrastructure holder. Instead, consider extracting the identity-preserving primitives (batch-aware picking, per-instance visibility) into core as optional utilities, while keeping the batching orchestration, material strategies, and domain heuristics in the application layer.

Checklist confirmation: