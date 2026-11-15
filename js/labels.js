// Place names for a deployed rover, plus the named-feature labels drawn on the Moon and Mars globes.
// Moon/Mars: looked up in data/labels_<world>.json ([name, lat, lng, diameter_km, type], USGS Gazetteer).
// Earth: keyless OpenStreetMap Nominatim reverse geocoding, falling back to the curated Earth list.
const D2R = Math.PI / 180;
const POINT_OR_LINE = new Set(['Landing site', 'Rima', 'Vallis', 'Catena', 'Dorsum', 'Fossa', 'Rupes', 'Scopulus', 'Sulcus', 'Chasma', 'Labes']);

export async function loadFeatures(worldKey) {
  try {
    const res = await fetch(`/data/labels_${worldKey}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    console.warn(`data/labels_${worldKey}.json unavailable (run node scripts/fetch_labels.mjs)`, e);
    return [];
  }
}

// Smallest named feature whose footprint contains the point, else the nearest feature with its distance.
export function placeName(features, latDeg, lonDeg, radiusM) {
  const lat = latDeg * D2R, lon = lonDeg * D2R;
  let inside = null, nearest = null;
  for (const f of features) {
    const [, flat, flng, dKm, type] = f;
    const c = Math.sin(lat) * Math.sin(flat * D2R) + Math.cos(lat) * Math.cos(flat * D2R) * Math.cos(lon - flng * D2R);
    const km = Math.acos(Math.min(1, Math.max(-1, c))) * radiusM / 1000;
    if (!nearest || km < nearest.km) nearest = { f, km };
    // only roughly round features can "contain" a click; landing sites are points and rilles/valleys/ridges are lines
    if (!POINT_OR_LINE.has(type) && km <= dKm / 2 && (!inside || dKm < inside.f[3])) inside = { f, km };
  }
  if (!nearest) return null;
  const near = `${nearest.km.toFixed(0)} km from ${nearest.f[0]} (${nearest.f[4]})`;
  if (!inside) return near;
  return inside.f === nearest.f ? `${inside.f[0]} (${inside.f[4]})` : `${inside.f[0]} (${inside.f[4]}) · ${near}`;
}

export async function earthPlace(latDeg, lonDeg, features) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&accept-language=en&lat=${latDeg.toFixed(5)}&lon=${lonDeg.toFixed(5)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const j = await res.json();
    if (typeof j.display_name === 'string' && j.display_name) return j.display_name.slice(0, 160);
  } catch (e) {
    console.warn('Reverse geocoding unavailable', e);
  }
  // open ocean / offline: nearest curated landmark
  return placeName(features, latDeg, lonDeg, 6371000) ?? 'Unnamed location';
}

// Moon/Mars only: draw the named features on the globe. Visibility scales with feature size:
// within 10x the feature's diameter (100 km crater: below 1,000 km range), >2000 km features always.
const COLORS = { 'Landing site': '#4ade80', Mons: '#fdba74', Mare: '#a5b4fc', Crater: '#e2e8f0' };
export function addLabels(viewer, features, ellipsoid, heightAt) {
  const labels = viewer.scene.primitives.add(new Cesium.LabelCollection({ scene: viewer.scene }));
  const points = viewer.scene.primitives.add(new Cesium.PointPrimitiveCollection()), items = [];
  for (const [name, lat, lng, dKm, type] of features) {
    if (name.startsWith('Statio ')) continue; // IAU names for the six Apollo sites, already labelled "Apollo N"
    const d = type === 'Landing site' ? Math.max(dKm, 150) : dKm;
    const far = d > 2000 ? Number.MAX_VALUE : Math.max(40e3, d * 10e3);
    const ref = Math.min(far, 2e7), ddc = new Cesium.DistanceDisplayCondition(0, far);
    const color = Cesium.Color.fromCssColorString(COLORS[type] ?? '#67e8f9');
    const position = Cesium.Cartesian3.fromDegrees(lng, lat, heightAt(lng * D2R, lat * D2R) + Math.min(5000, 50 + d * 10), ellipsoid);
    const label = labels.add({
      position, text: name, font: '12px ui-monospace, monospace', fillColor: color, outlineColor: Cesium.Color.BLACK, outlineWidth: 3,
      style: Cesium.LabelStyle.FILL_AND_OUTLINE, pixelOffset: new Cesium.Cartesian2(0, -12), horizontalOrigin: Cesium.HorizontalOrigin.CENTER, distanceDisplayCondition: ddc,
      scaleByDistance: new Cesium.NearFarScalar(ref * 0.05, 1.1, ref, 0.7), disableDepthTestDistance: 2e5, // far side stays hidden
    });
    items.push([position, label, points.add({ position, pixelSize: 5, color, distanceDisplayCondition: ddc, disableDepthTestDistance: 2e5 })]);
  }
  // Hide features beyond the horizon: the depth test alone lets far-side labels leak around the limb.
  // The occluding sphere sits 10 km below the reference radius so basins (down to -9 km) are never culled from close up.
  const cam = viewer.camera, occluder = ellipsoid.minimumRadius - 10e3;
  const cull = () => { for (const [p, l, pt] of items) l.show = pt.show = Cesium.Cartesian3.dot(cam.positionWC, p) > occluder * Cesium.Cartesian3.magnitude(p); };
  cam.percentageChanged = 0.02;
  cam.changed.addEventListener(cull);
  cull();
}
