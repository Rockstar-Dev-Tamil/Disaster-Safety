"""
Build the Module 2 analysis surfaces for the Wayanad search area.

WHAT THIS PRODUCES
    A stack of co-registered 100 m rasters, each encoded as a grayscale PNG so
    the browser can decode them with a canvas and run the suitability overlay
    live. Precomputing the FACTOR surfaces but not the weighted combination is
    the important split: it means an officer can move the weights and see zones
    recompute, without shipping a backend.

    slope        mean slope, degrees          (uint8, value = degrees)
    landslide    KSDMA hazard class           (0 none, 1 low, 2 medium, 3 high)
    flood        KSDMA landform class         (0 none, 1 flood plain, 2 water)
    distroad     distance to nearest road     (uint8, value x 50 m, capped 12.7 km)
    disttown     distance to capable township (uint8, value x 200 m, capped 51 km)

WHY 100 m
    The hazard sheets are 1:50,000, so their boundaries are good to roughly
    50-100 m. Analysing finer than the source would manufacture precision that
    is not in the data.

Sources: Copernicus GLO-30 DEM (AWS open data, no auth), OpenStreetMap via
Overpass, and the KSDMA sheets already converted in public/layers.
"""
import json
import math
import os
import urllib.parse
import urllib.request

import numpy as np
import rasterio
from rasterio.windows import from_bounds

# Which area of interest to build. Wayanad by default so the existing
# invocation is unchanged; TERRAIN_AOI selects another.
#
# Each AOI is a search area plus a buffer, since candidate zones may lie in
# neighbouring districts. Hazard sheets differ in KIND, not just in path: the
# Kerala sheets are published polygon products, while Assam's flood layer is a
# scraped raster whose polarity had to be established empirically (see
# scripts/probe-assam-raster.py). Assam has no landslide sheet at all, and an
# absent sheet is left as zeros rather than substituted from elsewhere.
AOIS = {
    'wayanad': {
        'bounds': (75.55, 11.20, 76.65, 12.15),
        'dem': ['N11_00_E075', 'N11_00_E076', 'N12_00_E075', 'N12_00_E076'],
        'out': 'public/terrain',
        'landslide': ('geojson', 'public/layers/wayanad-landslide.geojson'),
        'flood': ('geojson', 'public/layers/wayanad-flood.geojson'),
    },
    # Majuli island and the districts immediately around it: Lakhimpur and
    # Dhemaji on the north bank, Jorhat and Sivasagar on the south. Deliberately
    # tighter than a 30 km operation radius would suggest -- the Brahmaputra
    # here is 10 km wide in places and the useful ground is the bank, not the
    # box, so widening mostly buys river and Overpass time.
    'majuli': {
        'bounds': (93.85, 26.60, 94.75, 27.40),
        'dem': ['N26_00_E093', 'N26_00_E094', 'N27_00_E093', 'N27_00_E094'],
        'out': 'public/terrain-assam',
        'landslide': None,
        'flood': ('raster', 'flood_frequency_1999_2000_2004.tif'),
    },
    # Kendrapara coast. Sized to hold a 30 km operation radius around Kanhupur
    # (86.9381, 20.6284) with margin, and matching the Overpass feasibility
    # probe that established this AOI has usable OSM coverage.
    'kendrapara': {
        'bounds': (86.55, 20.25, 87.35, 21.00),
        # N20_00_E087 is a zero-byte tile -- that square is all Bay of Bengal.
        # Listed anyway so the skip is explicit rather than an unexplained gap.
        'dem': ['N20_00_E086', 'N20_00_E087'],
        'out': 'public/terrain-kendrapara',
        # No landslide sheet on a delta, and the flood sheet here is the
        # Aqueduct coastal raster, written separately by
        # scripts/build-aqueduct-layers.py rather than from a polygon file.
        'landslide': None,
        'flood': None,
    },
}

AOI = os.environ.get('TERRAIN_AOI', 'wayanad')
_cfg = AOIS[AOI]
W, S, E, N = _cfg['bounds']
CELL_M = 100.0

DEM_TILES = _cfg['dem']
DEM_URL = ('https://copernicus-dem-30m.s3.amazonaws.com/'
           'Copernicus_DSM_COG_10_{t}_00_DEM/Copernicus_DSM_COG_10_{t}_00_DEM.tif')
