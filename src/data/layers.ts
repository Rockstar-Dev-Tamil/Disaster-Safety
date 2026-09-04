/* ============================================================================
 * OVERLAY REGISTRY
 *
 * Two kinds of entry:
 *
 *   DERIVED  -- computed at runtime from habitation records already displayed
 *               in this app. These render immediately and offline. They add no
 *               spatial information that is not already on screen; they only
 *               aggregate it to district polygons so the pan-India view reads
 *               at low zoom.
 *
 *   PUBLISHED -- a real external product. `url` is null until ingest. The map
 *               draws nothing and the legend says NOT INGESTED, rather than
 *               silently showing an empty layer that reads as "no hazard here".
 *
 * To wire a published layer: set `url` and, for WMS, `wmsLayer`. Nothing else
 * in the app needs to change.
 * ==========================================================================*/

import type { HazardType, Provenance, SusceptibilityBand } from './schema';
import {
  SRC_DELTARES_SHORELINE,
  SRC_IMD_NOWCAST,
  SRC_INCOIS_SURGE,
  SRC_NCSCM_SHORELINE,
} from './sources';

export type OverlayKind = 'DERIVED_DISTRICT' | 'WMS' | 'XYZ' | 'GEOJSON' | 'IMAGE' | 'IMAGE_SEQUENCE';

/** [west, south, east, north] -- lets the legend offer "zoom to extent" for
 *  layers that cover one district rather than the whole country. */
export type Bounds = [number, number, number, number];

export interface OverlayLayer {
  id: string;
  label: string;
  /** Short line explaining what the shading means. Shown in the legend. */
  meaning: string;
  kind: OverlayKind;
  hazard?: HazardType;
  /** null => not ingested. Legend says so; nothing is drawn. */
  url: string | null;
  /** WMS only. */
  wmsLayer?: string;
  defaultOn: boolean;
  opacity: number;
  /** Which derived field the DERIVED_DISTRICT layers aggregate. */
  derivedField?: 'susceptibility' | 'alert';
  /** GEOJSON only: feature property holding the class, and the colour per
   *  class value. Class values are the publisher's own strings -- they are not
   *  renamed into this application's band vocabulary, because the source
   *  schemes do not have the same number of classes. */
  classField?: string;
  classColors?: Record<string, string>;
  /** GEOJSON only, continuous alternative to classField: a numeric property
   *  drawn on a colour ramp rather than binned into the publisher's classes.
   *  Used where the source publishes a measurement rather than a class. */
  rampField?: string;
  /** [value, colour] stops. Rendered as points, not fills. */
  ramp?: Array<[number, string]>;
  /** IMAGE only: [w, s, e, n] corners of the georeferenced PNG. */
  imageBounds?: Bounds;
  /** XYZ only: deepest zoom the pyramid was built to. Beyond it MapLibre
   *  overzooms the deepest tiles rather than requesting ones that do not
   *  exist -- every such request would 404 and read as a basemap failure. */
  maxzoom?: number;
  bounds?: Bounds;
  legend: Array<{ label: string; band?: SusceptibilityBand; color?: string; note?: string }>;
  provenance: Provenance;
}

const SUSCEPTIBILITY_LEGEND: Array<{ label: string; band?: SusceptibilityBand }> = [
  { label: 'Very high', band: 'VERY_HIGH' },
  { label: 'High', band: 'HIGH' },
  { label: 'Moderate', band: 'MODERATE' },
  { label: 'Low', band: 'LOW' },
  { label: 'Very low', band: 'VERY_LOW' },
];

