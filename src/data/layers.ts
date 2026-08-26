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
import { SRC_IMD_NOWCAST, SRC_INCOIS_SURGE, SRC_NCSCM_SHORELINE } from './sources';

export type OverlayKind = 'DERIVED_DISTRICT' | 'WMS' | 'XYZ' | 'GEOJSON';

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