# The public instance 504s on a query this size; mirrors are tried in turn and
# the bbox is split into tiles to keep each request small.
# Ordered by what actually responded when this was built. The main instance
# and kumi both 500/504 on a district-sized query; mail.ru's mirror serves it
# in ~30 s. Re-check if these go stale.
OVERPASS_MIRRORS = [
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]

SCRATCH = os.environ.get('SCRATCH', '.')
OUT = _cfg['out']
# Web path for the manifest's layer entries. These MUST point inside this
# AOI's own directory: an earlier version hardcoded '/terrain/...' for every
# AOI, so the Assam manifest carried Assam's bounds and Kerala's rasters, and
# the analysis that produced was complete, confident and about the wrong state.
WEB = '/' + OUT.split('public/', 1)[-1]


# ----------------------------------------------------------------- grid ----

def grid_shape():
    mid = math.radians((S + N) / 2)
    h = int(round((N - S) * 111320.0 / CELL_M))
    w = int(round((E - W) * 111320.0 * math.cos(mid) / CELL_M))
    return h, w


H, WIDTH = grid_shape()
LATS = np.linspace(N, S, H)          # row 0 = north
LONS = np.linspace(W, E, WIDTH)


# ------------------------------------------------------------------ png ----

def write_png_gray(path, arr):
    """8-bit grayscale PNG. Written by hand to avoid an image dependency."""
    import struct
    import zlib
    h, w = arr.shape
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 0, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return os.path.getsize(path)


# ------------------------------------------------------------------ dem ----

def fetch_dem():
    """Mosaic the Copernicus tiles covering the search area onto our grid."""
    elev = np.full((H, WIDTH), np.nan, dtype='float32')
    for t in DEM_TILES:
        path = os.path.join(SCRATCH, f'dem_{t}.tif')
        if not os.path.exists(path):
            url = DEM_URL.format(t=t)
            print(f'  downloading {t}', flush=True)
            try:
                urllib.request.urlretrieve(url, path)
            except Exception as exc:                       # noqa: BLE001
                print(f'    {t} unavailable ({exc}) - ocean tile, skipping')
                continue
        with rasterio.open(path) as src:
            b = src.bounds
            if b.right < W or b.left > E or b.top < S or b.bottom > N:
                continue
            win = from_bounds(max(W, b.left), max(S, b.bottom),
                              min(E, b.right), min(N, b.top), src.transform)
            data = src.read(1, window=win, masked=True)
            wt = src.window_transform(win)
            rows, cols = data.shape
            tlat = wt.f + (np.arange(rows) + 0.5) * wt.e
            tlon = wt.c + (np.arange(cols) + 0.5) * wt.a
            # nearest-neighbour resample onto our grid
            ri = np.clip(np.searchsorted(-tlat, -LATS), 0, rows - 1)
            ci = np.clip(np.searchsorted(tlon, LONS), 0, cols - 1)
            block = np.asarray(data.filled(np.nan))[np.ix_(ri, ci)]
            inside = (LATS[:, None] >= min(b.bottom, b.top)) & (LATS[:, None] <= max(b.bottom, b.top)) \
                & (LONS[None, :] >= b.left) & (LONS[None, :] <= b.right)
            elev = np.where(inside & np.isfinite(block), block, elev)
    return elev


def slope_deg(elev):
    """Horn slope on the 100 m grid, in degrees."""
    z = np.nan_to_num(elev, nan=0.0)
    dzdy, dzdx = np.gradient(z, CELL_M, CELL_M)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


# --------------------------------------------------------------- overpass --

def _post(query):
    last = None
    for mirror in OVERPASS_MIRRORS:
        for attempt in range(3):
            try:
                body = urllib.parse.urlencode({'data': query}).encode('utf-8')
                req = urllib.request.Request(
                    mirror, data=body,
                    headers={'User-Agent': 'sdma-redzone/0.1 (hackathon prototype)',
                             'Content-Type': 'application/x-www-form-urlencoded'})
                with urllib.request.urlopen(req, timeout=90) as r:
                    return json.loads(r.read().decode('utf-8'))
            except Exception as exc:                       # noqa: BLE001
                last = exc
                import time
                time.sleep(2)
        print(f'    {mirror.split("/")[2]} failed, next mirror')
    raise last


