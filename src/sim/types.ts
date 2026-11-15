// Shapes of the vanilla modules in js/ (pane.js, charts.js) and of GET /api/analog, as the console uses them.
export type Body = 'mars' | 'moon';
export type Page = 'explore' | 'result' | 'drive' | 'sensors';
export type View = '2d' | '3d' | 'ground';
export type Feature = [name: string, lat: number, lon: number, diameterKm: number, type: string];
export interface Sample { h: number; slope: number; rho: number; T: number }
export interface Rover {
  v: number; t: number; h0: number; heading: number; lat: number; lon: number;
  est: { vacuum: boolean }; telemetry(): [number, number | null][];
}
export interface Pane {
  worldKey: string; rover: Rover | null; history: Sample[]; place: string | null; wx: { T0: number; p0: number; wind: number } | null | undefined;
  features: Feature[]; ready: Promise<void>;
  deploy(lon: number, lat: number, name?: Promise<string>): Promise<unknown>; reset(): void; destroy(): void; isSpinning(): boolean;
  pin(latDeg: number, lonDeg: number): void; pickAt(x: number, y: number): [number, number] | null; placeAt(lat: number, lon: number): string | null;
  setView(v: View): void; nudge(dOrbit: number, zoomBy: number): void; follow(): void; setLabels(show: boolean): void;
}
export interface ChartGroup { push(label: string, rows: (number | null)[][]): void; reset(): void; note(i: number, text: string): void; destroy(): void }
export interface Comparison { feature: string; label: string; unit: string; target_value: number; earth_value: number; match: number }
export interface Candidate {
  feature_id: string; lat: number; lon: number; terrain_fit: number; learned_similarity: number | null; percentile: number;
  landform: string; confidence: 'high' | 'medium' | 'low'; near_analog: string | null; comparisons: Comparison[];
  barren_fraction: number | null; aridity_index: number | null;
}
export interface Analog {
  status: string; error?: string; candidates: Candidate[]; screened: number; passed: number;
  relaxation: { step: number; name: string; relaxed: boolean };
  query: { landform: string; descriptors: Record<string, number>; patch_km: number; px_m: number; indexed: boolean; temperature_mode: 'relative' | 'absolute' };
  target: { feature_id: string };
  timing_s: { total: number; patch?: number; features?: number; [step: string]: number | { stage1_s: number; stage2_s: number } | undefined };
}
export interface Result {
  state: 'loading' | 'done' | 'error'; lat: number; lon: number; place: string | null; t0: number; ms?: number;
  data?: Analog; message?: string; pick: number; driven: number; names: Promise<string>[]; resolved: string[];
}
export type Live = { elevation: number; slope: number; density: number; temperature: number; overall: number } | null;
