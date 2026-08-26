/* ============================================================================
 * SEVERITY ENCODING
 *
 * Colour is never the sole channel. Every severity is also carried by:
 *   - a printed numeric score next to the mark
 *   - marker RADIUS (monotonic with severity)
 *   - marker STROKE WIDTH (heavier at the top two bands)
 * so the display survives deuteranopia, protanopia and greyscale print. The
 * hue sequence follows emergency-management convention; the LIGHTNESS ramp is
 * what actually does the discriminating.
 * ==========================================================================*/

import type { ImdAlert, SusceptibilityBand } from '../data/schema';

export const BAND_ORDER: SusceptibilityBand[] = [
  'VERY_LOW',
  'LOW',
  'MODERATE',
  'HIGH',
  'VERY_HIGH',
];

export const BAND_LABEL: Record<SusceptibilityBand, string> = {
  VERY_LOW: 'Very low',
  LOW: 'Low',
  MODERATE: 'Moderate',
  HIGH: 'High',
  VERY_HIGH: 'Very high',
};

export const BAND_RANGE: Record<SusceptibilityBand, string> = {
  VERY_LOW: '0-19',
  LOW: '20-39',
  MODERATE: '40-59',
  HIGH: '60-79',
  VERY_HIGH: '80-100',
};

/* L* approx 38 / 46 / 58 / 68 / 76 -- monotonic, so greyscale still ranks. */
export const BAND_FILL: Record<SusceptibilityBand, string> = {
  VERY_LOW: '#1d5e46',
  LOW: '#3f7a34',
  MODERATE: '#b0902a',
  HIGH: '#e08127',
  VERY_HIGH: '#ff7563',
};

export const BAND_TEXT: Record<SusceptibilityBand, string> = {
  VERY_LOW: '#7fc9a8',
  LOW: '#8fc47f',
  MODERATE: '#e0c968',
  HIGH: '#ffb173',
  VERY_HIGH: '#ffa495',
};

export const ALERT_ORDER: ImdAlert[] = ['GREEN', 'YELLOW', 'ORANGE', 'RED'];

export const ALERT_FILL: Record<ImdAlert, string> = {
  GREEN: '#2f7d54',
  YELLOW: '#bfa02e',
  ORANGE: '#e08127',
  RED: '#ff5f4d',
};

export const ALERT_TEXT: Record<ImdAlert, string> = {
  GREEN: '#7fc9a8',
  YELLOW: '#e0c968',
  ORANGE: '#ffb173',
  RED: '#ffa495',
};

export function bandFor(score: number): SusceptibilityBand {
  if (score >= 80) return 'VERY_HIGH';
  if (score >= 60) return 'HIGH';
  if (score >= 40) return 'MODERATE';
  if (score >= 20) return 'LOW';
  return 'VERY_LOW';
}

export const alertToBand: Record<ImdAlert, SusceptibilityBand> = {
  RED: 'VERY_HIGH',
  ORANGE: 'HIGH',
  YELLOW: 'MODERATE',
  GREEN: 'LOW',
};

/** Redundant size channel. Monotonic with severity. */
export const BAND_RADIUS: Record<SusceptibilityBand, number> = {
  VERY_LOW: 3,
  LOW: 3.6,
  MODERATE: 4.4,
  HIGH: 5.4,
  VERY_HIGH: 6.6,
};

/** Redundant stroke channel. Heavier at the top two bands. */
export const BAND_STROKE: Record<SusceptibilityBand, number> = {
  VERY_LOW: 0.6,
  LOW: 0.6,
  MODERATE: 0.8,
  HIGH: 1.4,
  VERY_HIGH: 2,
};
