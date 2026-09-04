/* ============================================================================
 * FACTOR BUILDERS
 *
 * Standard factor row-sets per hazard type and per assessment kind. Keeping
 * the weight vectors in one place means the published weights are auditable
 * in a single file, and every habitation of a given hazard type is scored on
 * the same basis -- which is the whole defensibility argument.
 * ==========================================================================*/

import type { Factor, HazardType, Provenance } from './schema';

type Row = [
  raw: string,
  normalised: number,
  scale?: string,
  note?: string,
  /** Only when this row's source differs from the assessment's. */
  provenance?: Provenance,
];

function build(
  spec: Array<{ key: string; label: string; weight: number }>,
  rows: Row[],
): Factor[] {
  return spec.map((s, i) => ({
    key: s.key,
    label: s.label,
    weight: s.weight,
    raw: rows[i][0],
    normalised: rows[i][1],
    scale: rows[i][2],
    note: rows[i][3],
    provenance: rows[i][4],
  }));
}

/* ------------------------------------------------ landslide (GSI NLSM)   */

const LANDSLIDE_SPEC = [
  { key: 'slope', label: 'Slope angle', weight: 0.25 },
  { key: 'lithology', label: 'Lithology / weathering', weight: 0.2 },
  { key: 'relief', label: 'Relative relief', weight: 0.15 },
  { key: 'drainage', label: 'Drainage proximity', weight: 0.15 },
  { key: 'lulc', label: 'Land use / land cover', weight: 0.1 },
  { key: 'incidents', label: 'Historical incidents', weight: 0.08 },
  { key: 'lineament', label: 'Lineament density', weight: 0.07 },
];

export const landslideFactors = (rows: Row[]) => build(LANDSLIDE_SPEC, rows);

/* --------------------------------------------- coastal erosion (NCSCM)   */

const COASTAL_SPEC = [
  { key: 'retreat', label: 'Shoreline retreat rate', weight: 0.28 },
  { key: 'surge', label: 'Surge inundation depth', weight: 0.2 },
  { key: 'elevation', label: 'Elevation above MSL', weight: 0.18 },
  { key: 'mangrove', label: 'Mangrove buffer width', weight: 0.14 },
  { key: 'shoredist', label: 'Distance to active shoreline', weight: 0.12 },
  { key: 'saline', label: 'Tidal range / saline ingress', weight: 0.08 },
];

export const coastalFactors = (rows: Row[]) => build(COASTAL_SPEC, rows);

/* ------------------------------------------------------ flood (NRSC)    */

const FLOOD_SPEC = [
  { key: 'freq', label: 'Inundation frequency', weight: 0.28 },
  { key: 'depth', label: 'Modelled depth (100-yr)', weight: 0.22 },
  { key: 'elevation', label: 'Height above drainage', weight: 0.18 },
  { key: 'embankment', label: 'Embankment condition', weight: 0.14 },
  { key: 'duration', label: 'Typical inundation duration', weight: 0.1 },
  { key: 'incidents', label: 'Historical incidents', weight: 0.08 },
];

export const floodFactors = (rows: Row[]) => build(FLOOD_SPEC, rows);

/* ---------------------------------------------------- cyclone / surge   */

const CYCLONE_SPEC = [
  { key: 'surge', label: 'Surge inundation depth', weight: 0.3 },
  { key: 'wind', label: 'Design wind exposure', weight: 0.22 },
  { key: 'elevation', label: 'Elevation above MSL', weight: 0.18 },
  { key: 'shelter', label: 'Shelter access deficit', weight: 0.16 },
  { key: 'structures', label: 'Structure vulnerability', weight: 0.14 },
];

export const cycloneFactors = (rows: Row[]) => build(CYCLONE_SPEC, rows);

/* -------------------------------------------------------- cloudburst    */

const CLOUDBURST_SPEC = [
  { key: 'intensity', label: 'Short-duration intensity', weight: 0.3 },
  { key: 'catchment', label: 'Catchment response time', weight: 0.24 },
  { key: 'channel', label: 'Channel proximity', weight: 0.2 },
  { key: 'slope', label: 'Slope angle', weight: 0.16 },
  { key: 'incidents', label: 'Historical incidents', weight: 0.1 },
];

export const cloudburstFactors = (rows: Row[]) => build(CLOUDBURST_SPEC, rows);

export function factorsFor(hazard: HazardType, rows: Row[]): Factor[] {
  switch (hazard) {
    case 'LANDSLIDE':
      return landslideFactors(rows);
    case 'COASTAL_EROSION':
      return coastalFactors(rows);
    case 'FLOOD':
      return floodFactors(rows);
    case 'CYCLONE':
      return cycloneFactors(rows);
    case 'CLOUDBURST':
      return cloudburstFactors(rows);
  }
}

/** Number of factor rows each hazard model expects. */
export const FACTOR_COUNT: Record<HazardType, number> = {
  LANDSLIDE: LANDSLIDE_SPEC.length,
  COASTAL_EROSION: COASTAL_SPEC.length,
  FLOOD: FLOOD_SPEC.length,
  CYCLONE: CYCLONE_SPEC.length,
  CLOUDBURST: CLOUDBURST_SPEC.length,
};

