"""Every weight, threshold and flag of the Earth-twin matcher, in one place."""

def _known():
    import json
    from pathlib import Path
    f = Path(__file__).resolve().parent.parent / 'data' / 'known_analogs.json'
    return json.loads(f.read_text())['sites'] if f.exists() else []


CONFIG = {
    # --- Phase 1: metric patches (same geometry the S1 model was trained on: ml/patches.py SIZE, SPACING_M) ---
    'patch_size_px': 32,            # samples per side
    'patch_px_m': 500.0,            # metres per sample -> 16 km square on every body
    'max_nodata_share': 0.05,       # coverage check that replaces the km² footprint gate
    'earth_max_native_px_m': 620.0, # Earth tile zoom is chosen so the native pixel is no coarser than this (MOLA is 463 m, LOLA read at 472 m)

    # --- Phase 2: screens and the relaxation ladder ---
    'polar_query_lat': 60.0,        # |query lat| above this starts at the cold-desert branch and compares temperature by percentile
    'allow_ice_surfaces': False,    # True lets ice-sheet cells (and Antarctica, which has no land-cover data) match polar ice terrain
    'cold_desert': {
        'min_abs_lat': 60.0,            # high latitude ...
        'min_elevation_m': 3500.0,      # ... or high altitude
        'max_snow_ice_fraction': 0.10,  # ice-free land
        'min_sparse_fraction': 0.60,    # barren + grass + shrub classes (rock, bare ground, sparse tundra)
        'max_forest_fraction': 0.10,
        'max_water_fraction': 0.10,
        'max_mean_surface_temp_k': 273.15,  # permafrost proxy: mean land-surface temperature below freezing
        'min_landcover_coverage': 0.90,
    },
    'relax_factor': 1.5,            # ladder step 3 multiplies tolerances and loosens screen thresholds by this
    'min_results': 5,               # a ladder step that yields fewer final matches hands over to the next step
    'reference_analog_radius_km': 150.0,
    # Known polar analog field sites: used for "near <site>" hints and tests, never forced into results.
    # every curated, sourced known analog site (data/known_analogs.json is the single source of truth); hints only
    'reference_analogs': [(x['name'], x['lat'], x['lon']) for x in _known()],

    # --- Phase 3: landform descriptors and the rule-based class ---
    'pit_min_depth_m': 8.0,         # a pit is a local minimum at least this far below its 5x5 neighbourhood mean
    'roughness_windows_px': (1, 4, 16),
    'landform': {                   # thresholds on 500 m samples over 16 km; see landform_features.landform_class
        'smooth_max_relief_m': 60.0,
        'smooth_max_rough4_m': 4.0,
        'linear_min_anisotropy': 0.45,
        'round_max_anisotropy': 0.35,
        'cratered_min_pits_per_km2': 0.012,   # about 3 pits in the 16 km patch
        'knobby_min_knobs_per_km2': 0.012,
        'icy_min_snow_ice_fraction': 0.5,     # Earth cells; for Mars see icy_query_min_abs_lat
        'icy_query_min_abs_lat': 80.0,        # Mars polar layered deposits / ice cap: only if the patch is also smooth
        'icy_max_rough4_m': 12.0,
    },

    # --- Phase 4: two-stage re-ranking and diversity ---
    'stage1_top_k': 200,            # candidates handed from the model's ordering to stage 2
    'weights': {
        'shape': 0.35,   # S1 cosine similarity (0..1): still the main signal
        'fit': 0.25,     # 4-feature terrain fit on metric patches (0..1)
        'aniso': 0.50,   # penalty per unit |Δanisotropy|: separates dunes from craters, which summary statistics cannot
        'pit': 0.20,     # penalty on the relative pit-density gap (0..1)
        'rough': 0.20,   # penalty on the multiscale-roughness log distance (0..1)
        'class': 0.25,   # flat penalty when the landform classes differ
    },
    'drop_dunes_for_rough_queries': True,  # query "cratered" or "knobby/fractured" -> drop "dunes/linear" candidates (unless < 5 remain)
    'diversity_km': 500.0,                 # final matches at least this far apart ...
    'diversity_max_cosine': 0.98,          # ... and not near-identical in descriptor space
    'verify_with_rover_drive': False,      # not implemented: the drive engine is browser JavaScript (see WORKLOG)

    # --- Phase 5: confidence badges ---
    'confidence_max_delta_anisotropy': 0.15,
    'confidence_min_drive_similarity': 60.0,  # applied in the UI once a live drive similarity exists
}
