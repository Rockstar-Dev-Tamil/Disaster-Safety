/* ============================================================================
 * SHORELINE CHANGE, KENDRAPARA -- GENERATED, DO NOT EDIT BY HAND
 *
 * Written by scripts/build-shoreline-factors.py from ShorelineMonitor
 * transects pulled by scripts/fetch-shoreline.py. Re-run both to refresh.
 *
 * Every rate below is metres per year at the habitation's own reach, measured,
 * not assumed: negative is retreat, positive is accretion. `medianRate` is the
 * central estimate over transects within 5.0 km and is what feeds the
 * score. `worstRate` and `p10Rate` are carried so the spread stays visible --
 * a median of -6 m/yr over a reach whose worst transect is -14 is a different
 * operational picture from one whose worst is -7, and the officer should be
 * able to see which they are looking at.
 *
 * The published rate is the ordinary-least-squares slope of shoreline position
 * against year, fitted over observations flagged obs_is_primary. That was
 * verified rather than assumed: refitting all 1681 rated transects from
 * their own observation series reproduces the published rate to within
 * 1 m/yr for 99.9 per cent of them.
 *
 * Source: ShorelineMonitor / Global Coastal Transect Repository, Deltares.
 * Licensed CC-BY-4.0 -- attribution is required wherever these figures appear.
 * ==========================================================================*/

/** Search radius used to select the transects describing a habitation's reach. */
export const SHORELINE_RADIUS_KM = 5.0;

/** Erosion rate treated as full scale by the coastal susceptibility factor. */
export const RATE_FULL_SCALE_M_PER_YR = 15.0;

export interface ShorelineStats {
  /** Rated transects within SHORELINE_RADIUS_KM. Zero means inland. */
  n: number;
  /** Distance to the nearest rated transect, km. Present even when n is 0. */
  nearestKm: number;
  /** Median rate over the reach, m/yr. Negative is retreat. */
  medianRate?: number;
  /** Tenth-percentile rate -- the fast end of the reach. */
  p10Rate?: number;
  /** Single fastest-retreating transect in the reach. */
  worstRate?: number;
  /** Share of transects in the reach that are eroding rather than accreting. */
  erodingShare?: number;
  nearestRate?: number;
  nearestStdErr?: number;
  nearestR2?: number;
  windowStart?: string;
  windowEnd?: string;
}

export const SHORELINE: Record<string, ShorelineStats> = {
  'Kanhupur': { n: 90, medianRate: -6.51, p10Rate: -8.2, worstRate: -8.53, erodingShare: 1.0, nearestKm: 2.13, nearestRate: -6.52, nearestStdErr: 0.17, nearestR2: 0.98, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Talachua': { n: 0, nearestKm: 5.22 },
  'Gupti': { n: 0, nearestKm: 8.69 },
  'Batighar': { n: 100, medianRate: -5.03, p10Rate: -6.76, worstRate: -7.59, erodingShare: 1.0, nearestKm: 0.43, nearestRate: -5.13, nearestStdErr: 0.19, nearestR2: 0.96, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Barahipur': { n: 83, medianRate: -7.83, p10Rate: -8.99, worstRate: -9.24, erodingShare: 1.0, nearestKm: 2.79, nearestRate: -8.52, nearestStdErr: 0.18, nearestR2: 0.99, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Gobindapur': { n: 0, nearestKm: 5.45 },
  'Magarkanda': { n: 73, medianRate: -8.49, p10Rate: -9.24, worstRate: -10.43, erodingShare: 1.0, nearestKm: 3.44, nearestRate: -8.8, nearestStdErr: 0.25, nearestR2: 0.98, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Kharinasi': { n: 0, nearestKm: 8.52 },
  'Jamboo': { n: 0, nearestKm: 18.13 },
  'Petchhela': { n: 30, medianRate: 0.48, p10Rate: -3.91, worstRate: -4.62, erodingShare: 0.4, nearestKm: 4.67, nearestRate: -1.19, nearestStdErr: 0.5, nearestR2: 0.16, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Tantiapal': { n: 150, medianRate: 2.41, p10Rate: -4.2, worstRate: -36.14, erodingShare: 0.293, nearestKm: 0.34, nearestRate: -7.34, nearestStdErr: 1.56, nearestR2: 0.82, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Ramnagar': { n: 87, medianRate: -15.66, p10Rate: -18.21, worstRate: -18.85, erodingShare: 1.0, nearestKm: 1.73, nearestRate: -18.31, nearestStdErr: 0.46, nearestR2: 0.98, windowStart: '1988-12-31', windowEnd: '2022-12-31' },
  'Rajnagar': { n: 0, nearestKm: 9.81 },
  'Rajkanika': { n: 0, nearestKm: 18.17 },
  'Pattamundai': { n: 0, nearestKm: 20.83 },
  'Marshaghai': { n: 0, nearestKm: 6.57 },
  'Aul': { n: 0, nearestKm: 24.12 },
  'Garadpur': { n: 0, nearestKm: 32.11 },
  'Derabish': { n: 0, nearestKm: 42.9 },
};

/** Retreat rate mapped onto the published 0-100 susceptibility scale.
 *
 * Accretion is not negative risk: a prograding shoreline scores 0, it does not
 * offset other factors. Only retreat contributes.
 */
export function retreatNormalised(s: ShorelineStats): number {
  if (s.n === 0 || s.medianRate === undefined) return 0;
  const retreat = Math.max(0, -s.medianRate);
  return Math.round(Math.min(100, (retreat / RATE_FULL_SCALE_M_PER_YR) * 100));
}

/** One-line description of the reach, for the factor's raw column. */
export function retreatSummary(s: ShorelineStats): string {
  if (s.n === 0 || s.medianRate === undefined) {
    return `No shoreline transect within ${SHORELINE_RADIUS_KM} km `
      + `(nearest ${s.nearestKm} km)`;
  }
  const verb = s.medianRate < 0 ? 'retreat' : 'accretion';
  // worstRate is signed; the word beside it already carries the direction, so
  // printing the sign as well gives "retreat ... fastest -8.5", which reads as
  // if the fastest transect were accreting.
  const fastest = Math.abs(s.worstRate ?? s.medianRate).toFixed(1);
  return `${Math.abs(s.medianRate).toFixed(1)} m/yr ${verb} (median of ${s.n} `
    + `transects within ${SHORELINE_RADIUS_KM} km; fastest ${fastest} m/yr), `
    + `${s.windowStart?.slice(0, 4)}-${s.windowEnd?.slice(0, 4)}`;
}
