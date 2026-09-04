"""
Assemble the Cyclone Fani operating picture for Kanhupur from real observations.

INPUT   $SCRATCH/imerg-kendrapara-fani.json   IMERG half-hourly, 1-4 May 2019
        data/era5/fani-era5.json              ERA5 hourly at 86.9381, 20.6284
OUTPUT  src/data/fani-kendrapara.ts

THE CLOCK IS A THRESHOLD CROSSING, NOT A ROUND NUMBER
-----------------------------------------------------
02 May 2019 18:30 IST is the first hour at which ERA5 significant wave height
reaches 3.05 m, crossing the 3.0 m INCOIS high-wave alert that this habitation's
feed is written against. Landfall was still about fourteen hours away. That is
the moment a decision console is for: the warning has fired, the evacuation
window is open, and the question of who moves is still live. Setting the clock
at landfall instead would make the console a record rather than a tool.

WHY WIND AND WAVE RATHER THAN RAIN
----------------------------------
Kanhupur is ~150 km up-coast from where Fani landed. IMERG puts 94.9 mm there
across four days, peaking at 27.5 mm/3h -- real, but not the hazard. The hazard
was wind and sea: gusts to 120 km/h and Hs to 7.45 m. The rainfall series is
carried because the panel renders it, but the triggers are where this event
actually shows up.

WHAT IS NOT HERE
----------------
Storm surge height. ERA5 does not model it and the INCOIS surge product is not
ingested, so the surge trigger stays on its published threshold with no observed
value rather than being back-filled from wave height, which is a different
quantity.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

IMERG = os.path.join(os.environ.get('SCRATCH', '.'), 'imerg-kendrapara-fani.json')
ERA5 = 'data/era5/fani-era5.json'
OUT = 'src/data/fani-kendrapara.ts'

CELL_LON, CELL_LAT = 86.95, 20.65
IST = timezone(timedelta(hours=5, minutes=30))

CLOCK = datetime(2019, 5, 2, 18, 30, tzinfo=IST)

# Frame ends, IST. Runs from the evening before landfall through the day after,
# so the panel shows the event arriving, peaking and passing.
FRAME_ENDS = [datetime(2019, 5, 2, 6, 30, tzinfo=IST) + timedelta(hours=3 * i)
              for i in range(13)]


def load_imerg():
    d = json.load(open(IMERG, encoding='utf-8'))
    lons, lats = d['lons'], d['lats']
    i = min(range(len(lons)), key=lambda k: abs(lons[k] - CELL_LON))
    j = min(range(len(lats)), key=lambda k: abs(lats[k] - CELL_LAT))
    half = {}
    for s in d['series']:
        t = (datetime.strptime(s['ymd'], '%Y%m%d').replace(tzinfo=timezone.utc)
             + timedelta(minutes=s['mins']))
        # IMERG precipitation is a RATE in mm/hr over 30 min; depth is rate / 2.
        half[t] = max(0.0, s['grid'][i][j]) / 2.0
    return half, lons[i], lats[j]


def load_era5():
    d = json.load(open(ERA5, encoding='utf-8'))
    out = {}
    for r in d['series']:
        t = datetime.strptime(r['t'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
        out[t] = r
    return out


def nearest(series, t):
    return series[min(series, key=lambda k: abs((k - t).total_seconds()))]


def main():
    for p in (IMERG, ERA5):
        if not os.path.exists(p):
            print(f'missing {p}')
            return 1
    half, clon, clat = load_imerg()
    era = load_era5()
    origin = FRAME_ENDS[0] - timedelta(hours=3)

    def depth(end, hours):
        start = end - timedelta(hours=hours)
        return sum(mm for t, mm in half.items() if start <= t < end)

    rows = []
    for e in FRAME_ENDS:
        w = nearest(era, e)
        rows.append({
            't': e.isoformat(),
            'rain3h': round(depth(e, 3), 1),
            'rain24h': round(depth(e, 24), 1),
            'rainCumulative': round(
                depth(e, (e - origin).total_seconds() / 3600), 1),
            'windKmh': w['windKmh'],
            'gustKmh': w['gustKmh'],
            'waveM': w['waveM'],
            'mslpHpa': w['mslpHpa'],
            'dirDeg': w['dirDeg'],
        })

    at = nearest(era, CLOCK)
    peakGust = max(era.values(), key=lambda r: r['gustKmh'])
    peakWave = max(era.values(), key=lambda r: r['waveM'])
    minMslp = min(era.values(), key=lambda r: r['mslpHpa'])

    print(f'IMERG cell {clon:.2f} E {clat:.2f} N')
    print(f'clock {CLOCK:%d %b %Y %H:%M} IST')
    print(f'  at clock: wind {at["windKmh"]} km/h gust {at["gustKmh"]} '
          f'dir {at["dirDeg"]:.0f} Hs {at["waveM"]} m mslp {at["mslpHpa"]} hPa')
    print(f'  peak gust {peakGust["gustKmh"]} km/h, peak Hs {peakWave["waveM"]} m, '
          f'min mslp {minMslp["mslpHpa"]} hPa')
    print(f'  rain over window {sum(half.values()):.1f} mm')

    def ts(r):
        return (f"  {{ t: '{r['t']}', rain3h: {r['rain3h']}, rain24h: {r['rain24h']}, "
                f"rainCumulative: {r['rainCumulative']}, windKmh: {r['windKmh']}, "
                f"gustKmh: {r['gustKmh']}, waveM: {r['waveM']}, "
                f"mslpHpa: {r['mslpHpa']}, dirDeg: {r['dirDeg']} }},")

    body = f'''/* ============================================================================
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
 * THE CLOCK. {CLOCK:%d %b %Y %H:%M} IST is the first hour at which significant
 * wave height reaches {at['waveM']} m, crossing the 3.0 m INCOIS high-wave alert this
 * habitation's feed is written against. Landfall near Puri was ~14 hours away.
 * The console is a decision tool, so it sits where the decision was.
 *
 * Regenerate: scripts/fetch-imerg.py, scripts/fetch-era5-event.py,
 * then scripts/build-fani.py
 * ==========================================================================*/

import type {{ Provenance }} from './schema';

export const FANI_CLOCK = '{CLOCK.isoformat()}';

/** Landfall near Puri, per IMD. Kanhupur is ~150 km up-coast. */
export const FANI_LANDFALL = '2019-05-03T08:00:00+05:30';

export const FANI_RAIN_PROVENANCE: Provenance = {{
  status: 'LIVE',
  source: 'GPM IMERG V07B Final Run, half-hourly (GPM_3IMERGHH)',
  agency: 'NASA GES DISC / JAXA',
  method:
    'Multi-satellite retrieval, gauge-calibrated at monthly scale. Half-hourly '
    + 'rates aggregated to 3-hourly accumulations over the 0.1 deg cell '
    + 'containing Kanhupur.',
  resolution: '0.1 deg (~11 km), 30 min',
  citation: 'GPM_3IMERGHH.07, doi:10.5067/GPM/IMERG/3B-HH/07',
  observedAt: '{CLOCK.isoformat()}',
}};

export const FANI_SEA_PROVENANCE: Provenance = {{
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
  observedAt: '{CLOCK.isoformat()}',
}};

export interface FaniFrame {{
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
}}

export const FANI_FRAMES: FaniFrame[] = [
{chr(10).join(ts(r) for r in rows)}
];

/** State at the operating picture timestamp. */
export const FANI_AT_CLOCK = {{
  windKmh: {at['windKmh']},
  gustKmh: {at['gustKmh']},
  waveM: {at['waveM']},
  mslpHpa: {at['mslpHpa']},
  dirDeg: {at['dirDeg']},
}};

/** Peaks across the whole event, for the "what was coming" line. */
export const FANI_PEAK = {{
  gustKmh: {peakGust['gustKmh']},
  waveM: {peakWave['waveM']},
  mslpHpa: {minMslp['mslpHpa']},
  rainTotalMm: {round(sum(half.values()), 1)},
}};
'''
    open(OUT, 'w', encoding='utf-8').write(body)
    print(f'\n  -> {OUT}  ({len(rows)} frames)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