# Overpass is split into tiles because the public instances 504 on a
# district-sized query, and every tile costs a `pause` whether or not it was
# needed. The per-layer splits below were tuned against the Wayanad box, which
# is the largest AOI here; a smaller one can afford one fewer split, and on the
# heaviest layer that is 5 fewer pauses. Never below 2 -- a single
# district-sized request is what the tiling exists to avoid.
_AREA_DEG2 = (E - W) * (N - S)
_WAYANAD_DEG2 = 1.045


def tiles_for(base):
    """Per-layer tile split, relaxed for AOIs smaller than the Wayanad box."""
    return base if _AREA_DEG2 > 0.9 * _WAYANAD_DEG2 else max(2, base - 1)


def overpass_tiled(build_query, cache, nx=3, ny=3, pause=20):
    """Split the bbox into tiles, caching EACH tile separately.

    The public Overpass instances rate-limit and intermittently 500 on
    district-sized queries. Per-tile caching means a failed run resumes where
    it stopped instead of starting over, and a tile that never succeeds
    degrades coverage rather than losing everything.
    """
    import time
    merged = os.path.join(SCRATCH, cache)
    if os.path.exists(merged) and os.path.getsize(merged) > 200:
        with open(merged, encoding='utf-8') as f:
            return json.load(f)

    seen, elements, missing = set(), [], []
    stem = cache.replace('.json', '')
    for iy in range(ny):
        for ix in range(nx):
            n = iy * nx + ix + 1
            tile_path = os.path.join(SCRATCH, f'{stem}_t{n:02d}.json')
            if os.path.exists(tile_path) and os.path.getsize(tile_path) > 50:
                with open(tile_path, encoding='utf-8') as f:
                    data = json.load(f)
            else:
                s0 = S + (N - S) * iy / ny
                s1 = S + (N - S) * (iy + 1) / ny
                w0 = W + (E - W) * ix / nx
                w1 = W + (E - W) * (ix + 1) / nx
                bbox = f'{s0:.4f},{w0:.4f},{s1:.4f},{w1:.4f}'
                try:
                    data = _post(build_query(bbox))
                except Exception as exc:                     # noqa: BLE001
                    print(f'    tile {n}/{nx*ny} FAILED ({exc}) - continuing', flush=True)
                    missing.append(n)
                    continue
                with open(tile_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f)
                time.sleep(pause)                            # respect the mirror
            for el in data.get('elements', []):
                key = (el.get('type'), el.get('id'))
                if key not in seen:
                    seen.add(key)
                    elements.append(el)
            print(f'    tile {n}/{nx*ny}: {len(elements):,} cumulative', flush=True)

    out = {'elements': elements, 'missingTiles': missing}
    if not missing:
        with open(merged, 'w', encoding='utf-8') as f:
            json.dump(out, f)
    return out


BBOX = f'{S},{W},{N},{E}'


def fetch_roads():
    return overpass_tiled(
        # Only roads a relief vehicle can use. Residential and unclassified
        # lanes triple the payload and do not change a distance-to-road surface
        # that exists to answer "can a bus reach this".
        lambda bbox: ('[out:json][timeout:90];'
                      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]'
                      f'({bbox});out geom;'),
        'osm_roads.json', nx=tiles_for(2), ny=tiles_for(2))


# Land use classes, by priority -- higher wins where polygons overlap.
# Built-up must win: you cannot pitch a camp on somebody's house, and letting
# farmland overwrite residential would put candidate zones inside towns.
LU_CLASS = {
    'farmland': 3, 'orchard': 3, 'plantation': 3, 'meadow': 3, 'grass': 3,
    'greenfield': 3, 'village_green': 3, 'recreation_ground': 3,
    'forest': 4, 'wood': 4, 'scrub': 4, 'grassland': 3,
    'paddy': 2,
    'quarry': 5, 'cemetery': 5, 'religious': 5, 'landfill': 5, 'military': 5,
    'residential': 6, 'commercial': 6, 'industrial': 6, 'retail': 6,
    'farmyard': 6, 'construction': 6, 'school': 6,
}

LU_LABEL = {
    0: 'Unmapped', 2: 'Paddy', 3: 'Open cultivated or plantation',
    4: 'Forest or scrub', 5: 'Restricted use', 6: 'Built-up',
}


def fetch_landuse():
    return overpass_tiled(
        lambda bbox: ('[out:json][timeout:150];'
                      '(way["landuse"]' f'({bbox});'
                      ' way["natural"~"^(wood|scrub|grassland)$"]' f'({bbox});'
                      '); out geom;'),
        'osm_landuse.json', nx=tiles_for(3), ny=tiles_for(3), pause=15)


