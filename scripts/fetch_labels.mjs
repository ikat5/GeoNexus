// node scripts/fetch_labels.mjs — builds data/labels_{moon,mars,earth}.json as [name, lat, lng, diameter_km, type].
// Moon/Mars: IAU-adopted primary features from the USGS Gazetteer of Planetary Nomenclature (keyless shapefile
// downloads; satellite craters like "Copernicus A" dropped), plus curated landing sites. Earth: curated analog sites.
import { writeFileSync, mkdirSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const OUT = new URL('../data/', import.meta.url);
const USGS = (body) => `https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/${body}_nomenclature_center_pts.zip`;

// [name, lat, lng] — published landing coordinates (rounded); Artemis III regions are approximate region centres
const LANDINGS = {
  moon: [
    ['Apollo 11', 0.6741, 23.4730], ['Apollo 12', -3.0124, -23.4216], ['Apollo 14', -3.6453, -17.4714], ['Apollo 15', 26.1322, 3.6339],
    ['Apollo 16', -8.9730, 15.5002], ['Apollo 17', 20.1908, 30.7717], ['Luna 9', 7.08, -64.37], ['Luna 16', -0.513, 56.364],
    ['Luna 17 / Lunokhod 1', 38.24, -35.0], ['Luna 21 / Lunokhod 2', 25.85, 30.45], ['Luna 24', 12.714, 62.213], ['Surveyor 1', -2.474, -43.339],
    ["Chang'e 3 / Yutu", 44.12, -19.51], ["Chang'e 4 / Yutu-2", -45.44, 177.60], ["Chang'e 5", 43.06, -51.92], ["Chang'e 6", -41.64, -153.99],
    ['Chandrayaan-3', -69.37, 32.32], ['SLIM', -13.32, 25.25], ['IM-1 Odysseus', -80.13, 1.44], ['Blue Ghost M1', 18.56, 61.81],
    ['Artemis III region: Malapert Massif (approx.)', -86.0, -2.9], ['Artemis III region: Mons Mouton (approx.)', -84.6, 31.0],
    ['Artemis III region: Nobile Rim (approx.)', -85.3, 53.5], ['Artemis III region: de Gerlache Rim (approx.)', -88.5, -68.0],
  ],
  mars: [
    ['Viking 1', 22.27, -47.95], ['Viking 2', 47.67, -134.29], ['Mars Pathfinder', 19.13, -33.22], ['Spirit', -14.568, 175.473],
    ['Opportunity', -1.946, -5.527], ['Phoenix', 68.22, -125.75], ['Curiosity (Bradbury Landing)', -4.5895, 137.4417], ['InSight', 4.502, 135.623],
    ['Perseverance (Octavia E. Butler Landing)', 18.4447, 77.4508], ['Zhurong', 25.066, 109.925], ['Mars 3', -45.0, -158.0], ['Beagle 2', 11.53, 90.43],
    ['Rosalind Franklin target: Oxia Planum (planned)', 18.2, -24.3],
  ],
};

// [name, lat, lng, size_km, type]; "Analog site" entries double as Earth-rover presets in the UI
const EARTH = [
  ['Atacama Desert (Yungay)', -24.08, -69.92, 120, 'Analog site'], ['Devon Island (Haughton Crater)', 75.38, -89.68, 23, 'Analog site'],
  ['Mauna Loa', 19.475, -155.608, 60, 'Analog site'], ['McMurdo Dry Valleys (Wright Valley)', -77.52, 161.85, 70, 'Analog site'],
  ['Meteor Crater', 35.027, -111.022, 1.2, 'Analog site'], ['Utah MDRS (Hanksville)', 38.406, -110.792, 20, 'Analog site'],
  ['Holuhraun lava field', 64.85, -16.83, 85, 'Analog site'], ['Svalbard (Bockfjord volcanoes)', 79.43, 13.33, 15, 'Analog site'],
  ['Rio Tinto', 37.72, -6.56, 30, 'Analog site'], ['Pilbara (Dresser Formation)', -21.15, 119.42, 40, 'Analog site'],
  ['Mojave Desert', 35.0, -115.5, 300, 'Analog site'], ['Qaidam Basin', 37.0, 95.0, 300, 'Analog site'],
  ['Craters of the Moon', 43.42, -113.52, 40, 'Analog site'], ['SP Crater', 35.58, -111.63, 0.4, 'Analog site'],
  ['Lonar Crater', 19.976, 76.508, 1.8, 'Impact crater'], ['Ries Crater', 48.88, 10.56, 24, 'Impact crater'],
  ['Vredefort Crater', -27.0, 27.5, 300, 'Impact crater'], ['Chicxulub Crater', 21.4, -89.52, 180, 'Impact crater'],
  ['Sudbury Basin', 46.6, -81.18, 130, 'Impact crater'], ['Manicouagan Crater', 51.38, -68.7, 100, 'Impact crater'],
  ['Kamil Crater', 22.018, 26.088, 0.045, 'Impact crater'], ['Wolfe Creek Crater', -19.17, 127.8, 0.88, 'Impact crater'],
  ['Richat Structure', 21.12, -11.4, 40, 'Geologic structure'], ['Kilauea', 19.421, -155.287, 15, 'Volcano'],
  ['Haleakalā', 20.71, -156.25, 30, 'Volcano'], ['Teide', 28.272, -16.642, 15, 'Volcano'], ['Dallol', 14.24, 40.30, 3, 'Volcano'],
  ['Mount Everest', 27.988, 86.925, 20, 'Mountain'], ['Kilimanjaro', -3.068, 37.356, 40, 'Mountain'], ['Aconcagua', -32.653, -70.011, 20, 'Mountain'],
  ['Denali', 63.069, -151.007, 20, 'Mountain'], ['Mont Blanc', 45.833, 6.865, 15, 'Mountain'], ['Grand Canyon', 36.107, -112.113, 400, 'Canyon'],
  ['Death Valley', 36.505, -117.079, 200, 'Desert'], ['Namib Desert', -24.75, 15.3, 500, 'Desert'], ['Sahara', 23.4, 13.0, 3000, 'Desert'],
  ['Altiplano', -17.0, -68.0, 500, 'Plateau'], ['Lake Vostok', -77.5, 106.0, 250, 'Subglacial lake'], ['Bonneville Salt Flats', 40.76, -113.89, 40, 'Salt flat'],
];

// minimal ZIP reader: central directory -> first entry ending in `suffix`
function unzip(buf, suffix) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = buf.readUInt16LE(eocd + 10); n--;) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20), nameLen = buf.readUInt16LE(p + 28);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen), local = buf.readUInt32LE(p + 42);
    if (name.toLowerCase().endsWith(suffix)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(start, start + size);
      return method === 8 ? inflateRawSync(data) : data;
    }
    p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error(`no ${suffix} in zip`);
}

