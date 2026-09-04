"""
Turn the Aqueduct minimum-return-period rasters into console layers.

INPUT   data/aqueduct/*-minrp.tif            (scripts/fetch-aqueduct.py)
OUTPUT  public/terrain-assam/floodrp.png     class x 80, as landslide.png
        public/terrain-assam/manifest.json   layer entry "floodrp"
        public/floodrp-assam/{z}/{x}/{y}.png map overlay, regional
        public/floodrp-kendrapara/{z}/{x}/{y}.png

THE CLASS BREAKS
----------------
Not chosen for visual balance. Both are recognised planning thresholds:

    High        first inundated at a return period of 10 years or less --
                floods at least once a decade, which is not a place to put
                anybody for any length of time.
    Moderate    11 to 100 years. The 1-in-100 flood is the standard design
                return period in Indian and international practice, so this
                band is precisely "inside the design flood".
    Low         101 to 1000 years.
    Negligible  dry at every return period the model carries. Note this is a
                statement ABOUT the model, not about the world: Aqueduct does
                not represent embankment breaches, and a bund failure puts
                water where a 1-in-1000 map shows none.

A SEPARATE LAYER KEY, NOT A REPLACEMENT FOR `flood`
---------------------------------------------------
`flood.png` means "observed inundation extent" in every stack -- KSDMA landform
classes for Wayanad, the three-year composite for Assam -- and the siting rules
read it as such. Writing return-period classes into the same key would leave two
AOIs whose identical pixel values mean different things, which is exactly the
kind of silent divergence that produces a confident wrong answer. `floodrp` is
its own key with its own rule.
"""
import json
import math
import os
import struct
import sys
import zlib

import numpy as np
import rasterio

SRC_DIR = 'data/aqueduct'
SCALE = 80
NO_FLOOD = 9999

CLASS_LABEL = {3: 'High', 2: 'Moderate', 1: 'Low', 0: 'Negligible'}

#: Upper bound of each class, in years of return period.
BREAKS = [(10, 3), (100, 2), (1000, 1)]

#: Sequential, monotonic in lightness. Deliberately NOT the pale tone that was
#: pulled from the HAND ramp for obscuring the basemap while reading as noise.
RAMP = {
    3 * SCALE: (26, 63, 102, 235),
    2 * SCALE: (47, 112, 153, 200),
    1 * SCALE: (0, 0, 0, 0),        # in the data, not painted
    0: (0, 0, 0, 0),
}

# The Majuli analysis grid, from build-terrain.py's majuli entry.
ASSAM_AOI = (93.85, 26.60, 94.75, 27.40)
ASSAM_STACK = 'public/terrain-assam'
CELL_M = 100.0

TILESETS = [
    ('assam-region', 'public/floodrp-assam', (89.7, 24.1, 96.0, 28.2), 5, 10),
    ('kendrapara', 'public/floodrp-kendrapara', (86.55, 20.25, 87.35, 21.00), 6, 11),
]


def classify(minrp):
    """min return period -> 0..3, largest-first so the smallest RP wins."""
    out = np.zeros(minrp.shape, dtype='uint8')
    for upper, cls in sorted(BREAKS, key=lambda t: -t[0]):
        out[(minrp <= upper) & (minrp > 0)] = cls
    return out


def read_minrp(name):
    p = os.path.join(SRC_DIR, f'{name}-minrp.tif')
    if not os.path.exists(p):
        print(f'missing {p} -- run scripts/fetch-aqueduct.py --fetch')
        sys.exit(1)
    with rasterio.open(p) as d:
        a = d.read(1).astype('int32')
        return a, d.transform, d.bounds


def sample_to_grid(a, tr, lats, lons):
    sh, sw = a.shape
    rows = np.clip(((lats - tr.f) / tr.e).astype(int), 0, sh - 1)
    cols = np.clip(((lons - tr.c) / tr.a).astype(int), 0, sw - 1)
    return a[np.ix_(rows, cols)]


def write_png_gray(path, arr):
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


