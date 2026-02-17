import { Types, createComponent } from '../ecs/index.js';

export const MapLayerType = { 
    // displays objects i.e. from GLB
    OBJECT3D: 'object3d', 
    COLOR: 'color',
    ELEVATION: 'elevation',
    MASK: 'mask',
    // similar to OBJECT3D but does all the geo-to-scene conversion in frontend
    VECTOR: 'vector', // same as FEATURE only renamed
    //FEATURE: 'feature', // vector/feature-collection 
    POINT_CLOUD: 'pointcloud'
};

// same as Giro3D/core/layer/LayerOptions + ElevationLayerOptions + ColorLayerOptions + MaskLayerOptions
export const MapLayerComponent = createComponent(
  'MapLayer',
  {
    // identifier of the layer in Application's DisplayModel
    name: {type: Types.String, default: ''},
    type: {type: Types.Enum, enum: MapLayerType, default: MapLayerType.COLOR},
    layer: {type: Types.Object, default: null}, // the actual Giro3D Layer object

    opacity: {type: Types.Float32, default: 1.0},
    resolutionFactor: {type: Types.Float32, default: 1.0},
    // preload of low resolution fallback images
    preloadImages: {type: Types.Boolean, default: false},
    showTileBorders: {type: Types.Boolean, default: false},
    computeMinMax: {type: Types.Boolean, default: true},
    showEmptyTextures: {type: Types.Boolean, default: false},
    // extent: {type: Types.Vec4}, or bbox-string: 'minX,minY,maxX,maxY,EPSG:<code>'
    extent: {type: Types.Object, default: null}, // Giro3D/core/geographic/Extent
    source: {type: Types.Object, default: null}, // Giro3D/core/sources/ImageSource
    noDataOptions: {type: Types.Object, default: null},
    //  default: {alpha: 1.0, maxSearchDistance: 10, replaceNoData: false} } // Giro3D/core/layer/NoDataOptions
    // interpretation: {type: Types.Object, default: null} // Giro3D/core/layer/interpretation
    // magFilter: 
    // minFilter:
    backgroundColor: {type: Types.String, default: ''}, // actually Giro3D/external/three/ ColorRepresentation
    colorMap: {type: Types.Object, default: null}, // Giro3D/core/ColorMap
    //minmax: {type: Types.Object, default: null} // Giro3D/core/ElevationRange
    // blendingMode: {type: Types.Enum, } // Giro3D/core/layer/BlendingMode
    // maskMode: {type: Types.Enum, } // Giro3D/core/layer/MaskMode
    
  },
   'A Layer of the MapPresenters Giro3D Map and/or its DisplayStyle Options' // TODO clarify
);

export const SourceType = {
  //CUSTOM: 'CUSTOM', // same as OBJECT3D
  OBJECT3D: 'OBJECT3D', // Object3dSource has no built-in implementation in Giro3D -> custom user-provided impl.
  WMS: 'WMS',
  WMTS: 'WMTS',
  WFS: 'WFS',
  WCS: 'WCS',
  VECTOR: 'VECTOR',
  VECTOR_TILE: 'VECTOR_TILE',
  POINT_CLOUD: 'POINT_CLOUD',
  // LAS: 
  // COPC: 
  //GEOTIFF:
};

export const MapDataSourceComponent = createComponent('MapDataSource',
  { 
    layer_name: {type: Types.String, default: ''}, // for which MapLayer this is the source // [legacy: featuretypes: [layer_name]]
    name: {type: Types.String, default: ''}, // (optional) data source attribution
    description: {type: Types.String, default: ''}, // optional
    crs: {type: Types.String, default: 'EPSG:4326'}, // CRS code of source's projection  [legacy: srsname]
    type: {type: Types.Enum, enum: SourceType, default: SourceType.WMS }, // [legacy: service]
    url: {type: Types.String, default: 'www.example.com'}, // required
    extent: {type: Types.String, default: ''}, // bbox: minX,minY,maxX,maxY,CRS
    
    // redundant, because set on MapLayerComponent
    // layer_type: {type: Types.String}, // layer-type in MapPresenter: 'object'(feature-object geometry), 'elevation'( elevation-layer), 'color'(base-layer i.e. orthophotos)
    // request: {type: Types.String}, // i.e. 'GetFeature' for WFS, GetMap for WMS etc.

    format: {type: Types.String, default: ''}, // desired output format i.e. 'GEOJSON', 'text/xml' (must be supported by backend)
    version: {type: Types.String, default: ''}, // unused by built-in Giro3D sources
    // obsolete: MapDataSources are only for one single layer indicated by 'layer_name'
    // feature_types: {type: Types.String}, // joined feature names, separated by ','

    // --- for vector/feature sources --------------------
    // a layout of the generated component, that will be attached to this source's loaded entities
    feature_definition: {type: Types.Object , default: null},
    mapping: {type: Types.Object, default: null},

    // for Giro3D VectorSource
    // data: {type: Types.Array}
    // style: {type: Types.Object}
    options: {type: Types.Object, default: null}, // custom-ctor options for user-provided data-source implementations
    config: {type: Types.Object, default: null}, // dataSource query parameter for proxied sources 


    capabilities_url: {type: Types.String, default: ''}, // URL with GetCapabilities request parameters (required for: fromCapabilities() ctor i.e. of WmtsSSource)
    apikey: {type: Types.String, default: ''}, // to access paid-services
  },
  'Specification of a Giro3D ImageSource for a MapLayer, that tells the Presenter what source to use for the layer');

// TODO BAD IDEA !? REMOVE LATER. TRY NOT TO USE FOR ANYTHING. UNLESS THERE'S GOOD REASON
export const MapPresenterComponent = createComponent(
'MapPresenter',
{
  // instance: {type: Types.Object, default: null}, // DrawTool UI is going to need this
  map: {type: Types.Object, default:null}
},
  'Component of MapPresenter entity to expose its Giro3D Map'
);

const customSourceRegistry = new Map<string,any>();
/** users can register a custom datasource implementation for a layer (name) */
export function registerDataSourceType(name: string, classRef: any){
  customSourceRegistry.set(name, classRef);
}
export function getDataSourceType(name: string): any {
  return customSourceRegistry.get(name);
}