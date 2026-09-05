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
import { GENERATED_OBSERVED_AT } from './habitations';
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
  /** Which derived field the DERIVED_DISTRICT layers aggregate.
   *
   *  'alert' is still supported by the renderer but no layer uses it. The
   *  aggregate-alert overlay was removed: it read as a national operational
   *  picture while actually aggregating a habitation set pinned to one
   *  observation moment, so it could not move with the case and looked like
   *  IMD data without being it. District rainfall warnings replaced it with
   *  something that varies per event and says where it came from. */
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
  /** IMAGE_SEQUENCE only: which sequence to load per case.
   *
   *  A rain field is only meaningful for the event it belongs to. One entry in
   *  the layer list resolves to a different sequence depending on which case is
   *  selected, rather than three near-identical entries the officer has to pick
   *  between correctly. Falls back to `url` for any case not listed. */
  sequenceByCase?: Record<string, string>;
  /** GEOJSON only: which file to load per case, same reasoning as
   *  sequenceByCase. Falls back to `url`. */
  geojsonByCase?: Record<string, string>;
  /** Per-case provenance, for the same reason. The Fani field is reanalysis and
   *  the other two are forecasts; one source line cannot describe both. */
  provenanceByCase?: Record<string, Provenance>;
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
        'max(susceptibility.score) over habitations whose district matches the '
        + 'polygon, joined on district name. Susceptibility is a standing '
        + 'assessment and does not move with the operating clock, so unlike the '
        + 'alert layer this one is not case-dependent.',
      assessedOn: GENERATED_OBSERVED_AT,
    },
  },
  {
    id: 'rain-field',
    label: 'Rain field — this case\u2019s event',
    meaning:
      'Rain falling in each 3 h window, not accumulated total, so the field '
      + 'shows weather arriving and passing. Scrub or play the clock below the '
      + 'map. WHICH DATA depends on the case, because a rain field is only '
      + 'meaningful for the event it belongs to: Wayanad and the live Assam '
      + 'case get the ECMWF FORECAST for their own dates, Kendrapara gets ERA5 '
      + 'REANALYSIS because the forecast archive begins in 2024 and Fani was '
      + '2019. Forecast says what the model expected beforehand; reanalysis '
      + 'says what the atmosphere did. The timeline states which is on screen. '
      + '0.25 deg (~28 km) either way, drawn unsmoothed because neither model '
      + 'has more detail than that.',
    kind: 'IMAGE_SEQUENCE',
    url: '/layers/ecmwf-sequence.json',
    sequenceByCase: {
      WAYANAD: '/layers/ecmwf-sequence.json',
      KENDRAPARA: '/layers/era5-fani-sequence.json',
      ASSAM: '/layers/ecmwf-live-sequence.json',
      WESTBENGAL: '/layers/ecmwf-live-sequence.json',
    },
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
        'Deterministic total precipitation, differenced between consecutive '
        + 'steps to give rain per 3 h window, resampled to Mercator rows before '
        + 'drawing.',
      resolution: '0.25 deg (~28 km), 3 h',
      citation: 'ecmwf-open-data/20240729/00z/ifs/0p25/oper',
      observedAt: '2024-07-29T05:30:00+05:30',
    },
    provenanceByCase: {
      KENDRAPARA: {
        status: 'LIVE',
        source: 'ERA5 hourly reanalysis, 02-04 May 2019',
        agency: 'ECMWF, via Google Earth Engine',
        method:
          'REANALYSIS, NOT FORECAST: assimilated after the event, so it '
          + 'describes what the atmosphere did rather than what was predicted. '
          + 'Hourly total precipitation summed into the same 3 h windows and '
          + 'drawn on the same ramp as the forecast layers so the two are '
          + 'directly comparable. Used because the ECMWF open-data forecast '
          + 'archive begins between January and March 2024 and cannot reach '
          + 'Cyclone Fani.',
        resolution: '0.25 deg (~28 km), 3 h',
        citation: 'ECMWF/ERA5/HOURLY, total_precipitation',
        observedAt: '2019-05-02T05:30:00+05:30',
      },
      ASSAM: {
        status: 'LIVE',
        source: 'ECMWF IFS HRES open data, latest available cycle',
        agency: 'European Centre for Medium-Range Weather Forecasts',
        method:
          'The current operational forecast. Refreshed by re-running '
          + 'scripts/fetch-ecmwf.py; it does not refresh itself, and the '
          + 'timeline says so if the clock has moved outside the run window.',
        resolution: '0.25 deg (~28 km), 3 h',
        citation: 'ecmwf-open-data, ifs/0p25/oper',
        observedAt: '2026-09-04T05:30:00+05:30',
      },
    },
  },

  {
    id: 'district-rain-warning',
    label: 'District rainfall warning (bias-adjusted)',
    meaning:
      'Observed 24 h rainfall per district for THIS CASE\u2019S event window, '
      + 'banded at 39 / 69 / 123 mm. Those boundaries are IMD\u2019s category '
      + 'ratios scaled by 0.60, because IMD\u2019s figures are gauge-calibrated '
      + 'and satellite rainfall under-reads orographic extremes: unscaled, '
      + 'Wayanad district reads ORANGE for the day around 400 people died and '
      + 'Cyclone Fani produces no red district at all. The bands are therefore '
      + 'NOT IMD categories and this is NOT the warning IMD issued \u2014 those '
      + 'sit behind a key, forecast days only, with no archive for 2019 or 2024. '
      + 'A single national factor also over-warns the plains at whatever setting '
      + 'makes the Ghats read correctly; the honest fix is per-district return '
      + 'levels, which is a bigger job than this.',
    kind: 'GEOJSON',
    url: '/layers/district-warning-wayanad.geojson',
    geojsonByCase: {
      WAYANAD: '/layers/district-warning-wayanad.geojson',
      KENDRAPARA: '/layers/district-warning-kendrapara.geojson',
      ASSAM: '/layers/district-warning-assam.geojson',
      WESTBENGAL: '/layers/district-warning-westbengal.geojson',
    },
    classField: 'warning',
    classColors: {
      RED: '#ff5f4d',
      ORANGE: '#e08127',
      YELLOW: '#bfa02e',
    },
    defaultOn: false,
    opacity: 0.5,
    legend: [
      { label: 'Highest band', color: '#ff5f4d', note: '\u2265 123 mm/24h observed' },
      { label: 'Middle band', color: '#e08127', note: '69\u2013122 mm' },
      { label: 'Lowest band', color: '#bfa02e', note: '39\u201368 mm' },
      { label: 'Below category', note: 'not drawn \u2014 not a statement of safety' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'IMD 24 h category ratios scaled 0.60, applied to GPM IMERG V07',
      agency: 'Derived in this application. Categories: India Meteorological '
        + 'Department. Rainfall: NASA GES DISC / JAXA.',
      method:
        'Maximum rolling 24 h accumulation per district across the case\u2019s '
        + 'event window, stepped every 3 h rather than on calendar days, because '
        + 'IMD\u2019s day runs 08:30\u201308:30 IST and a fixed boundary can '
        + 'split one night\u2019s rain across two days. '
        + 'The 0.60 factor was chosen against evidence, not guessed: swept '
        + 'over both historical cases, it is the loosest setting at which '
        + 'Wayanad district reads red for a catastrophic debris flow AND Puri '
        + 'reads red for an ESCS landfall, while red stays 1\u20134% of '
        + 'districts. Unscaled they read ORANGE and ORANGE. '
        + 'REMAINING BIAS: one national multiplier cannot correct a bias that '
        + 'varies spatially, so this over-warns the plains at the setting that '
        + 'makes the Ghats read correctly. Treat the bands as relative severity '
        + 'within an event, not as absolute rainfall categories.',
      resolution: '0.1 deg (~11 km), aggregated to district polygons',
      citation: 'GPM_3IMERGHH.07 via Earth Engine; IMD rainfall category definitions',
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
    id: 'satellite-imagery',
    label: 'Satellite imagery',
    meaning:
      'True-colour imagery under the analysis layers, so a candidate site can '
      + 'be looked at rather than only scored. Useful for the thing no raster '
      + 'in this console resolves: whether the ground a shortlist just proposed '
      + 'is actually empty. '
      + 'VINTAGE IS MIXED AND NOT STATED PER TILE. This is a mosaic assembled '
      + 'from many acquisitions of different dates, so it is "recent" in '
      + 'general and unknown in particular — which on a coast that loses land '
      + 'every year is a real limitation. Do not read it as the state of the '
      + 'shoreline today; the erosion layers are dated and this is not.',
    kind: 'XYZ',
    url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    /* No bounds: unlike every other raster here this one is global, so it can
     * sit under any case without a per-AOI build. */
    maxzoom: 18,
    defaultOn: false,
    /* Full strength. It is a basemap, not a shading, and half-transparent
     * imagery over a dark ground reads as neither. */
    opacity: 1,
    legend: [
      { label: 'True colour', note: 'natural colour, as the sensor saw it' },
      { label: 'Vintage', note: 'mixed per tile and not published — not a dated observation' },
      { label: 'Resolution', note: 'sub-metre in populated areas, coarser over water and forest' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Esri World Imagery',
      agency:
        'Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      method:
        'A global mosaic of commercial and public imagery served as map tiles. '
        + 'Fetched from Esri at view time rather than rebuilt into this repo: '
        + 'the pyramid for one case AOI alone would run to tens of megabytes, '
        + 'and it is the one layer here that needs no per-case processing. '
        + 'IT IS ALSO THE ONE LAYER THAT NEEDS A NETWORK. Everything else in '
        + 'this console is a static file and works offline; if a demonstration '
        + 'or a field deployment has no connectivity, this layer is blank and '
        + 'nothing else is affected. '
        + 'NOT AN ANALYSIS INPUT. No score, exclusion or ranking reads it. It '
        + 'is there to be looked at, and its undated mosaic could not honestly '
        + 'feed a measurement anyway.',
      resolution: 'varies by tile; sub-metre to ~15 m',
      citation:
        'services.arcgisonline.com/ArcGIS/rest/services/World_Imagery. '
        + 'Attribution required wherever it is displayed.',
    },
  },
  {
    id: 'aqueduct-coast-westbengal',
    label: 'Flood susceptibility \u2014 Sundarbans and the Hooghly mouth',
    meaning:
      'Coastal surge AND riverine flood combined on the smallest return period '
      + 'that inundates each cell, because this coast takes both and a cell '
      + 'either mechanism reaches is reached. The headline number is the case '
      + 'for the whole exercise: 31.8% of this area floods at 1-in-10 or more '
      + 'often, against 14.5% first inundated at the 1-in-100 on the Kendrapara '
      + 'delta. Only 53.9% is dry at every modelled return period, and much of '
      + 'that is already built on.',
    kind: 'XYZ',
    hazard: 'FLOOD',
    url: '/floodrp-westbengal/{z}/{x}/{y}.png',
    bounds: [87.3, 21.1, 89.05, 22.8],
    maxzoom: 11,
    defaultOn: false,
    opacity: 0.85,
    legend: [
      { label: 'High \u00b7 floods 1-in-10 yr or more often', color: '#1a3f66', note: '31.8%' },
      { label: 'Moderate \u00b7 1-in-11 to 1-in-100', color: '#2f7099', note: '9.5%' },
      { label: 'Low \u00b7 1-in-101 to 1-in-1000', note: '4.8% \u2014 in the data, not drawn' },
      { label: 'Dry at every modelled return period', note: '53.9% \u2014 not a safety guarantee' },
    ],
    provenance: {
      status: 'LIVE',
      source:
        'Aqueduct Flood Hazard Maps V2 \u2014 coastal (inuncoast, 2010, no '
        + 'subsidence) and riverine (inunriver), historical',
      agency: 'World Resources Institute',
      method:
        'Global hydrological and inundation modelling at nine return periods. '
        + 'Each cell is classed by the SMALLEST return period at which it is '
        + 'inundated to more than 0.05 m, so the value states how often ground '
        + 'floods rather than whether it happened to flood in a sampled year. '
        + 'Coastal and riverine are fetched separately and combined on the '
        + 'minimum: at the Hooghly mouth the same ground takes surge from the '
        + 'Bay and freshwater flood down the distributaries, and taking only '
        + 'the coastal product would call the inland half of this box dry. '
        + 'Retrieved through Earth Engine (WRI/Aqueduct_Flood_Hazard_Maps/V2). '
        + 'LIMITS. The model does not represent embankment breaches, which on '
        + 'this coast is how flooding usually actually happens \u2014 the '
        + 'Sundarbans are ringed by earthen bunds and it is their failure, not '
        + 'overtopping, that puts water in villages. At ~900 m it also cannot '
        + 'see which side of a bund a hamlet sits on. Read it as where water '
        + 'goes when the defences are absent, not as a forecast of where it '
        + 'will go.',
      resolution: '30 arcsec (~900 m)',
      citation: 'WRI Aqueduct Floods, Ward et al. Note this is V2; V3 exists.',
      assessedOn: '2026-09-05T00:00:00+05:30',
    },
  },
  {
    id: 'erosion-ghoramara',
    label: 'Land lost to the sea \u2014 Ghoramara and Sagar, 1990\u20132026',
    meaning:
      'Ground that stood above water in the 1990-91 dry season and is water '
      + 'now, and the converse. Ghoramara is the island that is going: measured '
      + 'off the current imagery it is down to 3.40 km\u00b2, and its people '
      + 'have been moving to Sagar Island \u2014 which is inside this same box '
      + 'and eroding too. 78.6 km\u00b2 lost against 55.2 km\u00b2 gained, '
      + 'shown as two classes and never netted: netting reports +23 km\u00b2 '
      + 'and hides the finding, and the gain is channel bar and spit at a '
      + 'shifting river mouth, not ground anyone can be resettled onto. '
      + 'MUCH OF BOTH CLASSES HERE IS THE HOOGHLY MOVING rather than the coast '
      + 'retreating \u2014 this is an estuary, and the open-coast loss along '
      + 'the island fringes is the part that speaks to relocation.',
    kind: 'GEOJSON',
    hazard: 'COASTAL_EROSION',
    url: '/layers/erosion-ghoramara.geojson',
    classField: 'change',
    classColors: {
      LOST: '#c2410c',
      GAINED: '#1e5f8c',
    },
    bounds: [87.95, 21.5, 88.4, 22.05],
    defaultOn: false,
    opacity: 0.72,
    legend: [
      { label: 'Land lost 1990\u20132026', color: '#c2410c', note: '91 polygons \u00b7 78.6 km\u00b2' },
      { label: 'Land gained', color: '#1e5f8c', note: '89 polygons \u00b7 55.2 km\u00b2 \u00b7 mostly channel bar' },
      { label: 'Unchanged', note: 'not drawn \u2014 includes coast retreating slower than one pixel' },
      { label: 'Extent', note: 'clipped to the analysis box; the retreat continues past both ends' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Landsat Collection 2 Level-2, dry seasons 1990-91 and 2025-26',
      agency: 'Derived in this application. Imagery: USGS / NASA.',
      method:
        'NDWI = (green \u2212 NIR) / (green + NIR), thresholded at 0, '
        + 'differenced between two epochs. EACH EPOCH IS A MEDIAN OF MANY '
        + 'SCENES, NOT ONE OVERFLIGHT \u2014 2 for 1990-91 and 14 for 2025-26, '
        + 'each cloud-free and covering the whole area of interest. Single-date '
        + 'pairs do not work on a coast like this: the tide moves the waterline '
        + 'across these flats by more than a decade of erosion does, so two '
        + 'scenes would report the tide. Seasons are matched at both ends so '
        + 'monsoon turbidity is not doing the talking either. '
        + 'VERIFIED AGAINST A NULL: splitting the 2025-26 window in half and '
        + 'differencing the two composites \u2014 where no erosion can have '
        + 'happened \u2014 yields 5.95 km\u00b2 of apparent loss. The measured '
        + 'loss is 14.0 times that. '
        + 'LIMITS. A two-epoch comparison illustrating known erosion, NOT a '
        + 'rate study \u2014 nothing here should be quoted as m/yr. The past '
        + 'composite rests on only TWO clear scenes, because 1990-91 is thin '
        + 'over this cloudier coast, so it averages tide less well than the '
        + 'present one does. Polygons under 5 ha are dropped so the layer stays '
        + 'servable, discarding 5.8% of lost and 6.3% of gained area; the '
        + 'threshold is coarser than Satabhaya\u2019s because the Hooghly '
        + 'mouth vectorises an order of magnitude more complex.',
      resolution: '30 m',
      citation:
        'LANDSAT/LT05/C02/T1_L2 and LANDSAT/LC08,LC09/C02/T1_L2 via Earth '
        + 'Engine. Island position and remaining area measured from the '
        + '2025-26 composite, not from a published figure.',
      assessedOn: '2026-09-05T00:00:00+05:30',
    },
  },
  {
    id: 'satabhaya-shoreline-change',
    label: 'Land lost to the sea \u2014 Satabhaya, 1990\u20132026',
    meaning:
      'Ground that stood above water in the 1990-91 dry season and is sea now, '
      + 'and the converse. This is the reach where the coast took the village: '
      + 'the seven hamlets of the Satabhaya group went under, and 571 families '
      + 'were resettled inland at Bagapatia in 2018. 7.3 km\u00b2 lost against '
      + '3.8 km\u00b2 gained \u2014 shown as two classes and deliberately NOT '
      + 'netted, because the gain is a spit building at the Dhamra mouth and is '
      + 'not ground anyone can be resettled onto. Netting them reports +3.6 '
      + 'km\u00b2 and hides the entire finding. Read this beside the transect '
      + 'layer rather than instead of it: this says WHERE land went, the '
      + 'transects say HOW FAST it is going.',
    kind: 'GEOJSON',
    hazard: 'COASTAL_EROSION',
    url: '/layers/satabhaya-shoreline-change.geojson',
    classField: 'change',
    /* Same two ends as the transect ramp, so retreat reads as the same colour
     * on both coastal layers and an officer switching between them is not
     * relearning the key. */
    classColors: {
      LOST: '#c2410c',
      GAINED: '#1e5f8c',
    },
    bounds: [86.85, 20.55, 87.05, 20.75],
    defaultOn: false,
    opacity: 0.72,
    legend: [
      { label: 'Land lost 1990\u20132026', color: '#c2410c', note: '13 polygons \u00b7 7.3 km\u00b2 \u00b7 largest 580 ha' },
      { label: 'Land gained', color: '#1e5f8c', note: '19 polygons \u00b7 3.8 km\u00b2 \u00b7 mostly the Dhamra spit' },
      { label: 'Unchanged', note: 'not drawn \u2014 includes coast retreating slower than one pixel' },
      { label: 'Extent', note: 'clipped to the analysis box; the retreat continues past both ends' },
    ],
    provenance: {
      status: 'LIVE',
      source: 'Landsat Collection 2 Level-2, dry seasons 1990-91 and 2025-26',
      agency: 'Derived in this application. Imagery: USGS / NASA.',
      method:
        'NDWI = (green \u2212 NIR) / (green + NIR), thresholded at 0 to separate '
        + 'land from water, differenced between two epochs. '
        + 'EACH EPOCH IS A MEDIAN OF MANY SCENES, NOT ONE OVERFLIGHT: 6 scenes '
        + 'for 1990-91 and 11 for 2025-26, every one cloud-free and covering '
        + 'the whole area of interest. Single-date pairs were tried first and '
        + 'do not work here \u2014 the tide moves the waterline across '
        + 'Gahirmatha\u2019s flats by more than a decade of erosion does, so '
        + 'two scenes would have reported the tide. Seasons are matched at both '
        + 'ends so monsoon turbidity is not doing the talking either. '
        + 'The threshold was read off the histogram rather than assumed: the '
        + 'land mode runs \u22120.65 to \u22120.25 and the water mode +0.25 to '
        + '+0.55, with ~1.5% of pixels between, so zero sits mid-trough and the '
        + 'classification barely moves if it shifts. '
        + 'VERIFIED AGAINST A NULL: splitting the 2025-26 window in half and '
        + 'differencing the two composites \u2014 where no erosion can have '
        + 'happened \u2014 yields 0.89 km\u00b2 of apparent loss. The measured '
        + 'loss is 9.0 times that. Cross-checked independently too: the area '
        + 'implies 5.6\u20139.0 m/yr of mean retreat, against \u22124.3 m/yr '
        + 'median and \u22128.5 m/yr p10 from the ShorelineMonitor transects '
        + 'over the same box, which are measured by an unrelated method. '
        + 'LIMITS. This is a two-epoch comparison illustrating known erosion, '
        + 'NOT a rate study \u2014 nothing here should be quoted as m/yr; the '
        + 'transect layer is the rate product. Polygons under 2 ha are dropped '
        + 'so the layer stays legible, discarding 8.1% of lost and 11.5% of '
        + 'gained area. Some GAINED polygons along channel margins reflect '
        + 'channel width and tide rather than durable accretion; the open-coast '
        + 'loss band is the robust part of this layer. Sentinel-2 was the first '
        + 'choice and was rejected on measurement: its 2016\u20132026 window '
        + 'gives +1.9 km\u00b2 against \u00b12.6 km\u00b2 of noise.',
      resolution: '30 m',
      citation:
        'LANDSAT/LT05/C02/T1_L2 and LANDSAT/LC08,LC09/C02/T1_L2 via Earth '
        + 'Engine. Village location and resettlement figures are public record.',
      assessedOn: '2026-09-05T00:00:00+05:30',
    },
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
