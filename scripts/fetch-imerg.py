"""
Fetch GPM IMERG V07B half-hourly precipitation over Wayanad for the July 2024
event window, via OPeNDAP spatial subsetting.

Subsetting matters: the full global granules are ~1 GB for this window, the
9 x 7 cell subset is a few hundred kilobytes. We pull only the cells that
cover Wayanad district.

Requires an Earthdata bearer token in .earthdata_token and acceptance of the
NASA GESDISC DATA ARCHIVE EULA.

Output: scratch JSON with a per-timestep series for every cell in the window.
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

COLLECTION = 'C2723754847-GES_DISC'
BASE = f'https://opendap.earthdata.nasa.gov/collections/{COLLECTION}/granules/'

# IMERG V07 grid: 0.1 deg, lon origin -180, lat origin -90. Cell centres sit
# on the half-step, so index -> centre is idx*0.1 - 180 + 0.05.
def cell_index(lon, lat):
    return (int(round((lon + 180 - 0.05) / 0.1)),
            int(round((lat + 90 - 0.05) / 0.1)))


# Which area of interest to subset. Wayanad by default so the existing
# invocation is unchanged; --aoi selects another without editing indices,
# because hand-computed grid offsets are exactly the kind of constant that
# gets copied once and then quietly describes the wrong place.
AOIS = {
    'wayanad': (76.05, 11.75, 4, 3),      # lon, lat, half-width, half-height
    'kendrapara': (86.95, 20.65, 4, 3),
}

AOI = os.environ.get('IMERG_AOI', 'wayanad')
_lon, _lat, _hw, _hh = AOIS[AOI]
_ci, _cj = cell_index(_lon, _lat)
LON0, LON1 = _ci - _hw, _ci + _hw
LAT0, LAT1 = _cj - _hh, _cj + _hh
CE = (f'/Grid/precipitation[0][{LON0}:{LON1}][{LAT0}:{LAT1}];'
      f'/Grid/lon[{LON0}:{LON1}];/Grid/lat[{LAT0}:{LAT1}]')

TOKEN = open('.earthdata_token').read().strip()
# Which days to pull, as (yyyymmdd, day-of-year). Defaults to the Wayanad
# event so the existing invocation is unchanged; IMERG_DAYS overrides with a
# comma-separated list, e.g. 20190501:121,20190502:122.
_DEFAULT_DAYS = '20240728:210,20240729:211,20240730:212'
DAYS = [(d.split(':')[0], int(d.split(':')[1]))
        for d in os.environ.get('IMERG_DAYS', _DEFAULT_DAYS).split(',')]


def granule_names():
    """Half-hourly granule filenames for the window (48 per day)."""
    out = []
    for ymd, doy in DAYS:
        for i in range(48):
            mins = i * 30
            sh, sm = divmod(mins, 60)
            end = mins + 29
            eh, em = divmod(end, 60)
            name = (f'3B-HHR.MS.MRG.3IMERG.{ymd}-S{sh:02d}{sm:02d}00-'
                    f'E{eh:02d}{em:02d}59.{mins:04d}.V07B.HDF5')
            out.append((ymd, doy, mins, name))
    return out


def fetch(item):
    ymd, doy, mins, name = item
    gid = urllib.parse.quote(f'GPM_3IMERGHH.07:{name}', safe='')
    url = f'{BASE}{gid}.dap.csv?' + urllib.parse.urlencode({'dap4.ce': CE})
    req = urllib.request.Request(url, headers={'Authorization': f'Bearer {TOKEN}'})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return ymd, mins, r.read().decode('utf-8', 'replace')
        except Exception as exc:                       # noqa: BLE001
            if attempt == 2:
                print(f'  FAILED {name}: {exc}', file=sys.stderr)
                return ymd, mins, None
    return ymd, mins, None


def parse(text):
    """CSV -> (lons, lats, grid[lonIdx][latIdx]) in mm/hr."""
    lons, lats, rows = [], [], {}
    for line in text.splitlines():
        if line.startswith('/Grid/lat,'):
            lats = [float(v) for v in line.split(',')[1:]]
        elif line.startswith('/Grid/lon,'):
            lons = [float(v) for v in line.split(',')[1:]]
        else:
            m = re.match(r'/Grid/precipitation\[0\]\[(\d+)\],(.*)', line)
            if m:
                rows[int(m.group(1))] = [float(v) for v in m.group(2).split(',')]
    grid = [rows[i] for i in sorted(rows)]
    return lons, lats, grid


def main():
    items = granule_names()
    print(f'AOI {AOI}: centre {_lon}, {_lat}  grid [{LON0}:{LON1}][{LAT0}:{LAT1}]')
    print(f'fetching {len(items)} granules, subset {LON1 - LON0 + 1} x {LAT1 - LAT0 + 1} cells')
    series, lons, lats, failed = [], None, None, 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for n, (ymd, mins, text) in enumerate(pool.map(fetch, items), 1):
            if text is None:
                failed += 1
                continue
            lo, la, grid = parse(text)
            if lo:
                lons, lats = lo, la
            series.append({'ymd': ymd, 'mins': mins, 'grid': grid})
            if n % 24 == 0:
                print(f'  {n}/{len(items)}')
    series.sort(key=lambda s: (s['ymd'], s['mins']))
    out = {'lons': lons, 'lats': lats, 'series': series, 'failed': failed}
    dest = os.path.join(os.environ.get('SCRATCH', '.'), f'imerg-{AOI}.json')
    with open(dest, 'w') as f:
        json.dump(out, f)
    print(f'wrote {dest}: {len(series)} timesteps, {failed} failed')


if __name__ == '__main__':
    main()
