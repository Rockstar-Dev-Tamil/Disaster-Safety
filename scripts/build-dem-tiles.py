"""
Build a terrarium-encoded DEM tile pyramid for MapLibre 3D terrain.

WHY THIS EXISTS SEPARATELY FROM build-terrain.py
------------------------------------------------
build-terrain.py writes elevation.png as `elev / 10` into 8-bit greyscale.
That is fine for what the analysis does with it -- slope is computed once, at
build time, from the float array before quantisation -- but it leaves the
shipped raster in 10 m vertical steps. Drape that over a 3D camera at 2x
exaggeration and the steps become 20 m terraces across every gentle hillside:
it reads as a rendering fault on a console whose whole claim is that its
numbers are trustworthy.

MapLibre also cannot consume a single greyscale image as a `raster-dem`. It
wants RGB-encoded elevation, served as tiles.

So: same source data (the Copernicus GLO-30 GeoTIFFs already cached by
build-terrain.py), re-encoded losslessly.

    terrarium:  elevation_m = (R * 256 + G + B / 256) - 32768

We write integer metres (B held at zero -- see `terrarium` below for why),
which is still 10x finer than the greyscale it replaces and well inside
GLO-30's own vertical accuracy, so the encoding is no longer the limiting
factor.

MAX ZOOM
--------
Capped at z12 (~38 m/px here) rather than z13+. GLO-30 is 30 m native and the
analysis grid is 100 m, so tiles beyond z12 would invent detail the source does
not carry -- and would roughly quadruple the shipped bytes to do it. MapLibre
overzooms z12 for closer cameras, which smooths rather than fabricates.

Everything is written under public/, so the 3D view has no network dependency
at run time. This also replaces the remote Esri hillshade raster.

Run: python scripts/build-dem-tiles.py
"""
import math
import os

import numpy as np
import rasterio

# Must match build-terrain.py.
W, S, E, N = 75.55, 11.20, 76.65, 12.15
DEM_TILES = ['N11_00_E075', 'N11_00_E076', 'N12_00_E075', 'N12_00_E076']

SCRATCH = os.environ.get('SCRATCH', '.')
OUT = 'public/dem'
MIN_Z, MAX_Z = 8, 12
TILE = 256

#: Source sampling grid, 1 arc-second -- GLO-30's native step at this latitude.
SRC_STEP = 1.0 / 3600.0


# --------------------------------------------------------------- mercator ---

def lat_of(z, y_frac):
    """Latitude, degrees, at a fractional tile row. Mercator is non-linear in
    y, so tile rows cannot be interpolated in latitude."""
    n = 2.0 ** z
    return math.degrees(math.atan(math.sinh(math.pi * (1.0 - 2.0 * y_frac / n))))


def tile_range(z):
    """Inclusive x/y tile range covering the AOI at this zoom."""
    n = 2 ** z
    x0 = int((W + 180.0) / 360.0 * n)
    x1 = int((E + 180.0) / 360.0 * n)

    def y_of(lat):
        r = math.radians(lat)
        merc = math.log(math.tan(math.pi / 4 + r / 2))
        return int((1.0 - merc / math.pi) / 2.0 * n)

    y0, y1 = y_of(N), y_of(S)
    return range(x0, x1 + 1), range(y0, y1 + 1)


# ------------------------------------------------------------- dem mosaic ---

