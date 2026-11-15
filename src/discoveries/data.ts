// Types and helpers for data/discoveries.json (scripts/build_discoveries.py) and data/known_analogs.json.
export type Cls = 'known' | 'near_known' | 'new' | 'published_elsewhere';
export interface Twin { name: string; body: 'mars' | 'moon'; lat: number; lon: number; query_landform: string; final_score: number; terrain_fit: number; confidence: 'high' | 'medium' | 'low'; landform: string; top: { label: string; match: number }[] }
export interface Cluster {
  id: string; lat: number; lon: number; name: string | null; country: string | null; class: Cls;
  nearest_known: { id: string; name: string; distance_km: number } | null; twin_count: number; best_score: number; mean_score: number;
  confidence: 'high' | 'medium' | 'low'; bodies: 'mars' | 'moon' | 'both'; dominant_landform: string; barren_fraction: number | null;
  aridity_index: number | null; discovery_score: number; twins: Twin[]; citation?: { title: string; url: string };
}
export interface Atlas {
  version: string; generated_at: string; n_queries: number; runtime_s: number; score_formula: string; cluster_km: number;
  validation: { known_sites: number; known_sites_rediscovered: number; recall: number; high_conf_candidates: number; high_conf_on_known_share: number; random_cell_on_known_share: number };
  rejected: { id: string; reason: string }[]; clusters: Cluster[];
}
export interface KnownSite { id: string; name: string; country: string; lat: number; lon: number; radius_km: number; bodies: string[]; used_by: string[]; use: string; source_url: string; source_title: string }

export const CLASS_LABEL: Record<Cls, string> = { new: 'New candidate', known: 'Known analog site', near_known: 'Near a known site', published_elsewhere: 'Published elsewhere' };
export const placeOf = (c: Cluster) => [c.name, c.country].filter(Boolean).join(', ') || `${Math.abs(c.lat).toFixed(2)}° ${c.lat < 0 ? 'S' : 'N'}, ${Math.abs(c.lon).toFixed(2)}° ${c.lon < 0 ? 'W' : 'E'}`;
const USE: Record<string, string> = {
  cratered: 'cratered ground: rover traverse, sampling and hazard-avoidance tests',
  'dunes/linear': 'aeolian bedforms: mobility trials on sand and linear ridges',
  'knobby/fractured': 'rough, fractured terrain: navigation through rocks and scarps',
  'smooth plain': 'smooth plain: long traverses and landing-site rehearsal',
  mixed: 'mixed relief: general field tests across several terrain types',
};
export const whyItMatters = (c: Cluster) =>
  `${USE[c.dominant_landform] ?? USE.mixed}${c.aridity_index != null && c.aridity_index < 0.05 ? '; hyper-arid (aridity index ' + c.aridity_index.toFixed(3) + '), so little vegetation hides the ground' : ''}${c.barren_fraction != null ? `; ${Math.round(100 * c.barren_fraction)}% barren land` : ''}.`;
export const whyItMatches = (t: Twin) => `Strongest agreement: ${t.top.map((x) => `${x.label.toLowerCase()} ${Math.round(100 * x.match)}%`).join(', ')}.`;
