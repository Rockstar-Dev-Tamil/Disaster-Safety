"""
Fetch ShorelineMonitor coastal change data for an area of interest, via the
GeoServer WFS behind shorelinemonitor.deltares.nl.

WHY WFS AND NOT THE WPS
-----------------------
The public viewer exposes a per-profile WPS call that returns a rendered Plotly
HTML page, one profile at a time. Scraping that would mean ~1,700 POSTs plus
~1,700 HTML fetches for the Kendrapara coast alone, against someone else's
production service, and would leave us regex-parsing a presentation format that
can change without notice.

The same GeoServer publishes the underlying layers over WFS. Two bbox queries
return the same numbers as typed attributes. That is ~20 requests instead of
~3,400, and no parsing of anything meant for a browser.

WHAT IS PULLED
--------------
  gctr                     one fitted linear trend per transect
  shorelinemonitor_series  the per-observation shoreline positions behind it

Both are written whole. The series is not filtered on obs_is_primary or
obs_is_outlier here -- those flags travel with the rows so the decision stays
downstream and visible, rather than being silently applied at ingest.

AXIS ORDER
----------
WFS 2.0.0 reads a bare BBOX as lat/lon. Tagging the CRS explicitly makes it
lon/lat. Getting this wrong does not error -- it silently returns zero features,
which reads exactly like "this coast has no data". The control check in main()
exists because that failure already happened once during development.

Licence: ShorelineMonitor / Global Coastal Transect Repository, Deltares,
CC-BY-4.0. Any figure derived from this needs that attribution.

Output: CSVs under data/shoreline/.
"""
import argparse
import csv
import os
import re
import sys
import time

import requests

BASE = 'https://shoreline-monitor.openearth.eu/geoserver/ows'
UA = {'User-Agent': 'sdma-redzone/0.1 (student disaster-management prototype)'}

# Deliberately unhurried. This is a live production service run by someone else,
# not a bulk endpoint, and the whole job is only a few dozen requests.
DELAY = 0.5
PAGE = 5000
TIMEOUT = 180
RETRIES = 3

OUT = 'data/shoreline'

# Kendrapara, Odisha. Sized to hold a 30 km operation radius around Kanhupur
# (86.9381 E, 20.6284 N) -- same box as the Overpass feasibility probe.
AOIS = {
    'kendrapara': (86.55, 20.25, 87.35, 21.00),
}


def bbox_cql(w, s, e, n):
    """CRS tagged explicitly, so the argument order is lon/lat as written."""
    return f"BBOX(geometry,{w},{s},{e},{n},'EPSG:4326')"


def wfs(params, expect_json=True):
    """One WFS call, with the courtesy delay and a bounded retry."""
    p = {'service': 'WFS', 'version': '2.0.0', 'request': 'GetFeature'}
    p.update(params)
    if expect_json:
        p.setdefault('outputFormat', 'application/json')

    last = None
    for attempt in range(RETRIES):
        time.sleep(DELAY * (1 + attempt * 4))     # back off, never hammer
        try:
            r = requests.get(BASE, params=p, headers=UA, timeout=TIMEOUT)
        except Exception as exc:                             # noqa: BLE001
            last = f'{type(exc).__name__}: {exc}'
            continue
        if r.status_code == 200:
            return r
        last = f'HTTP {r.status_code}: {r.text[:200]}'
    raise RuntimeError(f'WFS failed after {RETRIES} tries -- {last}')


def hits(layer, cql):
    """Count without shipping features. GeoServer answers this cheaply."""
    r = wfs({'typeNames': f'shoreline-monitor:{layer}', 'resultType': 'hits',
             'CQL_FILTER': cql}, expect_json=False)
    m = re.search(r'numberMatched="(\d+)"', r.text)
    if not m:
        raise RuntimeError(f'no numberMatched in hits response for {layer}')
    return int(m.group(1))


def pages(layer, cql, sort_by, total):
    """Yield features page by page.

    sortBy is not cosmetic: startIndex paging is only stable against a
    deterministic order, and without it GeoServer may repeat or skip rows
    between pages.
    """
    got = 0
    while got < total:
        r = wfs({'typeNames': f'shoreline-monitor:{layer}', 'CQL_FILTER': cql,
                 'sortBy': sort_by, 'count': str(PAGE), 'startIndex': str(got)})
        feats = r.json().get('features', [])
        if not feats:
            break
        got += len(feats)
        print(f'    {got:>7} / {total}', end='\r', flush=True)
        yield from feats
    print(f'    {got:>7} / {total}   ')
    if got != total:
        print(f'    NOTE: expected {total}, received {got}')