def build_mosaic():
    """One float array over the AOI at source resolution.

    Sampling every tile straight from the GeoTIFFs would re-open and re-window
    them hundreds of times; mosaicking once and indexing into it is both faster
    and gives every zoom level identical values, so a tile boundary can never
    disagree with its parent.
    """
    lons = np.arange(W, E + SRC_STEP, SRC_STEP)
    lats = np.arange(N, S - SRC_STEP, -SRC_STEP)
    grid = np.full((lats.size, lons.size), np.nan, dtype='float32')
    print(f'  mosaic {lons.size} x {lats.size} at 1 arc-second')

    for t in DEM_TILES:
        path = os.path.join(SCRATCH, f'dem_{t}.tif')
        if not os.path.exists(path):
            print(f'    {t} missing -- run build-terrain.py first to cache it')
            continue
        with rasterio.open(path) as src:
            b = src.bounds
            if b.right < W or b.left > E or b.top < S or b.bottom > N:
                continue
            data = src.read(1, masked=True)
            arr = np.asarray(data.filled(np.nan), dtype='float32')
            rows, cols = arr.shape
            tr = src.transform
            tlat = tr.f + (np.arange(rows) + 0.5) * tr.e
            tlon = tr.c + (np.arange(cols) + 0.5) * tr.a

            ri = np.clip(np.searchsorted(-tlat, -lats), 0, rows - 1)
            ci = np.clip(np.searchsorted(tlon, lons), 0, cols - 1)
            block = arr[np.ix_(ri, ci)]
            inside = (
                (lats[:, None] >= min(b.bottom, b.top))
                & (lats[:, None] <= max(b.bottom, b.top))
                & (lons[None, :] >= b.left)
                & (lons[None, :] <= b.right)
            )
            grid = np.where(inside & np.isfinite(block), block, grid)
            print(f'    {t} merged')

    filled = np.isfinite(grid).sum()
    print(f'  {filled:,} of {grid.size:,} cells carry data '
          f'({100 * filled / grid.size:.1f}%)')
    return lons, lats, np.nan_to_num(grid, nan=0.0)


# ---------------------------------------------------------------- encode ---

def terrarium(elev):
    """Elevation array -> (h, w, 3) uint8, terrarium encoding.

    The blue channel, which carries the fractional metre, is deliberately left
    at zero. GLO-30's own vertical accuracy is a few metres, so that channel
    holds nothing but noise -- and incompressible noise at that, since it is
    effectively random per pixel. Dropping it costs no real precision (integer
    metres is still 10x finer than the 10 m greyscale it replaces) and roughly
    halves the shipped pyramid, because PNG can then actually predict the
    channel.

    Rounded rather than floored, so the quantisation is unbiased instead of
    shifting every cell half a metre downhill.
    """
    v = np.round(np.clip(elev, -32768.0, 32767.0) + 32768.0)
    r = np.floor(v / 256.0)
    g = v - r * 256.0
    b = np.zeros_like(v)
    return np.stack([r, g, b], axis=-1).astype('uint8')


def main():
    try:
        from PIL import Image
    except ImportError:
        raise SystemExit('Pillow required: pip install Pillow')

    lons, lats, grid = build_mosaic()
    rows, cols = grid.shape
    total_tiles = 0
    total_bytes = 0

    for z in range(MIN_Z, MAX_Z + 1):
        xs, ys = tile_range(z)
        n = 2.0 ** z
        count = 0
        for x in xs:
            # Longitude IS linear across a tile.
            lon0 = x / n * 360.0 - 180.0
            lon1 = (x + 1) / n * 360.0 - 180.0
            px_lon = lon0 + (np.arange(TILE) + 0.5) * (lon1 - lon0) / TILE
            ci = np.clip(np.searchsorted(lons, px_lon), 0, cols - 1)

            for y in ys:
                px_lat = np.array(
                    [lat_of(z, y + (j + 0.5) / TILE) for j in range(TILE)],
                    dtype='float64',
                )
                ri = np.clip(np.searchsorted(-lats, -px_lat), 0, rows - 1)
                block = grid[np.ix_(ri, ci)]

                d = f'{OUT}/{z}/{x}'
                os.makedirs(d, exist_ok=True)
                p = f'{d}/{y}.png'
                Image.fromarray(terrarium(block), 'RGB').save(p, optimize=True)
                total_bytes += os.path.getsize(p)
                count += 1

        total_tiles += count
        print(f'  z{z}: {count} tiles')

    print(f'\n  {total_tiles} tiles, {total_bytes / 1e6:.1f} MB total')
    print(f'  source: {MIN_Z}-{MAX_Z}, terrarium, {TILE}px')


if __name__ == '__main__':
    main()
