/* ============================================================================
 * OBSERVED RAINFALL  --  GENERATED FILE, DO NOT EDIT BY HAND
 *
 * Real values. NASA GPM IMERG V07B, Final Run, half-hourly, aggregated to
 * 3-hourly blocks over the 0.1 deg cell containing Chooralmala.
 *
 * NOTE ON NAMING: this is OBSERVED precipitation, not a nowcast. It says what
 * fell, not what is coming.
 *
 * THRESHOLDS ARE DERIVED, NOT ASSERTED.
 * The IMD "extremely heavy" category boundary of 204.5 mm is gauge-calibrated
 * and cannot be applied to a satellite estimate that under-reads orographic
 * extremes here by roughly a factor of three -- doing so reports no exceedance
 * for an event that killed around 400 people. Instead the return levels below
 * are fitted to this cell's own record, so IMERG is compared against IMERG and
 * the bias cancels on both sides.
 *
 * Fitted from 26 annual maximum daily accumulations,
 * 1998-2023 monsoon seasons (Jun-Sep), Gumbel by
 * L-moments. The event year is excluded from the baseline so the event cannot
 * help define the threshold it is tested against.
 *
 * Regenerate: scripts/fetch-imerg.py then scripts/derive-thresholds.py
 * ==========================================================================*/

import type { Provenance } from './schema';

export const RAINFALL_CELL = {
  lon: 76.15,
  lat: 11.45,
  /** 0.1 deg. Chooralmala, Mundakkai, Attamala and Punchirimattom all fall
   *  inside this single cell and therefore share one rainfall figure. */
  sizeDeg: 0.1,
  approxKm: 11,
};

export const RAINFALL_PROVENANCE: Provenance = {
  status: 'LIVE',
  source: 'GPM IMERG V07B Final Run, half-hourly (GPM_3IMERGHH)',
  agency: 'NASA GES DISC / JAXA',
  method:
    'Multi-satellite retrieval, gauge-calibrated at monthly scale. Half-hourly '
    + 'rates aggregated to 3-hourly accumulations over one 0.1 deg cell.',
  resolution: '0.1 deg (~11 km), 30 min',
  citation: 'GPM_3IMERGHH.07, doi:10.5067/GPM/IMERG/3B-HH/07',
  observedAt: '2024-07-30T02:00:00+05:30',
};

export const RETURN_LEVEL_PROVENANCE: Provenance = {
  status: 'LIVE',
  source: 'Return levels fitted to GPM IMERG daily archive (GPM_3IMERGDF)',
  agency: 'Derived in this application from NASA GES DISC data',
  method:
    'Gumbel (EV1) fitted by L-moments to 26 annual maximum daily '
    + 'accumulations, 1998-2023 monsoon seasons (Jun-Sep), for this cell. '
    + 'Event year excluded from the baseline.',
  resolution: '0.1 deg cell',
  assessedOn: '2026-08-26T00:00:00+05:30',
};

/** Fitted 24 h return levels, mm, for this cell. */
export const RETURN_LEVELS: Record<number, number> = {
  2: 87.3,
  5: 112.9,
  10: 129.9,
  25: 151.3,
  50: 167.2,
  100: 183.0,
};

export const ANNUAL_MAXIMA = {
  years: 26,
  from: 1998,
  to: 2023,
  observedMin: 54.2,
  observedMax: 186.9,
};

export interface RainFrame {
  t: string;
  rain3h: number;
  rain24h: number;
  rainCumulative: number;
  /** Return period of the 24 h accumulation, for this cell. */
  returnPeriodYears: number;
}

export const RAIN_FRAMES: RainFrame[] = [
  { t: '2024-07-29T02:30:00+05:30', rain3h: 7.0, rain24h: 17.4, rainCumulative: 17.4, returnPeriodYears: 1.0 },
  { t: '2024-07-29T05:30:00+05:30', rain3h: 6.8, rain24h: 17.6, rainCumulative: 24.2, returnPeriodYears: 1.0 },
  { t: '2024-07-29T08:30:00+05:30', rain3h: 25.1, rain24h: 42.4, rainCumulative: 49.3, returnPeriodYears: 1.0 },
  { t: '2024-07-29T11:30:00+05:30', rain3h: 11.4, rain24h: 53.5, rainCumulative: 60.7, returnPeriodYears: 1.0 },
  { t: '2024-07-29T14:30:00+05:30', rain3h: 8.8, rain24h: 62.1, rainCumulative: 69.5, returnPeriodYears: 1.1 },
  { t: '2024-07-29T17:30:00+05:30', rain3h: 10.5, rain24h: 72.5, rainCumulative: 80.0, returnPeriodYears: 1.4 },
  { t: '2024-07-29T20:30:00+05:30', rain3h: 12.5, rain24h: 84.6, rainCumulative: 92.5, returnPeriodYears: 1.8 },
  { t: '2024-07-29T23:30:00+05:30', rain3h: 24.1, rain24h: 106.2, rainCumulative: 116.5, returnPeriodYears: 3.8 },
  { t: '2024-07-30T02:30:00+05:30', rain3h: 21.4, rain24h: 120.6, rainCumulative: 138.0, returnPeriodYears: 6.8 },
  { t: '2024-07-30T05:30:00+05:30', rain3h: 19.5, rain24h: 133.2, rainCumulative: 150.8, returnPeriodYears: 11.5 },
  { t: '2024-07-30T08:30:00+05:30', rain3h: 19.7, rain24h: 127.9, rainCumulative: 170.2, returnPeriodYears: 9.2 },
];

/** State at the operating picture timestamp. */
export const RAIN_AT_CLOCK = {
  t: '2024-07-30T02:00:00+05:30',
  rain3h: 24.1,
  rain24h: 106.2,
  rainCumulative: 116.5,
  returnPeriodYears: 3.8,
};

/* ==========================================================================
 * TERRAIN-CONDITIONED TRIGGER
 *
 * Rainfall alone does not decide. A 1-in-4-year accumulation is unremarkable
 * on stable ground and decisive on a 31 deg weathered-charnockite slope with
 * three failures within 5 km since 2018. Landslide early-warning practice
 * conditions intensity-duration thresholds on terrain, and so does this.
 * ==========================================================================*/

export const TRIGGER_RP_BY_BAND: Record<string, number> = {
  VERY_HIGH: 2,
  HIGH: 5,
  MODERATE: 15,
  LOW: 50,
  VERY_LOW: 100,
};

export function triggerFires(band: string, returnPeriodYears: number): boolean {
  const need = TRIGGER_RP_BY_BAND[band];
  return need !== undefined && returnPeriodYears >= need;
}