def rasterize_landuse(data):
    """Scanline fill of land-use polygons, highest class priority wins."""
    out = np.zeros((H, WIDTH), dtype='uint8')
    n = 0
    for el in data.get('elements', []):
        g = el.get('geometry') or []
        if len(g) < 4:
            continue
        t = el.get('tags', {})
        key = t.get('landuse') or t.get('natural')
        if t.get('crop') == 'rice' or t.get('produce') == 'rice':
            key = 'paddy'
        cls = LU_CLASS.get(key)
        if not cls:
            continue
        ring = [(p['lon'], p['lat']) for p in g]
        ys = [p[1] for p in ring]
        xs = [p[0] for p in ring]
        if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N:
            continue
        n += 1
        r0 = max(0, int((N - max(ys)) / (N - S) * (H - 1)))
        r1 = min(H - 1, int((N - min(ys)) / (N - S) * (H - 1)))
        for r in range(r0, r1 + 1):
            lat = LATS[r]
            xints = []
            for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                if (y1 > lat) != (y2 > lat):
                    xints.append(x1 + (lat - y1) / (y2 - y1) * (x2 - x1))
            xints.sort()
            for a, b in zip(xints[0::2], xints[1::2]):
                ca = max(0, int((a - W) / (E - W) * (WIDTH - 1)))
                cb = min(WIDTH - 1, int((b - W) / (E - W) * (WIDTH - 1)))
                if cb >= ca:
                    seg = out[r, ca:cb + 1]
                    np.maximum(seg, cls, out=seg)
    print(f'  {n:,} polygons burned')
    return out


def fetch_places():
    return overpass_tiled(
        lambda bbox: ('[out:json][timeout:180];'
                      '(node["place"~"^(city|town|village)$"]' f'({bbox});'
                      ' node["amenity"~"^(hospital|clinic|police|school)$"]' f'({bbox});'
                      '); out body;'),
        'osm_places.json', nx=tiles_for(2), ny=tiles_for(2))


# ---------------------------------------------------------- distance xform -

def chamfer(mask):
    """Two-pass chamfer distance transform, in cells. mask True = source."""
    big = 1e9
    d = np.where(mask, 0.0, big).astype('float32')
    h, w = d.shape
    d1, d2 = 1.0, math.sqrt(2.0)
    for y in range(1, h):
        row, prev = d[y], d[y - 1]
        row[1:] = np.minimum(row[1:], row[:-1] + d1)
        row[:] = np.minimum(row, prev + d1)
        row[1:] = np.minimum(row[1:], prev[:-1] + d2)
        row[:-1] = np.minimum(row[:-1], prev[1:] + d2)
    for y in range(h - 2, -1, -1):
        row, nxt = d[y], d[y + 1]
        row[-2::-1] = np.minimum(row[-2::-1], row[:0:-1] + d1)
        row[:] = np.minimum(row, nxt + d1)
        row[:-1] = np.minimum(row[:-1], nxt[1:] + d2)
        row[1:] = np.minimum(row[1:], nxt[:-1] + d2)
    return d


def rasterize_lines(ways):
    """Burn OSM way geometry into the grid by walking each segment."""
    mask = np.zeros((H, WIDTH), dtype=bool)
    for el in ways.get('elements', []):
        geom = el.get('geometry') or []
        for a, b in zip(geom, geom[1:]):
            n = max(2, int(max(abs(b['lat'] - a['lat']), abs(b['lon'] - a['lon'])) / 0.0005))
            for k in range(n + 1):
                la = a['lat'] + (b['lat'] - a['lat']) * k / n
                lo = a['lon'] + (b['lon'] - a['lon']) * k / n
                y = int((N - la) / (N - S) * (H - 1))
                x = int((lo - W) / (E - W) * (WIDTH - 1))
                if 0 <= y < H and 0 <= x < WIDTH:
                    mask[y, x] = True
    return mask


# -------------------------------------------------------------- polygons ---

