/* ============================================================================
 * SOURCE REGISTRY
 *
 * Each entry names a real, obtainable published product. Values sampled from
 * them are marked PENDING_OVERLAY until ingest; the UI renders that status as
 * a visible chip on every figure so nothing here can be mistaken for an
 * official assessment before the overlay lands.
 *
 * This file doubles as the ingest checklist. When a layer is wired up, change
 * its status to 'LIVE' and set assessedOn/observedAt from the product itself.
 * ==========================================================================*/

import type { Assessment, Factor, Provenance, SusceptibilityBand } from './schema';

const pending = (p: Omit<Provenance, 'status'>): Provenance => ({
  ...p,
  status: 'PENDING_OVERLAY',
});

/* ------------------------------------------------ hazard susceptibility  */

export const SRC_GSI_NLSM = pending({
  source: 'National Landslide Susceptibility Map (NLSM), 1:50,000',
  agency: 'Geological Survey of India',
  method:
    'Heuristic weighted overlay of slope, relative relief, lithology, structural ' +
    'features, land use / land cover and hydrogeology. Expert-assigned weights.',
  resolution: '1:50,000 (approx. 30 m raster derivative)',
  citation: 'GSI Bhukosh portal, NLSM tile set',
  assessedOn: '2023-03-31T00:00:00+05:30',
});

export const SRC_KSDMA_LS = pending({
  source: 'Kerala Landslide Susceptibility Map, district series',
  agency: 'Kerala State Disaster Management Authority / NCESS',
  method:
    'Frequency-ratio weighting of slope, lithology, soil, LULC, drainage ' +
    'density and lineament density, validated against inventory.',
  resolution: '1:50,000',
  citation: 'KSDMA hazard atlas, Wayanad sheet',
  assessedOn: '2022-06-30T00:00:00+05:30',
});

export const SRC_NRSC_FLOOD = pending({
  source: 'Flood Hazard Zonation, Bhuvan flood atlas',
  agency: 'National Remote Sensing Centre, ISRO',
  method:
    'Multi-temporal SAR inundation frequency, 1998-2023, classed by ' +
    'return-period exceedance.',
  resolution: '30 m',
  citation: 'NRSC Bhuvan flood hazard product',
  assessedOn: '2024-01-31T00:00:00+05:30',
});

export const SRC_NCSCM_SHORELINE = pending({
  source: 'National Assessment of Shoreline Change, Odisha coast',
  agency: 'National Centre for Sustainable Coastal Management, MoEFCC',
  method:
    'DSAS end-point and linear-regression rates on 1990-2018 shoreline ' +
    'vectors, transect spacing 100 m, classed erosion/accretion.',
  resolution: '100 m transects',
  citation: 'NCSCM shoreline change atlas, Kendrapara sheet',
  assessedOn: '2021-12-31T00:00:00+05:30',
});

/* The first source in this registry that is actually ingested rather than
 * awaiting an overlay. The transects are pulled by scripts/fetch-shoreline.py
 * and reduced by scripts/build-shoreline-factors.py; every rate the console
 * shows from it is measured at the habitation's own reach.
 *
 * It does not replace SRC_NCSCM_SHORELINE. NCSCM is the statutory Indian
 * assessment and remains the authority for a shoreline-change figure entering
 * an official record; this is an independent satellite-derived measurement
 * that happens to be obtainable today. Where the two disagree, both are shown.
 *
 * CC-BY-4.0. The attribution below is a licence condition, not a courtesy. */
export const SRC_DELTARES_SHORELINE: Provenance = {
  status: 'LIVE',
  source: 'ShorelineMonitor / Global Coastal Transect Repository (GCTR)',
  agency: 'Deltares',
  method:
    'Satellite-derived shoreline positions from Landsat and Sentinel-2 '
    + 'composites, sampled on 100 m transects. Rate is the ordinary '
    + 'least-squares slope of shoreline position against year over '
    + 'observations flagged primary; standard error and R-squared published '
    + 'per transect.',
  resolution: '100 m transect spacing',
  citation:
    'ShorelineMonitor, Deltares, CC-BY-4.0. Retrieved via the OGC WFS at '
    + 'shoreline-monitor.openearth.eu, 3 September 2026.',
  assessedOn: '2026-09-03T00:00:00+05:30',
};

