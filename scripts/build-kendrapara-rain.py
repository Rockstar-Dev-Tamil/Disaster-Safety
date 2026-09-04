"""
Reduce the Kendrapara IMERG subset to the 3-hourly frames the nowcast panel
renders.

INPUT   $SCRATCH/imerg-kendrapara.json   (scripts/fetch-imerg.py, IMERG_AOI=kendrapara)
OUTPUT  src/data/rainfall-kendrapara.ts

WHAT THIS DOES NOT DO
---------------------
No return levels. The Wayanad cell has them because a rainfall threshold is
what fires a landslide advisory there, so a 24 h accumulation has to be
compared against that cell's own distribution. Kendrapara's triggers are
surge, tide and embankment breach; rainfall is context, not a trigger. Fitting
a Gumbel here would produce a number nothing reads, and implying a rainfall
threshold governs a coastal-erosion case would misdescribe the model.

The alert states are NOT derived from these numbers and are left where they
were authored. They are coastal alert states driven by surge and tide; a
rainfall figure cannot set them, and deriving them from rain would silently
convert this into a pluvial case.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

SRC = os.path.join(os.environ.get('SCRATCH', '.'), 'imerg-kendrapara.json')
OUT = 'src/data/rainfall-kendrapara.ts'

# The habitation's own cell. Kanhupur is at 86.9381, 20.6284.
CELL_LON, CELL_LAT = 86.95, 20.65

IST = timezone(timedelta(hours=5, minutes=30))

# Frame ends, in IST, matching the operating picture and the seven frames the
# panel already renders.
FRAME_ENDS_IST = [
    '2024-07-29T05:30', '2024-07-29T08:30', '2024-07-29T11:30',
    '2024-07-29T14:30', '2024-07-29T17:30', '2024-07-29T20:30',
    '2024-07-29T23:30',
]


def main():
    if not os.path.exists(SRC):
        print(f'missing {SRC}\n'
              f'run: IMERG_AOI=kendrapara SCRATCH=<dir> python scripts/fetch-imerg.py')
        return 1

    d = json.load(open(SRC))
    lons, lats = d['lons'], d['lats']
    i = min(range(len(lons)), key=lambda k: abs(lons[k] - CELL_LON))
    j = min(range(len(lats)), key=lambda k: abs(lats[k] - CELL_LAT))
    print(f'cell {lons[i]:.2f} E, {lats[j]:.2f} N  '
          f'({len(d["series"])} half-hourly steps)')

    # (utc instant at window start) -> mm in that half hour.
    # IMERG precipitation is a RATE in mm/hr over a 30 min window, so the depth
    # is rate / 2. Treating the rate as a depth would double every figure.
    half = {}
    for s in d['series']:
        t = datetime.strptime(s['ymd'], '%Y%m%d').replace(tzinfo=timezone.utc) \
            + timedelta(minutes=s['mins'])
        v = s['grid'][i][j]
        half[t] = max(0.0, v) / 2.0

    def depth(end, hours):
        start = end - timedelta(hours=hours)
        return sum(mm for t, mm in half.items() if start <= t < end)

    ends = [datetime.fromisoformat(t).replace(tzinfo=IST) for t in FRAME_ENDS_IST]
    origin = ends[0] - timedelta(hours=3)

    rows = []
    for e in ends:
        rows.append({
            't': e.isoformat(),
            'rain3h': round(depth(e, 3), 1),
            'rain24h': round(depth(e, 24), 1),
            'rainCumulative': round(
                depth(e, (e - origin).total_seconds() / 3600), 1),
        })
        print(f"  {rows[-1]['t']}  3h {rows[-1]['rain3h']:6.1f}  "
              f"24h {rows[-1]['rain24h']:6.1f}  cum {rows[-1]['rainCumulative']:6.1f}")

    body = f'''/* ============================================================================
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

import type {{ Provenance }} from './schema';

export const KDP_RAINFALL_CELL = {{
  lon: {lons[i]:.2f},
  lat: {lats[j]:.2f},
  sizeDeg: 0.1,
  approxKm: 11,
}};

export const KDP_RAINFALL_PROVENANCE: Provenance = {{
  status: 'LIVE',
  source: 'GPM IMERG V07B Final Run, half-hourly (GPM_3IMERGHH)',
  agency: 'NASA GES DISC / JAXA',
  method:
    'Multi-satellite retrieval, gauge-calibrated at monthly scale. Half-hourly '
    + 'rates aggregated to 3-hourly accumulations over one 0.1 deg cell '
    + 'containing Kanhupur.',
  resolution: '0.1 deg (~11 km), 30 min',
  citation: 'GPM_3IMERGHH.07, doi:10.5067/GPM/IMERG/3B-HH/07',
  observedAt: '{rows[-1]["t"]}',
}};

export interface KdpRainFrame {{
  t: string;
  rain3h: number;
  rain24h: number;
  rainCumulative: number;
}}

export const KDP_RAIN_FRAMES: KdpRainFrame[] = [
'''
    for r in rows:
        body += (f"  {{ t: '{r['t']}', rain3h: {r['rain3h']}, "
                 f"rain24h: {r['rain24h']}, rainCumulative: {r['rainCumulative']} }},\n")
    body += '];\n'

    open(OUT, 'w', encoding='utf-8').write(body)
    print(f'\n  -> {OUT}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