def rasterize_polygons(path, class_of):
    """Scanline fill of the KSDMA sheets onto the grid."""
    gj = json.load(open(path, encoding='utf-8'))
    out = np.zeros((H, WIDTH), dtype='uint8')
    for ft in gj['features']:
        cls = class_of(ft['properties'])
        if not cls:
            continue
        geom = ft['geometry']
        polys = [geom['coordinates']] if geom['type'] == 'Polygon' else geom['coordinates']
        for poly in polys:
            for ring_i, ring in enumerate(poly):
                pass
            ring = poly[0]
            ys = [p[1] for p in ring]
            xs = [p[0] for p in ring]
            if max(xs) < W or min(xs) > E or max(ys) < S or min(ys) > N:
                continue
            r0 = max(0, int((N - max(ys)) / (N - S) * (H - 1)))
            r1 = min(H - 1, int((N - min(ys)) / (N - S) * (H - 1)))
            for r in range(r0, r1 + 1):
                lat = LATS[r]
                xints = []
                for (x1, y1), (x2, y2) in zip(ring, ring[1:]):
                    if (y1 > lat) != (y2 > lat):
                        xints.append(x1 + (lat - y1) / (y2 - y1) * (x2 - x1))
                xints.sort()
                for a, b in zip(xints[0::2], xints[1::2]):
                    ca = max(0, int((a - W) / (E - W) * (WIDTH - 1)))
                    cb = min(WIDTH - 1, int((b - W) / (E - W) * (WIDTH - 1)))
                    if cb >= ca:
                        seg = out[r, ca:cb + 1]
                        np.maximum(seg, cls, out=seg)
    return out


LS_CLASS = {'High Hazard Zone': 3, 'Medium Hazard Zone': 2, 'Low Hazard Zone': 1}
FL_CLASS = {'Flood plain': 1, 'Waterbody': 2}


def rasterize_flood_raster(path):
    """Sample the Assam flood-frequency composite onto the analysis grid.

    Two corrections, both established in scripts/probe-assam-raster.py and
    applied identically in scripts/build-assam-flood.py:

      * The stored value counts years NOT flooded -- median terrain elevation
        rises with it (59, 64, 74, 436 m). Frequency is 3 minus the value.
      * The file declares nodata = 0, which marks the MOST flooded class as
        missing. Honouring that would delete the active channel, so the
        declaration is ignored.

    Nearest-neighbour: the values are ordinal class counts, and interpolating
    between "flooded twice" and "flooded three times" would invent a class.
    """
    with rasterio.open(path) as src:
        a = src.read(1)
        tr = src.transform
        sh, sw = a.shape

    cols = np.clip(((LONS - tr.c) / tr.a).astype(int), 0, sw - 1)
    rows = np.clip(((LATS - tr.f) / tr.e).astype(int), 0, sh - 1)
    freq = 3 - np.clip(a[np.ix_(rows, cols)].astype('int16'), 0, 3)
    return freq.astype('uint8')


def hazard_sheet(spec, class_of):
    """One hazard sheet, whatever form it was published in."""
    if spec is None:
        return np.zeros((H, WIDTH), dtype='uint8')
    kind, path = spec
    if not os.path.exists(path):
        print(f'  {path} missing; layer left empty')
        return np.zeros((H, WIDTH), dtype='uint8')
    if kind == 'raster':
        return rasterize_flood_raster(path)
    return rasterize_polygons(path, class_of)


# ------------------------------------------------------------------ main ---