/* ==========================================================================
 * OPERATIONAL STATE (dynamic score)
 *
 * Separate model from susceptibility, and deliberately includes susceptibility
 * as ONE weighted input rather than replacing it. That is what lets the header
 * show a VERY_HIGH standing assessment next to a YELLOW current state without
 * either number contradicting the other.
 * ==========================================================================*/

/* Four rows, all observed or carried. An earlier version had a fifth
 * "soil saturation index" row, which was a number with no source behind it --
 * removed rather than dressed up, and the weight redistributed. */
const CURRENT_RAIN_SPEC = [
  { key: 'antecedent', label: 'Antecedent rainfall (48 h)', weight: 0.35 },
  { key: 'rain24', label: 'Rainfall, 24 h', weight: 0.3 },
  { key: 'static', label: 'Standing susceptibility', weight: 0.2 },
  { key: 'rain3', label: 'Rainfall intensity, 3 h', weight: 0.15 },
];

export const currentRainDrivers = (rows: Row[]) => build(CURRENT_RAIN_SPEC, rows);

const CURRENT_COASTAL_SPEC = [
  { key: 'system', label: 'Active cyclonic system', weight: 0.3 },
  { key: 'static', label: 'Standing susceptibility', weight: 0.3 },
  { key: 'tide', label: 'Tidal phase', weight: 0.15 },
  { key: 'seastate', label: 'Sea state / swell', weight: 0.15 },
  { key: 'wind', label: 'Onshore wind', weight: 0.1 },
];

export const currentCoastalDrivers = (rows: Row[]) => build(CURRENT_COASTAL_SPEC, rows);

/* ==========================================================================
 * SITE SUITABILITY (long-term destination ranking)
 *
 * Candidates are ranked on this and nothing else. No destination is promoted
 * by hand; the weight vector below decides the order.
 * ==========================================================================*/

const SITE_SPEC = [
  { key: 'terrain', label: 'Terrain suitability', weight: 0.25 },
  { key: 'distance', label: 'Distance from origin', weight: 0.15 },
  { key: 'capacity', label: 'Carrying capacity adequacy', weight: 0.15 },
  { key: 'livelihood', label: 'Livelihood continuity', weight: 0.15 },
  { key: 'infra', label: 'Infrastructure access', weight: 0.15 },
  { key: 'admin', label: 'Administrative proximity', weight: 0.1 },
  { key: 'land', label: 'Land availability', weight: 0.05 },
];

export const siteFactors = (rows: Row[]) => build(SITE_SPEC, rows);

/* ------------------------------------- livability (Module 4, stubbed)    */

const LIVABILITY_SPEC = [
  { key: 'water', label: 'Water supply', weight: 0.2 },
  { key: 'health', label: 'Health access', weight: 0.2 },
  { key: 'education', label: 'Education access', weight: 0.18 },
  { key: 'market', label: 'Market / transport', weight: 0.17 },
  { key: 'power', label: 'Power reliability', weight: 0.13 },
  { key: 'cohesion', label: 'Social cohesion retention', weight: 0.12 },
];

export const livabilityFactors = (rows: Row[]) => build(LIVABILITY_SPEC, rows);

/* ==========================================================================
 * ROUTE SEGMENT RISK
 * ==========================================================================*/

const SEGMENT_SPEC = [
  { key: 'slope', label: 'Adjacent slope susceptibility', weight: 0.3 },
  { key: 'history', label: 'Cut-slope / debris history', weight: 0.2 },
  { key: 'crossing', label: 'Stream crossing exposure', weight: 0.2 },
  { key: 'carriageway', label: 'Carriageway width / surface', weight: 0.15 },
  { key: 'exposure', label: 'Exposure duration', weight: 0.1 },
  { key: 'alternate', label: 'Alternate availability', weight: 0.05 },
];

export const segmentFactors = (rows: Row[]) => build(SEGMENT_SPEC, rows);

/* ==========================================================================
 * CAPACITY
 * ==========================================================================*/

/** 1 cent = 1/100 acre. 1 acre = 0.40468564224 ha. */
export const CENT_HA = 0.0040468564224;

export function capacityFrom(
  grossHa: number,
  exclusions: Array<{ label: string; ha: number; basis: string }>,
  infraOverheadPct: number,
  plotNormCents: number,
) {
  const excluded = exclusions.reduce((a, e) => a + e.ha, 0);
  const netDevelopableHa = Math.round((grossHa - excluded) * 10) / 10;
  const residentialHa =
    Math.round(netDevelopableHa * (1 - infraOverheadPct / 100) * 10) / 10;
  const plotNormHa = Math.round(plotNormCents * CENT_HA * 1e6) / 1e6;
  const households = Math.floor(residentialHa / plotNormHa);
  return {
    grossHa,
    exclusions,
    netDevelopableHa,
    infraOverheadPct,
    residentialHa,
    plotNormCents,
    plotNormHa,
    households,
  };
}
