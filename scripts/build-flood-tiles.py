"""
Tile the Assam flood-frequency composite into an XYZ raster pyramid.

INPUT   flood_frequency_1999_2000_2004.tif
OUTPUT  public/flood-assam/{z}/{x}/{y}.png   z5..z10

WHY TILES RATHER THAN ONE GEOREFERENCED PNG
-------------------------------------------
The obvious approach is a single image draped on a MapLibre `image` source,
which is what the ECMWF forecast frames use. That was tried first and does not
work here: measured on clean page loads, the same data renders correctly at
119x127 and renders as an opaque black rectangle at 256 px and above. The
ECMWF frames are 119x127, which is why they were never affected and why the
fault looked like a data problem rather than a size one.

The mechanism was not pinned down -- the test environment is a software
renderer (ANGLE / Microsoft Basic Render Driver) reporting MAX_TEXTURE_SIZE
16384, so the limit is not the obvious one, and it may not reproduce on a
machine with a real GPU. Tiles are the correct answer either way: they give
proper level-of-detail, upload in small textures, and cannot fail silently on
someone else's laptop the night of a demo. A hazard layer that renders as a
black rectangle on unfamiliar hardware is worse than no layer.

RESOLUTION
----------
The source is ~600 m (1024 px over 6.3 degrees), which is native at about z8.
z9 and z10 upsample; nearest-neighbour keeps the class blocks crisp rather
than inventing intermediate frequencies that do not exist.

Every tile inside the raster's bounds is written even when fully transparent.
Skipping them would 404, and this application treats a raster tile error as a
basemap failure and says so on screen -- a true statement about the wrong
thing.
"""
import math
import os
import struct
import sys
import zlib

import numpy as np
import rasterio

SRC = 'flood_frequency_1999_2000_2004.tif'
OUT = 'public/flood-assam'
MIN_Z, MAX_Z = 5, 10
TILE = 256

# Same ramp and the same two corrections as scripts/build-assam-flood.py.
RAMP = {
    3: (18, 62, 96, 235),
    2: (37, 110, 152, 205),
    1: (109, 176, 208, 170),
    0: (0, 0, 0, 0),
}


def lon_of(z, x):
    return x / 2.0 ** z * 360.0 - 180.0


def lat_of(z, y):
    n = math.pi * (1.0 - 2.0 * y / 2.0 ** z)
    return math.degrees(math.atan(math.sinh(n)))


def write_png(path, rgba):
    h, w, _ = rgba.shape
    raw = b''.join(b'\x00' + rgba[i].tobytes() for i in range(h))

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = (b'\x89PNG\r\n\x1a\n'
           + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
           + chunk(b'IDAT', zlib.compress(raw, 9))
           + chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(png)


def main():
    if not os.path.exists(SRC):
        print(f'missing {SRC}')
        return 1

    with rasterio.open(SRC) as d:
        a = d.read(1)
        tr = d.transform
        b = d.bounds
    sh, sw = a.shape

    # The inversion and the ignored nodata, exactly as in build-assam-flood.py:
    # the stored value counts years NOT flooded, and nodata = 0 would delete the
    # channel. Established in scripts/probe-assam-raster.py.
    freq = 3 - np.clip(a.astype('int16'), 0, 3)

    lut = np.zeros((4, 4), dtype='uint8')
    for k, c in RAMP.items():
        lut[k] = c

    total = written = 0
    for z in range(MIN_Z, MAX_Z + 1):
        n = 2 ** z
        x0 = int((b.left + 180.0) / 360.0 * n)
        x1 = int((b.right + 180.0) / 360.0 * n)

        def ytile(lat):
            r = math.radians(lat)
            return int((1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * n)

        y0, y1 = ytile(b.top), ytile(b.bottom)
        zdir = os.path.join(OUT, str(z))
        count = 0
        for x in range(x0, x1 + 1):
            xdir = os.path.join(zdir, str(x))
            os.makedirs(xdir, exist_ok=True)
            # Longitude is linear in Mercator x, so tile columns map straight
            # onto source columns.
            lons = lon_of(z, x + (np.arange(TILE) + 0.5) / TILE)
            cols = np.clip(((lons - tr.c) / tr.a).astype(int), 0, sw - 1)
            inx = (lons >= b.left) & (lons <= b.right)
            for y in range(y0, y1 + 1):
                lats = np.array([lat_of(z, y + (i + 0.5) / TILE)
                                 for i in range(TILE)])
                rows = np.clip(((lats - tr.f) / tr.e).astype(int), 0, sh - 1)
                iny = (lats <= b.top) & (lats >= b.bottom)

                block = freq[np.ix_(rows, cols)]
                block[~iny, :] = 0
                block[:, ~inx] = 0
                write_png(os.path.join(xdir, f'{y}.png'), lut[block])
                count += 1
                written += 1
        total += count
        print(f'  z{z}: {count} tiles  (x {x0}-{x1}, y {y0}-{y1})')

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(OUT) for f in fs)
    print(f'\n  {written} tiles, {size / 1024 / 1024:.1f} MB -> {OUT}')
    print(f'  bounds {b.left}, {b.bottom}, {b.right}, {b.top}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
