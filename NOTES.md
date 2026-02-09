

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