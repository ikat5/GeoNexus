// Text formatting shared by the landing page and the console (ported from the old js/main.js helpers).
export const num = (x: number | null | undefined, d: number) =>
  x == null || !Number.isFinite(x) ? '—' : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
export const coord = (lat: number, lon: number, d = 2) =>
  `${Math.abs(lat).toFixed(d)}° ${lat < 0 ? 'S' : 'N'}, ${Math.abs(lon).toFixed(d)}° ${lon < 0 ? 'W' : 'E'}`;
// "Amazonis Planitia (Planitia) · 437 km from…" -> "Amazonis Planitia"
export const shortSite = (p?: string | null) => (p ?? 'Locating…').split(' · ')[0].replace(/ \([^)]*\)$/, '');
// "Ombu township, Nyima County, …, China" -> "Ombu township, China". Nominatim falls back to the local script when a
// small place has no English name, so the short form starts at the first part written in Latin letters.
export const shortEarth = (n?: string | null) => {
  const a = (n ?? 'Locating…').split(', '), i = Math.max(0, a.findIndex((x) => /[A-Za-z]/.test(x))), b = a.slice(i);
  return b.length > 2 ? `${b[0]}, ${b.at(-1)}` : b.join(', ');
};
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