def build_stack_raster():
    w, s, e, n = ASSAM_AOI
    mid = math.radians((s + n) / 2)
    h = int(round((n - s) * 111320.0 / CELL_M))
    wd = int(round((e - w) * 111320.0 * math.cos(mid) / CELL_M))
    lats = np.linspace(n, s, h)
    lons = np.linspace(w, e, wd)

    a, tr, _ = read_minrp('assam')
    minrp = sample_to_grid(a, tr, lats, lons)
    cls = classify(minrp)

    print(f'\nAssam stack raster  {wd} x {h} at {CELL_M:.0f} m')
    print(f'  {"class":<12}{"cells":>10}{"share":>9}   first inundated at')
    for k in (3, 2, 1, 0):
        cnt = int((cls == k).sum())
        rng = {3: 'RP <= 10 yr', 2: 'RP 11-100 yr',
               1: 'RP 101-1000 yr', 0: 'dry at every RP'}[k]
        print(f'  {CLASS_LABEL[k]:<12}{cnt:>10,}{cnt / cls.size * 100:>8.1f}%   {rng}')

    b = write_png_gray(f'{ASSAM_STACK}/floodrp.png', cls * SCALE)
    mp = f'{ASSAM_STACK}/manifest.json'
    m = json.load(open(mp, encoding='utf-8'))
    m['layers']['floodrp'] = {
        'file': '/terrain-assam/floodrp.png',
        'classes': {v: k for k, v in CLASS_LABEL.items()},
        'scale': SCALE,
        'bytes': b,
        'source': 'WRI Aqueduct Flood Hazard Maps V2, inunriver, historical',
        'measure': 'smallest return period at which the cell is inundated',
        'breaksYears': {'high': 10, 'moderate': 100, 'low': 1000},
        'nativeResolution': '30 arcsec (~900 m), resampled to the 100 m grid',
    }
    json.dump(m, open(mp, 'w', encoding='utf-8'), indent=1)
    print(f'  -> {ASSAM_STACK}/floodrp.png ({b / 1024:.0f} kB), manifest updated')


def write_png_rgba(path, rgba):
    h, w, _ = rgba.shape
    raw = b''.join(b'\x00' + rgba[i].tobytes() for i in range(h))

    def chunk(tag, data):
        return (struct.pack('>I', len(data)) + tag + data
                + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)
    return os.path.getsize(path)


def build_tiles(name, out, box, min_z, max_z):
    a, tr, _ = read_minrp(name)
    w, s, e, n = box
    written = 0
    print(f'\n{name} tiles -> {out}  z{min_z}-{max_z}')
    for z in range(min_z, max_z + 1):
        nt = 2 ** z
        x0, x1 = int((w + 180) / 360 * nt), int((e + 180) / 360 * nt)

        def ytile(lat):
            r = math.radians(lat)
            return int((1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * nt)

        y0, y1 = ytile(n), ytile(s)
        for x in range(x0, x1 + 1):
            xd = os.path.join(out, str(z), str(x))
            os.makedirs(xd, exist_ok=True)
            lons = (x + (np.arange(256) + 0.5) / 256) / nt * 360.0 - 180.0
            inx = (lons >= w) & (lons <= e)
            for y in range(y0, y1 + 1):
                lats = np.array([
                    math.degrees(math.atan(math.sinh(
                        math.pi * (1.0 - 2.0 * (y + (i + 0.5) / 256) / nt))))
                    for i in range(256)])
                iny = (lats <= n) & (lats >= s)
                block = classify(sample_to_grid(a, tr, lats, lons)) * SCALE
                block[~iny, :] = 0
                block[:, ~inx] = 0
                rgba = np.zeros(block.shape + (4,), dtype='uint8')
                for v, colour in RAMP.items():
                    rgba[block == v] = colour
                write_png_rgba(os.path.join(xd, f'{y}.png'), rgba)
                written += 1
        print(f'  z{z}: x {x0}-{x1}, y {y0}-{y1}')
    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(out) for f in fs)
    print(f'  {written} tiles, {size / 1024 / 1024:.1f} MB')


def main():
    build_stack_raster()
    for args in TILESETS:
        build_tiles(*args)
    return 0


if __name__ == '__main__':
    sys.exit(main())