export const OVERLAYS: OverlayLayer[] = [
  {
    id: 'district-susceptibility',
    label: 'District susceptibility (aggregate)',
    meaning:
      'Highest habitation susceptibility score in each district. Aggregation only; adds no information beyond the points already plotted.',
    kind: 'DERIVED_DISTRICT',
    derivedField: 'susceptibility',
    url: 'derived',
    defaultOn: true,
    opacity: 0.58,
    legend: SUSCEPTIBILITY_LEGEND,
    provenance: {
      status: 'LIVE',
      source: 'Derived from displayed habitation assessments',
      agency: 'This application',
      method:
        'max(susceptibility.score) over habitations whose district matches the polygon, joined on district name.',
      assessedOn: '2024-07-29T23:30:00+05:30',
    },
  },
  {
    id: 'district-alert',
    label: 'District operational alert (aggregate)',
    meaning:
      'Most severe current IMD alert state among habitations in each district, at the operating picture timestamp.',
    kind: 'DERIVED_DISTRICT',
    derivedField: 'alert',
    url: 'derived',
    defaultOn: false,
    opacity: 0.6,
    legend: [
      { label: 'Red', band: 'VERY_HIGH' },
      { label: 'Orange', band: 'HIGH' },
      { label: 'Yellow', band: 'MODERATE' },
      { label: 'Green', band: 'LOW' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Derived from displayed habitation operational state',
      agency: 'This application',
      method: 'max(current.alert) over habitations whose district matches the polygon.',
      observedAt: '2024-07-29T23:30:00+05:30',
    },
  },

  {
    id: 'ecmwf-sequence',
    label: 'ECMWF forecast rain, 3-hourly',
    meaning:
      'IFS HRES deterministic, run 29 Jul 2024 00Z. Rain falling in each 3 h window, not accumulated total, so the field shows rain arriving and passing. Scrub or play the clock below the map. 0.25 deg (~28 km) — cells are drawn unsmoothed because the model has no more detail than this.',
    kind: 'IMAGE_SEQUENCE',
    url: '/layers/ecmwf-sequence.json',
    imageBounds: [67.875, 5.875, 97.625, 37.625],
    defaultOn: false,
    opacity: 0.8,
    legend: [
      { label: '70+ mm / 3 h', color: '#ffb4aa' },
      { label: '40-70 mm', color: '#ff7563' },
      { label: '20-40 mm', color: '#d9a13a' },
      { label: '10-20 mm', color: '#7cbf5c' },
      { label: '5-10 mm', color: '#2ba3a0' },
      { label: '2.5-5 mm', color: '#21819a' },
      { label: '1-2.5 mm', color: '#1d5c74' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'ECMWF IFS HRES open data, run 2024-07-29 00Z, steps +3 h to +48 h',
      agency: 'European Centre for Medium-Range Weather Forecasts',
      method:
        'Deterministic total precipitation, differenced between consecutive steps to give rain per 3 h window. Retrieved by byte-range from the Google open-data mirror; ECMWF own feed retains only a rolling window and does not reach this date.',
      resolution: '0.25 deg (~28 km), 3 h',
      citation: 'ecmwf-open-data/20240729/00z/ifs/0p25/oper',
      observedAt: '2024-07-29T05:30:00+05:30',
    },
  },

  {
    id: 'ecmwf-live-sequence',
    label: 'ECMWF forecast rain — latest run',
    meaning:
      'The current operational forecast, not an archived one. Same product and '
      + 'same 3-hourly windows as the July 2024 run above, initialised from the '
      + 'most recent cycle pulled by scripts/fetch-ecmwf.py. This is what makes '
      + 'the live case live: refresh it by re-running that script. It does NOT '
      + 'refresh itself — the console ships as static files with no backend, so '
      + 'the run below is exactly as current as the last fetch, and the timeline '
      + 'says so if the clock has moved outside the forecast window.',
    kind: 'IMAGE_SEQUENCE',
    url: '/layers/ecmwf-live-sequence.json',
    imageBounds: [67.875, 5.875, 97.625, 37.625],
    defaultOn: false,
    opacity: 0.8,
    legend: [
      { label: '70+ mm / 3 h', color: '#ffb4aa' },
      { label: '40-70 mm', color: '#ff7563' },
      { label: '20-40 mm', color: '#d9a13a' },
      { label: '10-20 mm', color: '#7cbf5c' },
      { label: '5-10 mm', color: '#2ba3a0' },
      { label: '2.5-5 mm', color: '#21819a' },
      { label: '1-2.5 mm', color: '#1d5c74' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'ECMWF IFS HRES open data, latest available cycle, steps +3 h to +48 h',
      agency: 'European Centre for Medium-Range Weather Forecasts',
      method:
        'Deterministic total precipitation, differenced between consecutive '
        + 'steps to give rain per 3 h window, resampled to Mercator rows before '
        + 'drawing. Retrieved by byte-range from the Google open-data mirror, '
        + 'which retains roughly the last four days plus an archive from '
        + 'January 2023.',
      resolution: '0.25 deg (~28 km), 3 h',
      citation: 'ecmwf-open-data, ifs/0p25/oper',
      observedAt: '2026-09-04T05:30:00+05:30',
    },
  },

  /* ---------------- published products, awaiting ingest ---------------- */

  {
    id: 'ksdma-landslide-wayanad',
    label: 'Landslide hazard zones — Wayanad',
    meaning:
      'Published three-class hazard zonation, 269 polygons. Class names are the publisher’s own and are NOT remapped onto the five-band ramp used for habitation scores; High Hazard Zone is the top class of a three-class scheme, not the "very high" of a five-class one.',
    kind: 'GEOJSON',
    hazard: 'LANDSLIDE',
    url: '/layers/wayanad-landslide.geojson',
    classField: 'class',
    classColors: {
      'High Hazard Zone': '#e08127',
      'Medium Hazard Zone': '#b0902a',
      'Low Hazard Zone': '#3f7a34',
    },
    bounds: [75.7747, 11.4507, 76.2972, 11.9677],
    defaultOn: false,
    opacity: 0.55,
    legend: [
      { label: 'High Hazard Zone', color: '#e08127', note: '110 polygons' },
      { label: 'Medium Hazard Zone', color: '#b0902a', note: '149 polygons' },
      { label: 'Low Hazard Zone', color: '#3f7a34', note: '10 polygons' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Landslide hazard zonation, Wayanad district (WAYD_LS)',
      agency: 'Kerala State Disaster Management Authority',
      method:
        'Three-class hazard zonation supplied as district KMZ. Attributes carried through verbatim: FID, ZONE_, SHAPE_Area, aarea.',
      resolution: '269 polygons; geometry simplified to ~6 m tolerance for display',
      citation: 'KML_LS&FLD/WAYD_LS.kmz',
      assessedOn: '2020-08-10T00:00:00+05:30',
    },
  },
  {
    id: 'ksdma-flood-wayanad',
    label: 'Flood landform — Wayanad',
    meaning:
      'Geomorphology-based flood mapping, 63 polygons. This is a landform classification, not a graded susceptibility surface: a polygon is flood plain or it is not, so it carries no severity ramp.',
    kind: 'GEOJSON',
    hazard: 'FLOOD',
    url: '/layers/wayanad-flood.geojson',
    classField: 'class',
    classColors: {
      'Flood plain': '#3b7ea1',
      Waterbody: '#1f4e63',
    },
    bounds: [75.8766, 11.4732, 76.4158, 11.9106],
    defaultOn: false,
    opacity: 0.6,
    legend: [
      { label: 'Flood plain', color: '#3b7ea1', note: '54 polygons' },
      { label: 'Waterbody (permanent)', color: '#1f4e63', note: '9 polygons' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Flood landform mapping, Wayanad district',
      agency: 'Kerala State Disaster Management Authority',
      method:
        'Geomorphological landform classification supplied as district KMZ. Attributes carried through verbatim: FID, Land_form, SHAPE_Leng.',
      resolution: '63 polygons; geometry simplified to ~6 m tolerance for display',
      citation: 'Flood_KML/Wayanad.kmz',
      assessedOn: '2018-09-26T00:00:00+05:30',
    },
  },
  {
    id: 'imd-nowcast-radar',
    label: 'IMD radar nowcast, 29-30 Jul 2024',
    meaning:
      'Archived radar reflectivity / rainfall accumulation for the event window. Time-stepped with the scenario clock once ingested.',
    kind: 'XYZ',
    url: null,
    defaultOn: false,
    opacity: 0.6,
    legend: [
      { label: 'Extremely heavy', band: 'VERY_HIGH' },
      { label: 'Very heavy', band: 'HIGH' },
      { label: 'Heavy', band: 'MODERATE' },
      { label: 'Moderate', band: 'LOW' },
      { label: 'Light', band: 'VERY_LOW' },
    ],
    provenance: SRC_IMD_NOWCAST,
  },
  {
    id: 'ncscm-shoreline',
    label: 'NCSCM shoreline change',
    meaning: 'DSAS erosion / accretion rates on 100 m transects.',
    kind: 'GEOJSON',
    hazard: 'COASTAL_EROSION',
    url: null,
    defaultOn: false,
    opacity: 0.8,
    legend: SUSCEPTIBILITY_LEGEND,
    provenance: SRC_NCSCM_SHORELINE,
  },
  {
    id: 'assam-flood-frequency',
    label: 'Flood frequency — Brahmaputra and Barak valleys',
    meaning:
      'How many of three sampled flood years (1999, 2000, 2004) inundated each '
      + 'cell. A frequency composite, not an event footprint: it says which '
      + 'ground floods repeatedly, which is the question relocation siting '
      + 'asks. Only 0.9 per cent of the box flooded in all three years, and '
      + 'that fraction traces the active channel. Three years is a short '
      + 'sample — absence here is not evidence of safety.',
    /* Tiles, not a single draped image. One image was tried first and renders
     * as an opaque black rectangle above ~128 px in this build's test
     * environment; see scripts/build-flood-tiles.py for the measurements. */
    kind: 'XYZ',
    hazard: 'FLOOD',
    url: '/flood-assam/{z}/{x}/{y}.png',
    bounds: [89.7, 24.1, 96.0, 28.2],
    maxzoom: 10,
    defaultOn: false,
    opacity: 0.85,
    legend: [
      { label: 'Flooded in all 3 years', color: '#123e60', note: '9,294 cells · 0.9%' },
      { label: 'Flooded in 2 of 3', color: '#256e98', note: '16,703 cells · 1.6%' },
      { label: 'Flooded in 1 of 3', color: '#6db0d0', note: '35,204 cells · 3.4%' },
      { label: 'Not flooded in the sample', note: '94.2% — includes all upland' },
    ],
    provenance: {
      status: 'UNATTRIBUTED',
      source: 'Flood extent composite, 1999 / 2000 / 2004 — originating product not identified',
      agency: 'Supplied as a scrape; publisher unknown',
      method:
        'Per-cell count of sampled years inundated, 1999, 2000 and 2004. '
        + 'TWO DEFECTS WERE CORRECTED ON INGEST, both verifiable in '
        + 'scripts/probe-assam-raster.py. First, the file is inverted against '
        + 'its own band description: median terrain elevation rises with the '
        + 'stored value (59 m, 64 m, 74 m, 436 m), so the value counts years '
        + 'NOT flooded and is read here as 3 minus the stored value. Read '
        + 'literally it would have painted the Shillong plateau as the worst '
        + 'flood ground in the state. Second, the file declares nodata = 0, '
        + 'which marks the most-flooded class as missing; that declaration is '
        + 'ignored, because honouring it deletes the active channel.',
      resolution: '1024 x 1024 over 6.3 x 4.1 degrees (~600 m)',
      citation:
        'flood_frequency_1999_2000_2004.tif. Not citable in an official record '
        + 'until the originating product is identified.',
    },
  },
  {
    id: 'aqueduct-river-assam',
    label: 'Flood susceptibility — Brahmaputra and Barak valleys',
    meaning:
      'Riverine flood susceptibility, classed by how often ground floods: the '
      + 'smallest return period at which each cell is inundated. Replaces the '
      + 'three-year observed composite, which could only say whether a cell '
      + 'flooded in 1999, 2000 or 2004 — absence there was never evidence of '
      + 'safety, whereas a 1-in-1000 return period is a statement about safety '
      + 'with a number attached. Coarser though: ~900 m against the composite.',
    kind: 'XYZ',
    hazard: 'FLOOD',
    url: '/floodrp-assam/{z}/{x}/{y}.png',
    bounds: [89.7, 24.1, 96.0, 28.2],
    maxzoom: 10,
    defaultOn: false,
    opacity: 0.85,
    legend: [
      { label: 'High · floods 1-in-10 yr or more often', color: '#1a3f66' },
      { label: 'Moderate · 1-in-11 to 1-in-100', color: '#2f7099' },
      { label: 'Low · 1-in-101 to 1-in-1000', note: 'in the data, not drawn' },
      { label: 'Dry at every modelled return period', note: 'not a safety guarantee' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Aqueduct Flood Hazard Maps V2 — riverine (inunriver), historical',
      agency: 'World Resources Institute',
      method:
        'Global hydrological and inundation modelling at nine return periods. '
        + 'Each cell is classed by the SMALLEST return period at which it is '
        + 'inundated to more than 0.05 m, so the value states how often ground '
        + 'floods rather than whether it happened to flood in a sampled year. '
        + 'Retrieved through Earth Engine (WRI/Aqueduct_Flood_Hazard_Maps/V2). '
        + 'Limits worth carrying: the model does not represent embankment '
        + 'breaches, so a bund failure puts water where a 1-in-1000 map shows '
        + 'none, and at ~900 m it cannot see which side of a bund a hamlet sits '
        + 'on.',
      resolution: '30 arcsec (~900 m)',
      citation: 'WRI Aqueduct Floods, Ward et al. Note this is V2; V3 exists.',
      assessedOn: '2026-09-04T00:00:00+05:30',
    },
  },
  {
    id: 'aqueduct-coast-kendrapara',
    label: 'Coastal surge susceptibility — Kendrapara',
    meaning:
      'Coastal (storm surge) flood susceptibility, classed by the smallest '
      + 'return period that inundates each cell. This is the flooding hazard '
      + 'that threatens this shoreline; shoreline retreat is the separate, '
      + 'chronic one. 14.5% of this area of interest is first inundated at '
      + 'exactly the 1-in-100 surge — the jump a delta shows when the design '
      + 'flood overtops the embankment line.',
    kind: 'XYZ',
    hazard: 'CYCLONE',
    url: '/floodrp-kendrapara/{z}/{x}/{y}.png',
    bounds: [86.55, 20.25, 87.35, 21.0],
    maxzoom: 11,
    defaultOn: false,
    opacity: 0.85,
    legend: [
      { label: 'High · floods 1-in-10 yr or more often', color: '#1a3f66' },
      { label: 'Moderate · 1-in-11 to 1-in-100', color: '#2f7099' },
      { label: 'Low · 1-in-101 to 1-in-1000', note: 'in the data, not drawn' },
      { label: 'Dry at every modelled return period', note: 'not a safety guarantee' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Aqueduct Flood Hazard Maps V2 — coastal (inuncoast), 2010, no subsidence, historical',
      agency: 'World Resources Institute',
      method:
        'Global hydrological and inundation modelling at nine return periods. '
        + 'Each cell is classed by the SMALLEST return period at which it is '
        + 'inundated to more than 0.05 m, so the value states how often ground '
        + 'floods rather than whether it happened to flood in a sampled year. '
        + 'Retrieved through Earth Engine (WRI/Aqueduct_Flood_Hazard_Maps/V2). '
        + 'Limits worth carrying: the model does not represent embankment '
        + 'breaches, so a bund failure puts water where a 1-in-1000 map shows '
        + 'none, and at ~900 m it cannot see which side of a bund a hamlet sits '
        + 'on.',
      resolution: '30 arcsec (~900 m)',
      citation: 'WRI Aqueduct Floods, Ward et al. Note this is V2; V3 exists.',
      assessedOn: '2026-09-04T00:00:00+05:30',
    },
  },
  {
    id: 'assam-hand',
    label: 'Flood susceptibility (HAND) — Majuli',
    meaning:
      'Height Above Nearest Drainage, at the 100 m analysis grid, classed by '
      + 'the flood frequency actually observed at each height. Unlike the '
      + 'three-year composite this is DENSE — it covers ground the composite '
      + 'never sampled — and unlike raw elevation it is relative to the '
      + 'drainage a cell flows to, which is what governs flooding on a plain '
      + 'where mean slope is 0.5 degrees. Grey cells are not low risk: they '
      + 'are where the flow routing did not resolve, and they flood MORE often '
      + 'than resolved ones.',
    kind: 'XYZ',
    hazard: 'FLOOD',
    url: '/hand-assam/{z}/{x}/{y}.png',
    bounds: [93.85, 26.6, 94.75, 27.4],
    maxzoom: 12,
    defaultOn: false,
    opacity: 0.9,
    legend: [
      { label: 'High · HAND ≤ 3.3 m', color: '#1a3f66', note: '23.2% · P(flood) ≥ 0.50' },
      { label: 'Moderate · ≤ 18.1 m', color: '#2f7099', note: '57.2% · P ≥ 0.20' },
      { label: 'Low · ≤ 32.5 m', note: '6.4% · P ≥ 0.05 — in the data, not drawn' },
      { label: 'Negligible', note: '12.1% · above 32.5 m' },
      { label: 'Not resolved', color: '#787880', note: '1.1% — absence of data, not of risk' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'HAND derived from Copernicus GLO-30, calibrated on observed flood extent',
      agency: 'Derived in this application (pysheds D8)',
      method:
        'Depressions filled and flats resolved, D8 flow direction and '
        + 'accumulation, channels at >50,000 cells (500 km²) upslope, then '
        + 'height above the nearest channel along the flow path. The channel '
        + 'threshold is not a textbook default: it was swept against the '
        + 'observed extent, where the conventional 5 km² scored AUC 0.634 and '
        + '500 km² scored 0.723. Cells the sparse network leaves unresolved '
        + 'are filled from a 50 km² network and flagged. Class breaks are the '
        + 'HAND values at which the OBSERVED flood fraction crosses 0.50, 0.20 '
        + 'and 0.05 — derived from the ground truth, not chosen. '
        + 'ROC AUC 0.715 over 98.9% of the grid; at the Youden-optimal '
        + 'threshold of 6.96 m, 69.3% of flooded cells are caught at a 37.2% '
        + 'false positive rate. That is fair discrimination, not a flood map: '
        + 'HAND separates floodplain from terrace well, and cannot say which '
        + 'part of a floodplain a given year inundates.',
      resolution: '100 m',
      citation:
        'Calibrated against flood_frequency_1999_2000_2004.tif, whose own '
        + 'originating product is unidentified — see the flood-frequency layer.',
      assessedOn: '2026-09-04T00:00:00+05:30',
    },
  },
  {
    id: 'shoreline-monitor',
    label: 'Measured shoreline change, Kendrapara',
    meaning:
      'Satellite-derived shoreline change rate on 100 m transects, 1988-2022. '
      + 'One point per transect, coloured by metres per year: red is retreat, '
      + 'blue is accretion. A delta does both, and the two sit side by side on '
      + 'this coast -- 981 of the 1,681 transects here are eroding and 700 are '
      + 'building. Rate is the least-squares slope of shoreline position '
      + 'against year, published per transect with its own standard error.',
    kind: 'GEOJSON',
    hazard: 'COASTAL_EROSION',
    url: '/layers/kendrapara-shoreline.json',
    rampField: 'rate',
    /* Divergent, and deliberately not the susceptibility ramp: this is a
     * signed measurement with a meaningful zero, not a severity band. Blue to
     * orange-red rather than green to red so the two ends stay distinguishable
     * under the common forms of colour vision deficiency. Zero sits at a pale
     * neutral so a stable shoreline reads as stable rather than as mildly bad. */
    ramp: [
      [-20, '#7f1d1d'],
      [-10, '#c2410c'],
      [-5, '#e08127'],
      [-1, '#c9b98a'],
      [0, '#9aa6b2'],
      [2, '#5b93b8'],
      [10, '#1e5f8c'],
    ],
    defaultOn: false,
    opacity: 0.95,
    bounds: [86.55, 20.25, 87.35, 21.0],
    legend: [
      { label: 'Retreat, >10 m/yr', color: '#7f1d1d' },
      { label: 'Retreat, 5-10 m/yr', color: '#c2410c' },
      { label: 'Retreat, 1-5 m/yr', color: '#e08127' },
      { label: 'Stable, ±1 m/yr', color: '#9aa6b2' },
      { label: 'Accretion', color: '#1e5f8c', note: '700 of 1,681 transects' },
    ],
    provenance: SRC_DELTARES_SHORELINE,
  },
  {
    id: 'incois-surge',
    label: 'INCOIS storm surge envelope',
    meaning: '1-in-100-year modelled surge inundation extent.',
    kind: 'GEOJSON',
    hazard: 'CYCLONE',
    url: null,
    defaultOn: false,
    opacity: 0.5,
    legend: SUSCEPTIBILITY_LEGEND,
    provenance: SRC_INCOIS_SURGE,
  },
];

export const isIngested = (l: OverlayLayer) => l.url !== null;