def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(SCRATCH, exist_ok=True)
    print(f'AOI {AOI} -> {OUT}')
    print(f'grid {WIDTH} x {H} at {CELL_M:.0f} m  ({W},{S}) - ({E},{N})')
    manifest = {
        'bounds': [W, S, E, N],
        'width': WIDTH, 'height': H, 'cellMetres': CELL_M,
        'layers': {},
    }

    print('DEM')
    elev = fetch_dem()
    valid = np.isfinite(elev)
    print(f'  coverage {valid.mean()*100:.1f}%  elev {np.nanmin(elev):.0f}-{np.nanmax(elev):.0f} m')
    sl = slope_deg(elev)
    b = write_png_gray(f'{OUT}/slope.png', np.clip(sl, 0, 90).astype('uint8'))
    manifest['layers']['slope'] = {'file': f'{WEB}/slope.png', 'unit': 'degrees',
                                   'scale': 1, 'bytes': b}
    b = write_png_gray(f'{OUT}/elevation.png',
                       np.clip(np.nan_to_num(elev) / 10.0, 0, 255).astype('uint8'))
    manifest['layers']['elevation'] = {'file': f'{WEB}/elevation.png', 'unit': 'metres',
                                       'scale': 10, 'bytes': b}
    print(f'  slope mean {sl[valid].mean():.1f} deg, max {sl[valid].max():.1f} deg')

    print('hazard sheets')
    ls = hazard_sheet(_cfg['landslide'], lambda p: LS_CLASS.get(p.get('class'), 0))
    fl = hazard_sheet(_cfg['flood'], lambda p: FL_CLASS.get(p.get('class'), 0))
    b = write_png_gray(f'{OUT}/landslide.png', ls * 80)
    manifest['layers']['landslide'] = {'file': f'{WEB}/landslide.png',
                                       'classes': LS_CLASS, 'scale': 80, 'bytes': b}
    b = write_png_gray(f'{OUT}/flood.png', fl * 80)
    manifest['layers']['flood'] = {'file': f'{WEB}/flood.png',
                                   'classes': FL_CLASS, 'scale': 80, 'bytes': b}
    print(f'  landslide cells {int((ls>0).sum()):,}  flood cells {int((fl>0).sum()):,}')

    print('OSM roads')
    try:
        roads = fetch_roads()
    except Exception as exc:                                 # noqa: BLE001
        print(f'  roads unavailable ({exc}); distroad layer omitted')
        roads = {'elements': []}
    rmask = rasterize_lines(roads)
    droad = chamfer(rmask) * CELL_M
    b = write_png_gray(f'{OUT}/distroad.png',
                       np.clip(droad / 50.0, 0, 255).astype('uint8'))
    manifest['layers']['distroad'] = {'file': f'{WEB}/distroad.png', 'unit': 'metres',
                                      'scale': 50, 'bytes': b}
    print(f'  {len(roads.get("elements", [])):,} ways, {int(rmask.sum()):,} road cells')

    print('OSM places')
    try:
        places = fetch_places()
    except Exception as exc:                                 # noqa: BLE001
        print(f'  places unavailable ({exc}); using empty set')
        places = {'elements': []}
    towns, facilities = [], []
    for el in places.get('elements', []):
        t = el.get('tags', {})
        rec = {'name': t.get('name'), 'lat': el.get('lat'), 'lon': el.get('lon')}
        if t.get('place') in ('city', 'town', 'village'):
            rec['place'] = t['place']
            rec['population'] = int(t['population']) if str(t.get('population', '')).isdigit() else None
            towns.append(rec)
        elif t.get('amenity'):
            rec['amenity'] = t['amenity']
            facilities.append(rec)
    print(f'  {len(towns)} settlements, {len(facilities)} facilities')

    tmask = np.zeros((H, WIDTH), dtype=bool)
    for t in towns:
        if t['place'] in ('city', 'town') and t['lat'] and t['lon']:
            y = int((N - t['lat']) / (N - S) * (H - 1))
            x = int((t['lon'] - W) / (E - W) * (WIDTH - 1))
            if 0 <= y < H and 0 <= x < WIDTH:
                tmask[y, x] = True
    dtown = chamfer(tmask) * CELL_M
    b = write_png_gray(f'{OUT}/disttown.png',
                       np.clip(dtown / 200.0, 0, 255).astype('uint8'))
    manifest['layers']['disttown'] = {'file': f'{WEB}/disttown.png', 'unit': 'metres',
                                      'scale': 200, 'bytes': b}

    print('OSM land use')
    try:
        lu = rasterize_landuse(fetch_landuse())
    except Exception as exc:                                 # noqa: BLE001
        print(f'  land use unavailable ({exc}); layer omitted')
        lu = np.zeros((H, WIDTH), dtype='uint8')
    b = write_png_gray(f'{OUT}/landuse.png', lu * 40)
    manifest['layers']['landuse'] = {'file': f'{WEB}/landuse.png',
                                     'classes': LU_LABEL, 'scale': 40, 'bytes': b}
    for k, v in LU_LABEL.items():
        cnt = int((lu == k).sum())
        if cnt:
            print(f'    {v:32} {cnt:>9,} cells')

    manifest['towns'] = towns
    manifest['facilities'] = facilities
    with open(f'{OUT}/manifest.json', 'w', encoding='utf-8') as f:
        json.dump(manifest, f, indent=1)

    total = sum(l['bytes'] for l in manifest['layers'].values())
    for k, v in manifest['layers'].items():
        print(f'  {k:12} {v["bytes"]/1024:7.0f} KB')
    print(f'total raster payload {total/1024:.0f} KB')


if __name__ == '__main__':
    main()
