"""
Establish what the values in the Assam flood-frequency raster actually mean.

The band is described as "Number of sampled years flooded (1999, 2000, 2004)",
but 94 per cent of the grid carries the top value 3 -- including the Shillong
plateau at ~1500 m and the Naga hills. Read literally that says the uplands of
Meghalaya flood every year, which is false.

Rendering it shows the minority values tracing the Brahmaputra and Barak
valleys precisely, so there IS real signal; the question is only which way
round it runs. This settles that against elevation rather than by eye: pull
terrain tiles over the same box and compare the elevation distribution of each
class. Flood frequency must fall as elevation rises. If instead elevation
rises with the value, the raster counts something else -- years NOT flooded, or
an inverted ramp -- and using it as published would invert the hazard.

Nothing is written. This only measures.
"""
import io
import math
import sys
import urllib.request

import numpy as np
import rasterio
from PIL import Image

RASTER = 'flood_frequency_1999_2000_2004.tif'
TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
Z = 9
SAMPLES_PER_CLASS = 4000


def deg2tile(lon, lat, z):
    n = 2.0 ** z
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n
    return x, y


def fetch(z, x, y, cache={}):
    key = (z, x, y)
    if key in cache:
        return cache[key]
    try:
        with urllib.request.urlopen(TILES.format(z=z, x=x, y=y), timeout=60) as r:
            im = Image.open(io.BytesIO(r.read())).convert('RGB')
        a = np.asarray(im, dtype='float32')
        # Terrarium encoding.
        cache[key] = (a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256) - 32768
    except Exception as e:                                        # noqa: BLE001
        print(f'  tile {z}/{x}/{y} failed: {type(e).__name__}')
        cache[key] = None
    return cache[key]


def elevation_at(lon, lat):
    fx, fy = deg2tile(lon, lat, Z)
    tx, ty = int(fx), int(fy)
    dem = fetch(Z, tx, ty)
    if dem is None:
        return np.nan
    px = int((fx - tx) * dem.shape[1])
    py = int((fy - ty) * dem.shape[0])
    return float(dem[min(py, dem.shape[0] - 1), min(px, dem.shape[1] - 1)])


def main():
    with rasterio.open(RASTER) as d:
        a = d.read(1)
        tr = d.transform
        H, W = a.shape

    rng = np.random.default_rng(7)
    print(f'sampling elevation at z{Z} terrarium tiles\n')
    print(f'{"value":>6}{"n":>7}{"median m":>11}{"p10":>8}{"p90":>8}   interpretation')

    stats = {}
    for val in (0, 1, 2, 3):
        rs, cs = np.where(a == val)
        if rs.size == 0:
            continue
        k = min(SAMPLES_PER_CLASS, rs.size)
        pick = rng.choice(rs.size, k, replace=False)
        elev = []
        for r, c in zip(rs[pick], cs[pick]):
            lon = tr.c + (c + 0.5) * tr.a
            lat = tr.f + (r + 0.5) * tr.e
            e = elevation_at(lon, lat)
            if np.isfinite(e):
                elev.append(e)
        if not elev:
            continue
        elev = np.array(elev)
        stats[val] = float(np.median(elev))
        print(f'{val:>6}{len(elev):>7}{np.median(elev):>11.1f}'
              f'{np.percentile(elev, 10):>8.1f}{np.percentile(elev, 90):>8.1f}')

    print()
    order = [stats[v] for v in sorted(stats)]
    rising = all(b > a_ for a_, b in zip(order, order[1:]))
    falling = all(b < a_ for a_, b in zip(order, order[1:]))
    if rising:
        print('  Median elevation RISES with the value.')
        print('  The value is therefore NOT flood frequency: high value = high')
        print('  ground = rarely or never flooded. Flood frequency is inverse.')
    elif falling:
        print('  Median elevation FALLS with the value, matching the published')
        print('  description: higher value = more years flooded.')
    else:
        print('  No monotonic relationship. The raster cannot be interpreted as')
        print('  a flood-frequency ranking from this evidence alone.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