def cell(v):
    """Render one value the way a CSV reader on the other side expects.

    Python's str() would write True/False and the literal string "None", both
    of which read back as ordinary text in pandas, JS and Excel alike -- a
    missing rate would silently become the four-character word None rather
    than a null. Lowercase the booleans, blank the nulls.
    """
    if v is None:
        return ''
    if isinstance(v, bool):
        return 'true' if v else 'false'
    # Upstream leaks a Python str(None) into the classification fields for a
    # small number of unclassified transects -- 31 of 1,705 over Kendrapara.
    # Left alone it becomes a legitimate-looking shore-type category called
    # "None" in every downstream group-by. It means unclassified; write it as
    # such. Real JSON nulls arrive as None above and are already blank.
    if v == 'None':
        return ''
    return v


def origin(geom):
    """Landward end of a transect, or the point itself for an observation.

    The series observations sit on the transect line, so taking the first
    vertex keeps the two tables joinable on position as well as on id.
    """
    c = geom['coordinates']
    lon, lat = c[0] if geom['type'] == 'LineString' else c
    return round(lat, 6), round(lon, 6)


def fetch_transects(cql, path):
    total = hits('gctr', cql)
    print(f'  gctr: {total} transects')
    cols = ['transect_id', 'gctr_id', 'lat', 'lon', 'change_rate_m_per_yr',
            'change_rate_std_err', 'r_squared', 'obs_start', 'obs_end',
            'shore_type', 'coastal_type', 'sandy']
    rated = 0
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for f in pages('gctr', cql, 'transect_id', total):
            p = f['properties']
            lat, lon = origin(f['geometry'])
            # Feature ids come through as "gctr.9098233"; the numeric part is
            # the same profileid the viewer's WPS call takes.
            fid = f.get('id', '').rsplit('.', 1)[-1]
            if p.get('sds_change_rate') is not None:
                rated += 1
            w.writerow([cell(v) for v in (
                p['transect_id'], fid, lat, lon,
                p.get('sds_change_rate'), p.get('sds_change_rate_std_err'),
                p.get('sds_r_squared'),
                (p.get('sds_start_datetime') or '')[:10],
                (p.get('sds_end_datetime') or '')[:10],
                p.get('class_shore_type'), p.get('class_coastal_type'),
                p.get('sandy'),
            )])
    print(f'  -> {path}   ({rated}/{total} carry a fitted rate)')
    return total


def fetch_series(cql, path):
    total = hits('shorelinemonitor_series', cql)
    print(f'  series: {total} observations')
    cols = ['transect_id', 'gctr_id', 'lat', 'lon', 'date',
            'shoreline_position', 'chainage', 'is_primary', 'is_outlier']
    with open(path, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh)
        w.writerow(cols)
        for f in pages('shorelinemonitor_series', cql, 'obs_id', total):
            p = f['properties']
            lat, lon = origin(f['geometry'])
            w.writerow([cell(v) for v in (
                p['transect_id'], p.get('gctr_id'), lat, lon,
                (p.get('datetime') or '')[:10],
                p.get('shoreline_position'), p.get('chainage'),
                p.get('obs_is_primary'), p.get('obs_is_outlier'),
            )])
    print(f'  -> {path}')
    return total


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--aoi', default='kendrapara',
                    help=f'named AOI ({", ".join(AOIS)}) or W,S,E,N')
    ap.add_argument('--skip-series', action='store_true',
                    help='transects only; skips the large observation pull')
    ap.add_argument('--dry-run', action='store_true',
                    help='report counts and exit without writing')
    a = ap.parse_args()

    if a.aoi in AOIS:
        name, box = a.aoi, AOIS[a.aoi]
    else:
        name, box = 'custom', tuple(float(v) for v in a.aoi.split(','))
        if len(box) != 4:
            ap.error('--aoi needs a name or four numbers W,S,E,N')

    w, s, e, n = box
    cql = bbox_cql(w, s, e, n)
    print(f'AOI {name}  {w},{s} -> {e},{n}\n')

    # Control. A wrong axis order returns zero rather than failing, so prove
    # the filter selects something before trusting any count built on it.
    probe = hits('gctr', cql)
    if probe == 0:
        print('  Filter matched 0 transects. Either the AOI is not coastal, or\n'
              '  the axis order is wrong. Check bbox_cql() before believing this.')
        return 1
    print(f'  control: filter selects {probe} transects\n')

    if a.dry_run:
        print(f'  series would be {hits("shorelinemonitor_series", cql)} rows')
        return 0

    os.makedirs(OUT, exist_ok=True)
    t = fetch_transects(cql, f'{OUT}/{name}-transects.csv')
    if not a.skip_series:
        print()
        fetch_series(cql, f'{OUT}/{name}-series.csv')

    print(f'\n  {t} transects written. Source: ShorelineMonitor (Deltares),\n'
          f'  CC-BY-4.0 -- attribution required wherever these figures appear.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
