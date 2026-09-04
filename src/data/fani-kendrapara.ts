/* ============================================================================
 * CYCLONE FANI AT KANHUPUR -- GENERATED FILE, DO NOT EDIT BY HAND
 *
 * Real observations. Rainfall is NASA GPM IMERG V07B over the 0.1 deg cell
 * containing Kanhupur; wind, gust, sea state and pressure are ECMWF ERA5
 * hourly reanalysis sampled at the habitation itself.
 *
 * REANALYSIS, NOT FORECAST. The ECMWF layer on the map is a forecast -- what
 * the model said in advance -- and the timeline says so. Nothing here is: the
 * open-data forecast archive begins in 2024 and cannot reach May 2019. ERA5
 * describes what the atmosphere did, assimilated afterwards. Any wording that
 * implied this was available to a forecaster before landfall would be false.
 *
 * THE CLOCK. 02 May 2019 18:30 IST is the first hour at which significant
 * wave height reaches 3.05 m, crossing the 3.0 m INCOIS high-wave alert this
 * habitation's feed is written against. Landfall near Puri was ~14 hours away.
 * The console is a decision tool, so it sits where the decision was.
 *
 * Regenerate: scripts/fetch-imerg.py, scripts/fetch-era5-event.py,
 * then scripts/build-fani.py
 * ==========================================================================*/

import type { Provenance } from './schema';

export const FANI_CLOCK = '2019-05-02T18:30:00+05:30';

/** Landfall near Puri, per IMD. Kanhupur is ~150 km up-coast. */
export const FANI_LANDFALL = '2019-05-03T08:00:00+05:30';

export const FANI_RAIN_PROVENANCE: Provenance = {
  status: 'LIVE',
  source: 'GPM IMERG V07B Final Run, half-hourly (GPM_3IMERGHH)',
  agency: 'NASA GES DISC / JAXA',
  method:
    'Multi-satellite retrieval, gauge-calibrated at monthly scale. Half-hourly '
    + 'rates aggregated to 3-hourly accumulations over the 0.1 deg cell '
    + 'containing Kanhupur.',
  resolution: '0.1 deg (~11 km), 30 min',
  citation: 'GPM_3IMERGHH.07, doi:10.5067/GPM/IMERG/3B-HH/07',
  observedAt: '2019-05-02T18:30:00+05:30',
};

export const FANI_SEA_PROVENANCE: Provenance = {
  status: 'LIVE',
  source: 'ERA5 hourly reanalysis (ECMWF/ERA5/HOURLY)',
  agency: 'ECMWF, via Google Earth Engine',
  method:
    'Reanalysis, NOT forecast: assimilated after the event. 10 m wind, gust, '
    + 'mean sea level pressure and significant wave height of combined wind '
    + 'waves and swell, sampled at the habitation. Full ERA5 rather than '
    + 'ERA5-Land, which masks this coastal cell as water and returns nothing.',
  resolution: '0.25 deg (~28 km), hourly',
  citation: 'Hersbach et al., ERA5 hourly data on single levels',
  observedAt: '2019-05-02T18:30:00+05:30',
};

export interface FaniFrame {
  t: string;
  rain3h: number;
  rain24h: number;
  rainCumulative: number;
  windKmh: number;
  gustKmh: number;
  /** Significant wave height, combined wind waves and swell, metres. */
  waveM: number;
  mslpHpa: number;
  /** Direction the wind comes FROM, degrees. */
  dirDeg: number;
}

export const FANI_FRAMES: FaniFrame[] = [
  { t: '2019-05-02T06:30:00+05:30', rain3h: 0.3, rain24h: 1.4, rainCumulative: 0.3, windKmh: 20.9, gustKmh: 31.9, waveM: 2.25, mslpHpa: 1004.9, dirDeg: 119.0 },
  { t: '2019-05-02T09:30:00+05:30', rain3h: 0.0, rain24h: 1.4, rainCumulative: 0.3, windKmh: 28.6, gustKmh: 38.7, waveM: 2.33, mslpHpa: 1006.3, dirDeg: 119.0 },
  { t: '2019-05-02T12:30:00+05:30', rain3h: 0.0, rain24h: 1.5, rainCumulative: 0.3, windKmh: 30.2, gustKmh: 48.3, waveM: 2.57, mslpHpa: 1005.1, dirDeg: 123.0 },
  { t: '2019-05-02T15:30:00+05:30', rain3h: 0.0, rain24h: 1.5, rainCumulative: 0.4, windKmh: 20.7, gustKmh: 51.1, waveM: 2.82, mslpHpa: 1003.5, dirDeg: 136.0 },
  { t: '2019-05-02T18:30:00+05:30', rain3h: 2.0, rain24h: 3.5, rainCumulative: 2.4, windKmh: 23.5, gustKmh: 44.9, waveM: 3.05, mslpHpa: 1003.3, dirDeg: 100.0 },
  { t: '2019-05-02T21:30:00+05:30', rain3h: 7.4, rain24h: 11.0, rainCumulative: 9.8, windKmh: 31.2, gustKmh: 57.7, waveM: 3.46, mslpHpa: 1004.5, dirDeg: 99.0 },
  { t: '2019-05-03T00:30:00+05:30', rain3h: 11.6, rain24h: 21.6, rainCumulative: 21.4, windKmh: 32.2, gustKmh: 51.2, waveM: 3.73, mslpHpa: 1002.5, dirDeg: 124.0 },
  { t: '2019-05-03T03:30:00+05:30', rain3h: 16.6, rain24h: 38.0, rainCumulative: 38.0, windKmh: 28.5, gustKmh: 47.1, waveM: 3.69, mslpHpa: 999.6, dirDeg: 117.0 },
  { t: '2019-05-03T06:30:00+05:30', rain3h: 35.7, rain24h: 73.4, rainCumulative: 73.7, windKmh: 44.8, gustKmh: 69.0, waveM: 4.28, mslpHpa: 1000.0, dirDeg: 139.0 },
  { t: '2019-05-03T09:30:00+05:30', rain3h: 11.0, rain24h: 84.4, rainCumulative: 84.7, windKmh: 55.7, gustKmh: 83.5, waveM: 5.49, mslpHpa: 999.5, dirDeg: 156.0 },
  { t: '2019-05-03T12:30:00+05:30', rain3h: 2.4, rain24h: 86.8, rainCumulative: 87.1, windKmh: 71.0, gustKmh: 111.7, waveM: 6.72, mslpHpa: 995.1, dirDeg: 164.0 },
  { t: '2019-05-03T15:30:00+05:30', rain3h: 1.1, rain24h: 87.8, rainCumulative: 88.2, windKmh: 68.1, gustKmh: 119.5, waveM: 7.36, mslpHpa: 991.7, dirDeg: 193.0 },
  { t: '2019-05-03T18:30:00+05:30', rain3h: 1.7, rain24h: 87.5, rainCumulative: 89.9, windKmh: 64.7, gustKmh: 107.5, waveM: 6.64, mslpHpa: 992.2, dirDeg: 226.0 },
];

/** State at the operating picture timestamp. */
export const FANI_AT_CLOCK = {
  windKmh: 23.5,
  gustKmh: 44.9,
  waveM: 3.05,
  mslpHpa: 1003.3,
  dirDeg: 100.0,
};

/** Peaks across the whole event, for the "what was coming" line. */
export const FANI_PEAK = {
  gustKmh: 119.6,
  waveM: 7.45,
  mslpHpa: 990.9,
  rainTotalMm: 94.9,
};
