/* TODO move to Giro3D fork
  this could spare us to include the lengthy WTK representation of the CRS in the project-file.
  If its simply fetched at runtime given its 'EPSG:<_>' code
*/
async function fetchCrs(code) {
  const res = await fetch(`https://epsg.io/${code}.wkt2`, { mode: "cors" });
  const wkt2 = await res.text();

  const name = /PROJCRS\["(.*?)"/gm.exec(wkt2)[1];
  const area = /AREA\["(.*?)"/gm.exec(wkt2)[1];
  const bbox = /BBOX\[(.*?)\]/gm.exec(wkt2)[1];

  const [minLat, minLon, maxLat, maxLon] = bbox.split(",").map((s) => s.trim());

  const proj = await (
    await fetch(`https://epsg.io/${code}.proj4`, { mode: "cors" })
  ).text();

  const id = `EPSG:${code}`;
  const crs = CoordinateSystem.register(id, proj, {
    throwIfFailedToRegisterWithProj: true,
  });

  const extent = new Extent(CoordinateSystem.epsg4326, {
    west: Number.parseFloat(minLon),
    east: Number.parseFloat(maxLon),
    north: Number.parseFloat(maxLat),
    south: Number.parseFloat(minLat),
  });

  document.getElementById("srid").innerText = id;
  document.getElementById("name").innerText = name;
  document.getElementById("description").innerText = area;

  document.getElementById("link").href = `https://epsg.io/${code}`;

  return { def: wkt2, crs, extent: extent.as(crs) };
}

async function initialize(epsgCode) {
  const error = document.getElementById("message");

  try {
    const { extent, crs } = await fetchCrs(epsgCode);
    error.style.display = "none";

    createScene(crs, extent);
  } catch (e) {
    error.style.display = "block";

    if (e instanceof Error) {
      error.innerText = e.message;
    } else {
      error.innerText = `An error occured while fetching CRS definition on epsg.io`;
    }
  }
}