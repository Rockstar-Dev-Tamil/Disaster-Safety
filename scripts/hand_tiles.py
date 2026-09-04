"""
XYZ tile pyramid for the HAND susceptibility raster.

Separate module rather than part of build-hand.py so the PNG writer's escape
sequences live in a file written directly, not spliced in.

Tiles rather than one draped image, for the reason recorded in
scripts/build-flood-tiles.py: a single MapLibre image source was measured
rendering as an opaque black rectangle above ~128 px in this build's test
environment, while rendering correctly at 119x127.
"""
import math
import os
import struct
import zlib

import numpy as np

OUT = 'public/hand-assam'
MIN_Z, MAX_Z = 7, 12
TILE = 256


def ramp_for(scale, undetermined):
    """Class value -> RGBA.

    Sequential and monotonic in lightness across the three risk classes.
    `undetermined` sits deliberately OUTSIDE that ramp as a neutral grey, so it
    reads as absence of information rather than as the low end of a scale --
    those cells are not low risk, they are unresolved, and on this AOI they
    flood MORE often than the resolved ones.
    """
    return {
        3 * scale: (26, 63, 102, 235),      # High
        2 * scale: (47, 112, 153, 200),     # Moderate
        # Low is NOT DRAWN. The pale blue that used to sit here covered 6.4% of
        # the AOI and was opaque enough to obscure the basemap under it while
        # being too faint to read as a class -- the worst of both. It remains a
        # class in hand.png and the siting rules still test it; only the map
        # stops painting it.
        1 * scale: (0, 0, 0, 0),            # Low -- in the data, off the map
        0: (0, 0, 0, 0),                    # Negligible -- draw nothing
        undetermined: (120, 120, 128, 130),  # not resolved
    }


def _write_png(path, rgba):
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


def write_tiles(cls, w, s, e, n, scale, undetermined):
    """Tile a class raster covering [w, s, e, n] into OUT.

    Every tile inside the bounds is written even when fully transparent:
    a missing raster tile is reported by this application as a basemap
    failure, which would be a true statement about the wrong thing.
    """
    ramp = ramp_for(scale, undetermined)
    h_px, w_px = cls.shape
    print(f'\n  tiling {OUT}  z{MIN_Z}-{MAX_Z}')
    written = 0

    for z in range(MIN_Z, MAX_Z + 1):
        nt = 2 ** z
        x0 = int((w + 180.0) / 360.0 * nt)
        x1 = int((e + 180.0) / 360.0 * nt)

        def ytile(lat):
            r = math.radians(lat)
            return int((1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * nt)

        y0, y1 = ytile(n), ytile(s)
        for x in range(x0, x1 + 1):
            xdir = os.path.join(OUT, str(z), str(x))
            os.makedirs(xdir, exist_ok=True)
            # Mercator x is linear in longitude, so columns map straight across.
            lons = (x + (np.arange(TILE) + 0.5) / TILE) / nt * 360.0 - 180.0
            cols = np.clip(((lons - w) / (e - w) * w_px).astype(int), 0, w_px - 1)
            inx = (lons >= w) & (lons <= e)

            for y in range(y0, y1 + 1):
                lats = np.array([
                    math.degrees(math.atan(math.sinh(
                        math.pi * (1.0 - 2.0 * (y + (i + 0.5) / TILE) / nt))))
                    for i in range(TILE)])
                rows = np.clip(((n - lats) / (n - s) * h_px).astype(int), 0, h_px - 1)
                iny = (lats <= n) & (lats >= s)

                block = cls[np.ix_(rows, cols)].copy()
                block[~iny, :] = 0
                block[:, ~inx] = 0
                rgba = np.zeros(block.shape + (4,), dtype='uint8')
                for value, colour in ramp.items():
                    rgba[block == value] = colour
                _write_png(os.path.join(xdir, f'{y}.png'), rgba)
                written += 1
        print(f'    z{z}: x {x0}-{x1}, y {y0}-{y1}')

    size = sum(os.path.getsize(os.path.join(dp, f))
               for dp, _, fs in os.walk(OUT) for f in fs)
    print(f'    {written} tiles, {size / 1024 / 1024:.1f} MB -> {OUT}')
    return written
