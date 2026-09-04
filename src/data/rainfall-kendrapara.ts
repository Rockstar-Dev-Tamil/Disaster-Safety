/* ============================================================================
 * OBSERVED RAINFALL, KENDRAPARA -- GENERATED FILE, DO NOT EDIT BY HAND
 *
 * Real values. NASA GPM IMERG V07B, Final Run, half-hourly, aggregated to
 * 3-hourly blocks over the 0.1 deg cell containing Kanhupur.
 *
 * OBSERVED, not forecast: what fell, not what was coming. The ECMWF overlay on
 * the map is the forecast counterpart and will not agree exactly -- that
 * disagreement is the useful part, not an error to be reconciled.
 *
 * NO RETURN LEVELS HERE, deliberately. Wayanad carries them because a rainfall
 * threshold fires its landslide advisory. This case is triggered by surge,
 * tide and embankment breach; rainfall is context. A fitted return period
 * would be a number nothing reads, and would imply rainfall governs a
 * coastal-erosion assessment.
 *
 * Regenerate:
 *   IMERG_AOI=kendrapara SCRATCH=<dir> python scripts/fetch-imerg.py
 *   python scripts/build-kendrapara-rain.py
 * ==========================================================================*/

import type { Provenance } from './schema';

export const KDP_RAINFALL_CELL = {
  lon: 86.95,
  lat: 20.65,
  sizeDeg: 0.1,
  approxKm: 11,
};

export const KDP_RAINFALL_PROVENANCE: Provenance = {
  status: 'LIVE',
  source: 'GPM IMERG V07B Final Run, half-hourly (GPM_3IMERGHH)',
  agency: 'NASA GES DISC / JAXA',
  method:
    'Multi-satellite retrieval, gauge-calibrated at monthly scale. Half-hourly '
    + 'rates aggregated to 3-hourly accumulations over one 0.1 deg cell '
    + 'containing Kanhupur.',
  resolution: '0.1 deg (~11 km), 30 min',
  citation: 'GPM_3IMERGHH.07, doi:10.5067/GPM/IMERG/3B-HH/07',
  observedAt: '2024-07-29T23:30:00+05:30',
};

export interface KdpRainFrame {
  t: string;
  rain3h: number;
  rain24h: number;
  rainCumulative: number;
}

export const KDP_RAIN_FRAMES: KdpRainFrame[] = [
  { t: '2024-07-29T05:30:00+05:30', rain3h: 6.1, rain24h: 8.6, rainCumulative: 6.1 },
  { t: '2024-07-29T08:30:00+05:30', rain3h: 14.8, rain24h: 23.0, rainCumulative: 20.9 },
  { t: '2024-07-29T11:30:00+05:30', rain3h: 7.8, rain24h: 30.7, rainCumulative: 28.7 },
  { t: '2024-07-29T14:30:00+05:30', rain3h: 0.8, rain24h: 31.5, rainCumulative: 29.5 },
  { t: '2024-07-29T17:30:00+05:30', rain3h: 0.0, rain24h: 30.6, rainCumulative: 29.5 },
  { t: '2024-07-29T20:30:00+05:30', rain3h: 0.7, rain24h: 31.2, rainCumulative: 30.2 },
  { t: '2024-07-29T23:30:00+05:30', rain3h: 0.2, rain24h: 31.3, rainCumulative: 30.4 },
];
