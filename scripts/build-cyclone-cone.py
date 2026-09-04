"""
Forecast cones of uncertainty for a cyclone, issued hour by hour.

    python scripts/build-cyclone-cone.py --event fani

OUTPUT  public/layers/cone-<event>.geojson       one cone per issue time
        data/cyclone/<event>-cone-verify.txt     did the storm stay inside?

THE RULE THIS OBEYS
-------------------
A cone issued at time T uses ONLY information available at T: where the storm
is, and how it has been moving over the preceding 12 hours. It never uses a
position after T. Centring a cone on the track that actually happened would put
the truth dead centre every time, which is not how any forecast behaves and
would make the cone look far better than it is.

Positions after T are used once, afterwards, to ask whether the storm stayed
inside the cone that was issued. That is a result, not an input, and it is
written to the verification file whether it flatters the method or not.

HOW THE CONE IS BUILT
---------------------
Centre line: persistence. Current position, extrapolated along the mean motion
vector of the previous 12 h. This is the crudest honest forecast there is -- it
assumes the storm keeps doing what it has been doing, and it is exactly what
fails when a storm recurves.

Radius:  r(lead) = 20 + 11.5 * lead_hours  km
         12 h -> 158 km,  24 h -> 296 km,  48 h -> 572 km

CALIBRATED TO MEASURED ERROR, not borrowed. The first version used IMD's
published operational track errors (30 + 2.8*lead, 97 km at 24 h) and verified
at 24% -- because those errors belong to dynamical models that anticipate
recurvature, and persistence does not. Measured on this event:

    lead   hit%   median err   old radius
     3h     94%      20 km        38 km
     6h     76%      39 km        47 km
    12h     24%      83 km        64 km
    24h     18%     195 km        97 km
    48h      8%     409 km       164 km

The radii above track the 90th percentile of that measured error, so the cone
is as wide as the method's uncertainty actually is. It is far wider than a real
IMD cone, and that is the correct consequence of forecasting by extrapolation
rather than a defect to be tuned away: a cone narrower than your uncertainty is
not a cone, it is a guess with a border drawn round it.

Fitted to ONE storm over 17 issue times, so treat the numbers as indicative of
persistence on a recurving Bay of Bengal cyclone, not as a general law.

WHY THIS IS THE EXCLUSION
-------------------------
Evacuation cannot move people into ground the storm may still cross. The cone is
the set of places it may still cross, so the whole cone is excluded for the
short-term tier -- not the track, which nobody knows yet. It is NOT excluded for
the long-term tier: by the time a township is built the storm is long gone, and
what matters there is flooding and erosion, not this particular cyclone.
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone

TRACK_DIR = 'data/era5'
OUT_DIR = 'public/layers'
VERIFY_DIR = 'data/cyclone'

#: Hours of past motion averaged into the extrapolation vector. Short enough to
#: follow a turn, long enough not to chase the 0.25 degree quantisation of the
#: centre fixes.
MOTION_WINDOW_H = 12

#: Forecast leads a cone covers, hours. Drawn to 48 h; the EXCLUSION uses only
#: the first 24, because that is the horizon an evacuation decision operates on
#: and because beyond it the honest radius exceeds the whole search area, which
#: is a true statement but not a usable one.
LEADS = list(range(3, 49, 3))

#: Exclusion hulls are emitted at several horizons, not one. An evacuation that
#: must hold for six hours and one that must hold for a day are different
#: questions, and at persistence-scale uncertainty they have very different
#: answers: the cone radius is 89 km at 6 h and 296 km at 24 h, so the 24 h cone
#: can swallow an entire 100 km search area while the 6 h cone leaves usable
#: ground. Letting the officer choose the horizon is the honest way to present
#: that, rather than picking one and calling it the answer.
EXCLUSION_LEADS_H = [6, 12, 24]

#: Cone radius growth. See the docstring for where the shape comes from.
R0_KM = 20.0
R_PER_HOUR = 11.5

#: Land polygons, for deciding when a forecast position has gone inland.
LAND = 'public/geo/india-districts.json'

#: Over-land decay of the EXCLUSION radius.
#:
#: The positional cone does not shrink over land -- track uncertainty is track
#: uncertainty wherever the storm is. What shrinks is the hazard: a cyclone
#: separated from its ocean heat source weakens fast, and Fani went from 973 hPa
#: offshore to 1003 hPa a day inland. So the DISPLAY cone keeps the full radius
#: and the EXCLUSION cone decays, because the question the exclusion answers is
#: not "where might the storm be" but "where might it still hurt people".
#:
#: This is climatology, not hindsight: that cyclones decay inland is known to a
#: forecaster at issue time. It is still crude -- real decay depends on terrain,
#: storm size and moisture, none of which are read here -- so it is a scrappy
#: proxy with a stated shape rather than a model.
#:
#:     factor = max(FLOOR, exp(-hours_inland / TAU))
DECAY_TAU_H = 12.0
DECAY_FLOOR = 0.35

EVENTS = {
    'fani': {
        'label': 'Cyclone Fani',
        # Issue cones every 3 h across the approach. The operating picture sits
        # at 2 May 13:00Z; the rest exist so the officer can step.
        'issue_from': '2019-05-01 12:00',
        'issue_to': '2019-05-03 12:00',
        'operating': '2019-05-02 13:00',
    },
}


def load_land():
    """Outer rings of the district polygons, with bounding boxes to prefilter."""
    import json as _json
    gj = _json.load(open(LAND, encoding='utf-8'))
    rings = []
    for f in gj['features']:
        g = f.get('geometry') or {}
        polys = ([g['coordinates']] if g.get('type') == 'Polygon'
                 else g.get('coordinates') or [])
        for poly in polys:
            if not poly:
                continue
            ring = poly[0]
            xs = [c[0] for c in ring]
            ys = [c[1] for c in ring]
            rings.append((min(xs), min(ys), max(xs), max(ys), ring))
    return rings


def on_land(lon, lat, rings):
    for x0, y0, x1, y1, ring in rings:
        if lon < x0 or lon > x1 or lat < y0 or lat > y1:
            continue
        inside = False
        for i in range(len(ring) - 1):
            ax, ay = ring[i]
            bx, by = ring[i + 1]
            if (ay > lat) != (by > lat):
                xin = ax + (lat - ay) / (by - ay) * (bx - ax)
                if lon < xin:
                    inside = not inside
        if inside:
            return True
    return False


def kmxy(lon, lat, lon0, lat0):
    """Local km offsets from a reference point."""
    return ((lon - lon0) * 111.32 * math.cos(math.radians((lat + lat0) / 2)),
            (lat - lat0) * 111.32)


def offset(lon, lat, dx_km, dy_km):
    lat2 = lat + dy_km / 111.32
    lon2 = lon + dx_km / (111.32 * math.cos(math.radians((lat + lat2) / 2)))
    return lon2, lat2


def circle(lon, lat, r_km, n=48):
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        pts.append(list(offset(lon, lat, r_km * math.sin(a), r_km * math.cos(a))))
    return pts


def convex_hull(points):
    """Andrew's monotone chain. The cone is drawn as the hull of the circles
    around each forecast position, which is what a published cone looks like --
    a swept envelope, not a string of beads."""
    pts = sorted(set(map(tuple, points)))
    if len(pts) <= 2:
        return list(map(list, pts))

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    upper = []
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return [list(p) for p in lower[:-1] + upper[:-1]] + [list(lower[0])]


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--event', default='fani', choices=sorted(EVENTS))
    a = ap.parse_args()
    cfg = EVENTS[a.event]

    tp = os.path.join(TRACK_DIR, f'{a.event}-track.json')
    if not os.path.exists(tp):
        print(f'missing {tp} -- run scripts/fetch-storm-track.py first')
        return 1
    rings = load_land()
    print(f'  {len(rings)} land rings for the inland-decay test')
    raw = json.load(open(tp, encoding='utf-8'))['track']
    track = {}
    for r in raw:
        t = datetime.strptime(r['t'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
        track[t] = r
    times = sorted(track)

    t_from = datetime.strptime(cfg['issue_from'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
    t_to = datetime.strptime(cfg['issue_to'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)
    t_op = datetime.strptime(cfg['operating'], '%Y-%m-%d %H:%M').replace(tzinfo=timezone.utc)

    # The operating picture need not fall on the issue grid: the case clock is
    # 13:00Z and cones are issued every 3 h from 12:00Z. Snap to the nearest
    # issue, otherwise nothing is ever flagged and the workspace opens on the
    # first cone of the sequence instead of the one being decided against.
    issues = [t for t in sorted(track)
              if t_from <= t <= t_to
              and (t - t_from).total_seconds() % 10800 == 0]
    t_op_snapped = min(issues, key=lambda t: abs((t - t_op).total_seconds()))
    print(f'  operating picture {t_op:%Y-%m-%d %H:%M}Z -> '
          f'nearest issue {t_op_snapped:%Y-%m-%d %H:%M}Z')

    feats = []
    efeats = []
    verify = []
    issue = t_from
    while issue <= t_to:
        if issue not in track:
            issue += timedelta(hours=3)
            continue
        now = track[issue]
        past = track.get(issue - timedelta(hours=MOTION_WINDOW_H))
        if not past:
            issue += timedelta(hours=3)
            continue

        # Motion vector from the PAST WINDOW ONLY. Nothing after `issue` is read.
        dx, dy = kmxy(now['lon'], now['lat'], past['lon'], past['lat'])
        vx, vy = dx / MOTION_WINDOW_H, dy / MOTION_WINDOW_H

        pts = []
        positions = []
        for lead in LEADS:
            clon, clat = offset(now['lon'], now['lat'], vx * lead, vy * lead)
            r = R0_KM + R_PER_HOUR * lead
            positions.append({'lead': lead, 'lon': round(clon, 3),
                              'lat': round(clat, 3), 'radiusKm': round(r, 1)})
            pts.extend(circle(clon, clat, r, 32))
        pts.extend(circle(now['lon'], now['lat'], R0_KM, 32))
        hull = convex_hull(pts)

        # A second, tighter hull for the EXCLUSION. Beyond 24 h the honest
        # radius exceeds the whole search area, so a 48 h exclusion would
        # remove every candidate and say nothing. 24 h is also the horizon an
        # evacuation actually runs on.
        # Hours the extrapolated track has spent inland by each lead, so the
        # exclusion radius can decay after the forecast crosses the coast.
        inland_h = {}
        first_land = None
        for lead in LEADS:
            clon, clat = offset(now['lon'], now['lat'], vx * lead, vy * lead)
            if on_land(clon, clat, rings):
                if first_land is None:
                    first_land = lead
                inland_h[lead] = lead - first_land
            else:
                inland_h[lead] = 0.0

        ehulls = {}
        edecay = {}
        for maxlead in EXCLUSION_LEADS_H:
            epts = []
            worst = 1.0
            for lead in LEADS:
                if lead > maxlead:
                    continue
                clon, clat = offset(now['lon'], now['lat'], vx * lead, vy * lead)
                decay = max(DECAY_FLOOR,
                            math.exp(-inland_h[lead] / DECAY_TAU_H))
                worst = min(worst, decay)
                epts.extend(circle(clon, clat,
                                   (R0_KM + R_PER_HOUR * lead) * decay, 32))
            epts.extend(circle(now['lon'], now['lat'], R0_KM, 32))
            ehulls[maxlead] = convex_hull(epts)
            edecay[maxlead] = round(worst, 2)

        # ---- verification, using positions AFTER the issue time. Result only.
        inside = 0
        checked = 0
        worst = None
        for lead in LEADS:
            actual = track.get(issue + timedelta(hours=lead))
            if not actual:
                continue
            fc = next(p for p in positions if p['lead'] == lead)
            ex, ey = kmxy(actual['lon'], actual['lat'], fc['lon'], fc['lat'])
            err = math.hypot(ex, ey)
            checked += 1
            if err <= fc['radiusKm']:
                inside += 1
            if worst is None or err > worst[1]:
                worst = (lead, err, fc['radiusKm'])
        verify.append((issue, checked, inside, worst))

        feats.append({
            'type': 'Feature',
            'geometry': {'type': 'Polygon', 'coordinates': [hull]},
            'properties': {
                'kind': 'display',
                'issued': issue.strftime('%Y-%m-%dT%H:%M:00Z'),
                'issuedIst': (issue + timedelta(hours=5, minutes=30))
                             .strftime('%Y-%m-%dT%H:%M:00+05:30'),
                'operating': issue == t_op_snapped,
                'centreLon': now['lon'], 'centreLat': now['lat'],
                'mslpHpa': now['mslpHpa'],
                'speedKmh': round(math.hypot(vx, vy), 1),
                'headingDeg': round(math.degrees(math.atan2(vx, vy)) % 360, 0),
                'leadsH': [p['lead'] for p in positions],
                'maxRadiusKm': positions[-1]['radiusKm'],
            },
        })
        for maxlead, ehull in ehulls.items():
            efeats.append({
                'type': 'Feature',
                'geometry': {'type': 'Polygon', 'coordinates': [ehull]},
                'properties': {
                    'kind': 'exclusion',
                    'issued': issue.strftime('%Y-%m-%dT%H:%M:00Z'),
                    'issuedIst': (issue + timedelta(hours=5, minutes=30))
                                 .strftime('%Y-%m-%dT%H:%M:00+05:30'),
                    'operating': issue == t_op_snapped,
                    'maxLeadH': maxlead,
                    'radiusKm': round((R0_KM + R_PER_HOUR * maxlead)
                                      * edecay[maxlead], 0),
                    'radiusUndecayedKm': round(R0_KM + R_PER_HOUR * maxlead, 0),
                    'inlandDecay': edecay[maxlead],
                },
            })
        issue += timedelta(hours=3)

    os.makedirs(OUT_DIR, exist_ok=True)
    dest = os.path.join(OUT_DIR, f'cone-{a.event}.geojson')
    json.dump({'type': 'FeatureCollection', 'event': cfg['label'],
               'note': 'Persistence-extrapolated cones. Each uses only data up '
                       'to its own issue time.',
               'features': feats},
              open(dest, 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'{cfg["label"]}: {len(feats)} cones -> {dest} '
          f'({os.path.getsize(dest) / 1024:.0f} kB)')
    edest = os.path.join(OUT_DIR, f'cone-{a.event}-exclusion.geojson')
    json.dump({'type': 'FeatureCollection', 'event': cfg['label'],
               'note': 'Cones truncated at each of several leads, for siting '
                       'exclusion. Pick the horizon the evacuation must hold for.',
               'leadsH': EXCLUSION_LEADS_H,
               'features': efeats},
              open(edest, 'w', encoding='utf-8'), separators=(',', ':'))
    print(f'  {len(efeats)} exclusion hulls -> {edest} '
          f'({os.path.getsize(edest) / 1024:.0f} kB)')

    os.makedirs(VERIFY_DIR, exist_ok=True)
    vp = os.path.join(VERIFY_DIR, f'{a.event}-cone-verify.txt')
    lines = ['issued (UTC)        leads  inside  worst lead  err km  radius km',
             '-' * 68]
    tot_c = tot_i = 0
    for issue, checked, inside, worst in verify:
        tot_c += checked
        tot_i += inside
        w = (f'{worst[0]:>6}h {worst[1]:>8.0f} {worst[2]:>10.0f}'
             if worst else '           -')
        lines.append(f'{issue:%Y-%m-%d %H:%M}   {checked:>5}  {inside:>6}  {w}')
    rate = tot_i / tot_c * 100 if tot_c else 0
    lines += ['', f'forecast positions inside their cone: {tot_i}/{tot_c} '
                  f'({rate:.0f}%)']
    open(vp, 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))
    print(f'\n  -> {vp}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