export const SRC_INCOIS_SURGE = pending({
  source: 'Storm surge and coastal inundation hazard maps',
  agency: 'Indian National Centre for Ocean Information Services',
  method: 'ADCIRC surge modelling at 1-in-100-year cyclone return period.',
  resolution: '150 m',
  citation: 'INCOIS coastal vulnerability product, Odisha',
  assessedOn: '2022-09-30T00:00:00+05:30',
});

/* ------------------------------------------------------------ operational */

export const SRC_IMD_NOWCAST = pending({
  source: 'District nowcast and AWS/ARG rainfall',
  agency: 'India Meteorological Department',
  method:
    'Radar-derived 3-hourly nowcast blended with automatic rain gauge ' +
    'accumulations; colour code per IMD impact-based warning protocol.',
  resolution: 'Station point / district polygon',
  citation: 'IMD nowcast bulletin archive',
});

export const SRC_IMD_THRESHOLD = pending({
  source: 'Rainfall threshold criteria for landslide advisory',
  agency: 'IMD / GSI joint landslide early warning protocol',
  method:
    'Intensity-duration thresholds calibrated on the Western Ghats ' +
    'inventory; advisory raised on cumulative and 24 h exceedance.',
  citation: 'GSI landslide early warning system, Western Ghats',
});

export const SRC_SDMA_ADVISORY = pending({
  source: 'State advisory and red-zone declaration log',
  agency: 'State Disaster Management Authority',
  method: 'Operational record of declarations, orders and withdrawals.',
});

/* -------------------------------------------------------- administrative */

export const SRC_CENSUS = pending({
  source: 'Census of India 2011, village directory + LGD registry',
  agency: 'Office of the Registrar General of India',
  method: 'Enumerated household and population counts, projected to current year.',
  citation: 'Census 2011 PCA; LGD codes current',
  assessedOn: '2011-03-01T00:00:00+05:30',
});

export const SRC_REVENUE = pending({
  source: 'Revenue land records and land-use classification',
  agency: 'State Revenue Department, district record room',
  method: 'Village-level khatian / ROR extract with classification and encumbrance.',
});

export const SRC_ROAD = pending({
  source: 'Road network and condition survey',
  agency: 'State PWD / National Highways Authority of India',
  method:
    'Classified alignment with carriageway width, surface condition and ' +
    'structures inventory (culverts, causeways, cut slopes).',
});

/* ------------------------------------------------ out-of-scope modules   */

export const SRC_M2_STRUCTURES: Provenance = {
  status: 'STUB_M2',
  source: 'Module 2 - satellite structure density (not in this build)',
  agency: 'NRSC high-resolution imagery + building footprint extraction',
  method:
    'Footprint segmentation over sub-metre imagery, counted within the ' +
    'hazard footprint polygon.',
  resolution: '0.5 m panchromatic',
};

export const SRC_M4_LIVABILITY: Provenance = {
  status: 'STUB_M4',
  source: 'Module 4 - resettlement livability index (not in this build)',
  agency: 'Composite of service access, livelihood and social infrastructure',
  method:
    'Weighted index over water, power, health, education, market access, ' +
    'livelihood continuity and social cohesion sub-indices.',
};

/* ==========================================================================
 * DERIVATION HELPERS
 *
 * Scores are COMPUTED from their factor rows, never hand-written. This is
 * what makes the breakdown honest: the number on screen is the arithmetic of
 * the rows beneath it, so it cannot drift from them, and no ranking can be
 * quietly hand-picked.
 * ==========================================================================*/

export function bandFor(score: number): SusceptibilityBand {
  if (score >= 80) return 'VERY_HIGH';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  if (score >= 20) return 'LOW';
  return 'VERY_LOW';
}

/** score = sum(normalised * weight). Throws if weights do not sum to 1.0. */
export function derive(
  factors: Factor[],
  provenance: Provenance,
  aggregation?: string,
): Assessment {
  const wsum = factors.reduce((a, f) => a + f.weight, 0);
  if (Math.abs(wsum - 1) > 1e-6) {
    throw new Error(
      `Weights must sum to 1.0, got ${wsum.toFixed(4)} for [${factors
        .map((f) => f.key)
        .join(', ')}]`,
    );
  }
  const score = factors.reduce((a, f) => a + f.normalised * f.weight, 0);
  const rounded = Math.round(score * 10) / 10;
  return { score: rounded, band: bandFor(rounded), factors, provenance, aggregation };
}

export const contribution = (f: Factor) => Math.round(f.normalised * f.weight * 10) / 10;
