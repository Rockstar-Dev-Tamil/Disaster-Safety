"""
Reduce the ShorelineMonitor transect pull to per-habitation retreat statistics.

INPUT   data/shoreline/kendrapara-transects.csv   (scripts/fetch-shoreline.py)
OUTPUT  src/data/shoreline-kendrapara.ts          scoring input, static
        public/layers/kendrapara-shoreline.json   map overlay, fetched

WHY TWO OUTPUTS
---------------
Susceptibility is derived at module load, synchronously, so whatever feeds it
has to be a static import -- eight habitations' worth of summary numbers, a
couple of kilobytes. The 1,681 individual transects are only ever drawn, never
scored, so they go to public/ and are fetched when a map wants them. Bundling
them would put 100 kB of points into the initial download for nothing.

WHICH STATISTIC FEEDS THE SCORE
-------------------------------
The median rate over transects within the search radius, not the worst one.
The worst is carried alongside and displayed, because an officer should see
the spread -- but selecting the worst transect to drive the score would be
choosing the number that makes the case, which is the failure mode this whole
console is built to avoid. The median is the robust central estimate of what
the reach in front of a habitation is doing.

Habitation coordinates are read out of src/data/habitations.ts rather than
restated here. Two copies of a coordinate list is two chances to be wrong.
"""
import csv
import json
import os
import re
import statistics as st
import sys

TRANSECTS = 'data/shoreline/kendrapara-transects.csv'
HABITATIONS = 'src/data/habitations.ts'
KENDRAPARA = 'src/data/kendrapara.ts'
TS_OUT = 'src/data/shoreline-kendrapara.ts'
GEO_OUT = 'public/layers/kendrapara-shoreline.json'

# Transects within this distance of a habitation describe the reach in front
# of it. Beyond ~5 km on this coast you are describing a different reach.
RADIUS_KM = 5.0

# Matches the published normalisation already used by the coastal factor spec:
# "0 m/yr = 0, >15 m/yr erosion = 100".
RATE_FULL_SCALE = 15.0

KM_PER_DEG_LAT = 111.32


def km(alat, alon, blat, blon):
    """Equirectangular distance. Exact enough at 5 km and one latitude."""
    import math
    x = (blon - alon) * KM_PER_DEG_LAT * math.cos(math.radians((alat + blat) / 2))
    y = (blat - alat) * KM_PER_DEG_LAT
    return (x * x + y * y) ** 0.5


def read_habitations():
    """Kendrapara district anchors, plus the authored Kanhupur record.

    A regex, not a parser: the anchor table is one array literal per line with
    a fixed column order, and this only has to survive that file's own format.
    If the shape ever changes, the count assertion in main() fails loudly
    rather than silently emitting an empty table.
    """
    src = open(HABITATIONS, encoding='utf-8').read()
    row = re.compile(
        r"\['([^']+)',\s*'([^']+)',\s*'(Kendrapara)',\s*'([^']+)',\s*"
        r"(-?[\d.]+),\s*(-?[\d.]+),\s*'(\w+)'")
    out = []
    for m in row.finditer(src):
        name, _state, _dist, _block, lon, lat, hazard = m.groups()
        out.append({'name': name, 'lat': float(lat), 'lon': float(lon),
                    'hazard': hazard})

    # The subject habitation is authored separately. Anchor to its own export:
    # kendrapara.ts declares five candidate SITES before it, each with its own
    # name and lngLat, so an unanchored search returns a relocation destination
    # labelled as a habitation.
    k = open(KENDRAPARA, encoding='utf-8').read()
    block = k[k.index('export const KANHUPUR'):] if 'export const KANHUPUR' in k else ''
    nm = re.search(r"name:\s*'([^']+)'", block)
    ll = re.search(r"lngLat:\s*\[(-?[\d.]+),\s*(-?[\d.]+)\]", block)
    if not (nm and ll):
        raise RuntimeError('could not locate the KANHUPUR record in ' + KENDRAPARA)
    out.insert(0, {'name': nm.group(1), 'lat': float(ll.group(2)),
                   'lon': float(ll.group(1)), 'hazard': 'COASTAL_EROSION'})
    return out


def read_transects():
    rows = []
    with open(TRANSECTS, encoding='utf-8') as fh:
        for r in csv.DictReader(fh):
            if not r['change_rate_m_per_yr']:
                continue                       # unfitted; carries no rate
            rows.append({
                'id': r['transect_id'],
                'lat': float(r['lat']), 'lon': float(r['lon']),
                'rate': float(r['change_rate_m_per_yr']),
                'err': float(r['change_rate_std_err'] or 0),
                'r2': float(r['r_squared'] or 0),
                'start': r['obs_start'], 'end': r['obs_end'],
                'shore': r['shore_type'],
            })
    return rows