// minimal dBASE reader -> array of {field: string}
function dbf(buf) {
  const n = buf.readUInt32LE(4), headerLen = buf.readUInt16LE(8), recLen = buf.readUInt16LE(10), fields = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) fields.push([buf.toString('latin1', o, o + 11).replace(/\0.*$/, ''), buf[o + 16]]);
  return Array.from({ length: n }, (_, i) => {
    let p = headerLen + i * recLen + 1;
    return Object.fromEntries(fields.map(([f, len]) => [f, buf.toString('utf8', p, (p += len)).trim()]));
  });
}

const r = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
mkdirSync(OUT, { recursive: true });
for (const body of ['moon', 'mars']) {
  console.log(`${body}: downloading ${USGS(body.toUpperCase())}`);
  const res = await fetch(USGS(body.toUpperCase()));
  if (!res.ok) throw new Error(`${body}: HTTP ${res.status}`);
  const rows = dbf(unzip(Buffer.from(await res.arrayBuffer()), '.dbf'));
  const features = rows
    .filter((f) => f.approval.startsWith('Adopted') && f.type !== 'Satellite Feature' && Number(f.diameter) > 0)
    .map((f) => {
      const lon = Number(f.center_lon), type = f.type === 'Statio' ? 'Landing site' : f.type.split(',')[0];
      return [f.clean_name || f.name, r(Number(f.center_lat), 4), r(lon > 180 ? lon - 360 : lon, 4), r(Number(f.diameter), 1), type];
    })
    .filter((f) => Number.isFinite(f[1]) && Number.isFinite(f[2]))
    .sort((a, b) => b[3] - a[3]);
  for (const [name, lat, lng] of LANDINGS[body]) features.push([name, lat, lng, 150, 'Landing site']); // 150 km: visible from mid-orbit
  if (features.length < 250) throw new Error(`${body}: only ${features.length} features`);
  writeFileSync(new URL(`labels_${body}.json`, OUT), JSON.stringify(features));
  const types = Object.entries(features.reduce((m, f) => ((m[f[4]] = (m[f[4]] ?? 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  console.log(`${body}: ${features.length} features · ${types.slice(0, 8).map(([t, c]) => `${t} ${c}`).join(' · ')}`);
}
writeFileSync(new URL('labels_earth.json', OUT), JSON.stringify(EARTH));
console.log(`earth: ${EARTH.length} curated sites`);
