"""
How much of the search area does each cone actually remove?

    python scripts/cone-coverage-report.py

Answers one question directly: is the cyclone cone wiping out every candidate at
every time step, or only at some? Asserting either way from a couple of
screenshots is not an answer; this measures all of them.

For each issue time and each evacuation horizon, reports the share of the search
disc around Kanhupur that falls inside the cone. 100% means no short-term siting
is possible at that moment for that horizon -- which is a legitimate finding, not
a bug, but it should be legitimate at some moments and not all of them.
"""
import json
import math
import os
import sys

CONES = 'public/layers/cone-fani-exclusion.geojson'
ORIGIN = (86.9381, 20.6284)          # Kanhupur
RADII_KM = [30, 60, 100]
SAMPLES = 120                         # points per ring, 24 rings -> ~2,900 tests


def point_in_ring(lon, lat, ring):
    inside = False
    n = len(ring)
    for i in range(n - 1):
        x1, y1 = ring[i]
        x2, y2 = ring[i + 1]
        if (y1 > lat) != (y2 > lat):
            xin = x1 + (lat - y1) / (y2 - y1) * (x2 - x1)
            if lon < xin:
                inside = not inside
    return inside


def disc_points(r_km):
    """Even-ish sample of the search disc, by area."""
    pts = []
    rings = 24
    for i in range(1, rings + 1):
        # sqrt spacing keeps samples area-uniform rather than centre-heavy
        r = r_km * math.sqrt(i / rings)
        k = max(6, int(SAMPLES * i / rings))
        for j in range(k):
            a = 2 * math.pi * j / k
            lat = ORIGIN[1] + (r * math.cos(a)) / 111.32
            lon = ORIGIN[0] + (r * math.sin(a)) / (
                111.32 * math.cos(math.radians(ORIGIN[1])))
            pts.append((lon, lat))
    return pts


def main():
    if not os.path.exists(CONES):
        print(f'missing {CONES} -- run scripts/build-cyclone-cone.py')
        return 1
    gj = json.load(open(CONES, encoding='utf-8'))
    feats = gj['features']
    leads = sorted({f['properties']['maxLeadH'] for f in feats})
    issues = sorted({f['properties']['issued'] for f in feats})
    discs = {r: disc_points(r) for r in RADII_KM}

    print(f'{len(issues)} issue times x {len(leads)} horizons, '
          f'search discs at {RADII_KM} km\n')
    print('share of the search disc INSIDE the cone (100% = nothing sitable)\n')
    hdr = f'{"issued (IST)":<20}'
    for r in RADII_KM:
        for L in leads:
            hdr += f'{str(r)+"km/"+str(L)+"h":>10}'
    print(hdr)
    print('-' * len(hdr))

    clear = {(r, L): 0 for r in RADII_KM for L in leads}
    for iss in issues:
        row = None
        line = ''
        for r in RADII_KM:
            for L in leads:
                f = next((x for x in feats
                          if x['properties']['issued'] == iss
                          and x['properties']['maxLeadH'] == L), None)
                if not f:
                    line += f'{"-":>10}'
                    continue
                ring = f['geometry']['coordinates'][0]
                pts = discs[r]
                n = sum(1 for lon, lat in pts if point_in_ring(lon, lat, ring))
                pct = n / len(pts) * 100
                if pct < 99.5:
                    clear[(r, L)] += 1
                line += f'{pct:>9.0f}%'
                row = f['properties'].get('issuedIst', iss)
        star = ' *' if any(x['properties']['issued'] == iss
                           and x['properties'].get('operating') for x in feats) else ''
        print(f'{(row or iss)[:16].replace("T", " "):<18}{star:<2}{line}')

    print('\nissue times leaving SOME ground outside the cone, of '
          f'{len(issues)}:')
    for r in RADII_KM:
        for L in leads:
            print(f'  {r:>3} km radius, {L:>2} h horizon: {clear[(r, L)]:>2}'
                  f' / {len(issues)}')
    print('\n* = the operating picture')
    return 0


if __name__ == '__main__':
    sys.exit(main())