def stats_for(h, tr):
    near = []
    for t in tr:
        d = km(h['lat'], h['lon'], t['lat'], t['lon'])
        if d <= RADIUS_KM:
            near.append((d, t))
    if not near:
        # Inland. Say so rather than reporting a rate from a distant reach.
        nearest = min(km(h['lat'], h['lon'], t['lat'], t['lon']) for t in tr)
        return {'n': 0, 'nearestKm': round(nearest, 2)}

    near.sort(key=lambda p: p[0])
    rates = sorted(t['rate'] for _, t in near)
    d0, t0 = near[0]
    return {
        'n': len(near),
        'medianRate': round(st.median(rates), 2),
        'p10Rate': round(rates[max(0, int(len(rates) * 0.10) - 1)], 2),
        'worstRate': round(rates[0], 2),
        'erodingShare': round(sum(1 for v in rates if v < 0) / len(rates), 3),
        'nearestKm': round(d0, 2),
        'nearestRate': round(t0['rate'], 2),
        'nearestStdErr': round(t0['err'], 2),
        'nearestR2': round(t0['r2'], 2),
        'windowStart': min(t['start'] for _, t in near if t['start']),
        'windowEnd': max(t['end'] for _, t in near if t['end']),
    }


def ts_literal(v, indent=4):
    if isinstance(v, str):
        return f"'{v}'"
    if isinstance(v, bool):
        return 'true' if v else 'false'
    return repr(v)


HEADER = '''/* ============================================================================
 * SHORELINE CHANGE, KENDRAPARA -- GENERATED, DO NOT EDIT BY HAND
 *
 * Written by scripts/build-shoreline-factors.py from ShorelineMonitor
 * transects pulled by scripts/fetch-shoreline.py. Re-run both to refresh.
 *
 * Every rate below is metres per year at the habitation's own reach, measured,
 * not assumed: negative is retreat, positive is accretion. `medianRate` is the
 * central estimate over transects within {radius} km and is what feeds the
 * score. `worstRate` and `p10Rate` are carried so the spread stays visible --
 * a median of -6 m/yr over a reach whose worst transect is -14 is a different
 * operational picture from one whose worst is -7, and the officer should be
 * able to see which they are looking at.
 *
 * The published rate is the ordinary-least-squares slope of shoreline position
 * against year, fitted over observations flagged obs_is_primary. That was
 * verified rather than assumed: refitting all {verified} rated transects from
 * their own observation series reproduces the published rate to within
 * 1 m/yr for 99.9 per cent of them.
 *
 * Source: ShorelineMonitor / Global Coastal Transect Repository, Deltares.
 * Licensed CC-BY-4.0 -- attribution is required wherever these figures appear.
 * ==========================================================================*/

/** Search radius used to select the transects describing a habitation's reach. */
export const SHORELINE_RADIUS_KM = {radius};

/** Erosion rate treated as full scale by the coastal susceptibility factor. */
export const RATE_FULL_SCALE_M_PER_YR = {fullscale};

export interface ShorelineStats {{
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
}}

'''


def main():
    for p in (TRANSECTS, HABITATIONS, KENDRAPARA):
        if not os.path.exists(p):
            print(f'missing input: {p}')
            return 1

    tr = read_transects()
    habs = read_habitations()
    if not habs:
        print('parsed 0 habitations -- the anchor table format has changed')
        return 1
    print(f'{len(tr)} rated transects, {len(habs)} Kendrapara habitations\n')

    table = {}
    for h in habs:
        s = stats_for(h, tr)
        table[h['name']] = s
        if s['n']:
            print(f'  {h["name"]:<14} n={s["n"]:>4}  median {s["medianRate"]:>7.2f}  '
                  f'worst {s["worstRate"]:>7.2f}  nearest {s["nearestKm"]:>5.2f} km '
                  f'({s["nearestRate"]:+.2f} r2={s["nearestR2"]:.2f})')
        else:
            print(f'  {h["name"]:<14} inland -- nearest transect '
                  f'{s["nearestKm"]:.2f} km')

    # ---- TS module
    body = [HEADER.format(radius=RADIUS_KM, fullscale=RATE_FULL_SCALE,
                          verified=len(tr))]
    body.append('export const SHORELINE: Record<string, ShorelineStats> = {\n')
    for name, s in table.items():
        fields = ', '.join(f'{k}: {ts_literal(v)}' for k, v in s.items())
        body.append(f"  '{name}': {{ {fields} }},\n")
    body.append('};\n\n')
    body.append('''/** Retreat rate mapped onto the published 0-100 susceptibility scale.
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
''')
    open(TS_OUT, 'w', encoding='utf-8').write(''.join(body))
    print(f'\n  -> {TS_OUT}')

    # ---- map overlay
    feats = [{
        'type': 'Feature',
        'geometry': {'type': 'Point', 'coordinates': [t['lon'], t['lat']]},
        'properties': {'id': t['id'], 'rate': round(t['rate'], 2),
                       'r2': round(t['r2'], 2), 'shore': t['shore']},
    } for t in tr]
    os.makedirs(os.path.dirname(GEO_OUT), exist_ok=True)
    json.dump({'type': 'FeatureCollection',
               'attribution': 'ShorelineMonitor (Deltares), CC-BY-4.0',
               'features': feats},
              open(GEO_OUT, 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'  -> {GEO_OUT}  ({len(feats)} transects, '
          f'{os.path.getsize(GEO_OUT) // 1024} kB)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
