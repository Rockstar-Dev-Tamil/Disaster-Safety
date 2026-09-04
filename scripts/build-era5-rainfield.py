"""
A national rain field for an event the ECMWF forecast archive cannot reach.

    python scripts/build-era5-rainfield.py --event fani

OUTPUT  public/layers/era5-<event>-inc-NN.png
        public/layers/era5-<event>-sequence.json

WHY THIS EXISTS
---------------
The map's rain layer was the 29 July 2024 ECMWF run for every case. That is the
Wayanad event forecast, and showing it over Kendrapara in May 2019 is five years
wrong. The obvious fix is to fetch the forecast for each case's own event, and
for Wayanad and the live Assam case that is exactly what happens.

It cannot happen for Cyclone Fani. The ECMWF open-data archive begins somewhere
between January and March 2024; May 2019 is outside it and no retry changes
that. ERA5 reaches back to 1940, so this builds the same field from reanalysis.

FORECAST AND REANALYSIS ARE NOT THE SAME OBJECT
-----------------------------------------------
The ECMWF layer answers "what was the model saying before this happened", which
is the question a console like this exists to support. ERA5 answers "what did
the atmosphere actually do", assimilated afterwards. It is the better estimate
of the truth and the worse estimate of what anyone knew at the time. The
sequence written here is tagged `kind: 'reanalysis'` so the timeline can say
which one the officer is looking at, and must never call it a forecast.

The colour ramp, the 3-hourly windows and the Mercator row resampling are all
identical to scripts/fetch-ecmwf.py, so the two layers are directly comparable.
"""
import argparse
import json
import math
import os
import struct
import sys
import zlib

import numpy as np
import rasterio

PROJECT = os.environ.get('EE_PROJECT', 'sihrivererosion')

# India extent, matched to fetch-ecmwf.py so the two fields overlay identically.
W, S, E, N = 67.875, 5.875, 97.625, 37.625
STEP_H = 3

EVENTS = {
    'fani': {
        'start': '2019-05-02T00:00:00',
        'hours': 48,
        'label': 'Cyclone Fani, 02-04 May 2019',
    },
}

CELLS = {
    'WAYANAD': {'lon': 76.15, 'lat': 11.45, 'label': 'Wayanad'},
    'KENDRAPARA': {'lon': 86.94, 'lat': 20.63, 'label': 'Kendrapara'},
    'ASSAM': {'lon': 94.22, 'lat': 26.95, 'label': 'Majuli'},
}

# Identical to fetch-ecmwf.py. Monotonic in lightness so it survives greyscale
# and colour vision deficiency.
BANDS = [
    (1, (22, 57, 77)),
    (2.5, (29, 92, 116)),
    (5, (33, 129, 154)),
    (10, (43, 163, 160)),
    (20, (124, 191, 92)),
    (40, (217, 161, 58)),
    (70, (255, 117, 99)),
    (10_000, (255, 180, 170)),
]


def mercator_rows(src_h, south, north):
    """Rows resampling a plate-carree grid onto Mercator rows.

    MapLibre drapes an image source by interpolating linearly in projected
    space, so a field whose rows step in latitude lands up to ~100 km north of
    the ground over this box. Longitude needs no such treatment.
    """
    y = lambda d: math.log(math.tan(math.radians(45.0 + d / 2.0)))       # noqa: E731
    inv = lambda v: 2.0 * (math.degrees(math.atan(math.exp(v))) - 45.0)  # noqa: E731
    yt, yb = y(north), y(south)
    yy = yt - (np.arange(src_h) + 0.5) / src_h * (yt - yb)
    lat = np.array([inv(v) for v in yy])
    return np.clip(((north - lat) / (north - south) * src_h).astype(int),
                   0, src_h - 1)


def colourise(mm):
    h, w = mm.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for lo, col in reversed(BANDS):
        rgba[mm < lo] = (*col, 205)
    rgba[mm < BANDS[0][0]] = (0, 0, 0, 0)
    return rgba


def write_png(path, rgba):
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


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    ap.add_argument('--event', default='fani', choices=sorted(EVENTS))
    a = ap.parse_args()
    cfg = EVENTS[a.event]

    import ee
    import urllib.request
    from datetime import datetime, timedelta, timezone
    try:
        ee.Initialize(project=PROJECT)
    except Exception as exc:                                   # noqa: BLE001
        print(f'Earth Engine not ready: {str(exc)[:160]}')
        return 2

    box = ee.Geometry.Rectangle([W, S, E, N])
    t0 = datetime.fromisoformat(cfg['start']).replace(tzinfo=timezone.utc)
    scratch = os.environ.get('SCRATCH', '.')
    frames = []
    print(f'{a.event}: {cfg["label"]}')
    print(f'  window {t0:%Y-%m-%d %H:%MZ} +{cfg["hours"]} h, {STEP_H} h steps\n')

    for step in range(STEP_H, cfg['hours'] + 1, STEP_H):
        wstart = t0 + timedelta(hours=step - STEP_H)
        wend = t0 + timedelta(hours=step)
        # ERA5 hourly total_precipitation is an accumulation in METRES over the
        # preceding hour, so a 3 h window is the sum of three images x 1000.
        img = (ee.ImageCollection('ECMWF/ERA5/HOURLY')
               .filterDate(wstart.strftime('%Y-%m-%dT%H:%M:%S'),
                           wend.strftime('%Y-%m-%dT%H:%M:%S'))
               .select('total_precipitation')
               .sum()
               .multiply(1000.0)
               .rename('mm'))
        url = img.clip(box).getDownloadURL({
            'scale': 27830,          # ~0.25 deg, matching the ECMWF grid
            'region': box, 'format': 'GEO_TIFF', 'crs': 'EPSG:4326',
        })
        tmp = os.path.join(scratch, f'era5-{a.event}-{step:02d}.tif')
        urllib.request.urlretrieve(url, tmp)
        with rasterio.open(tmp) as d:
            mm = d.read(1).astype('float32')
            b = d.bounds
        mm = np.nan_to_num(mm, nan=0.0)

        rows = mercator_rows(mm.shape[0], b.bottom, b.top)
        path = f'public/layers/era5-{a.event}-inc-{step:02d}.png'
        nbytes = write_png(path, colourise(mm[rows, :]))

        # Cell readouts come from the NATIVE grid, not the reprojected image.
        lats = b.top + (np.arange(mm.shape[0]) + 0.5) * (b.bottom - b.top) / mm.shape[0]
        lons = b.left + (np.arange(mm.shape[1]) + 0.5) * (b.right - b.left) / mm.shape[1]
        cell_mm = {}
        for k, c in CELLS.items():
            i = int(np.abs(lats - c['lat']).argmin())
            j = int(np.abs(lons - c['lon']).argmin())
            cell_mm[k] = round(float(mm[i, j]), 1)

        frames.append({
            'step': step,
            'file': f'/layers/era5-{a.event}-inc-{step:02d}.png',
            'validMinutes': step * 60,
            'windowHours': STEP_H,
            'maxMm': round(float(mm.max()), 1),
            'cellMm': cell_mm,
            'bytes': nbytes,
        })
        quoted = '  '.join(f'{CELLS[k]["label"]} {v:5.1f}' for k, v in cell_mm.items())
        print(f'  +{step:02d}h  {wstart:%d %b %H}-{wend:%H}Z  max {mm.max():6.1f} mm  '
              f'{quoted}  ({nbytes / 1024:.0f} KB)')

    ist = t0 + timedelta(hours=5, minutes=30)
    meta = {
        'kind': 'reanalysis',
        'event': cfg['label'],
        'run': t0.strftime('%Y-%m-%dT%H:%M:00Z'),
        'runIst': ist.strftime('%Y-%m-%dT%H:%M:00+05:30'),
        'bounds': [W, S, E, N],
        'stepHours': STEP_H,
        'cells': CELLS,
        # Fallback only; the app derives the playhead from the case clock.
        'operatingPictureMinutes': 18 * 60 + 30,
        'frames': frames,
    }
    dest = f'public/layers/era5-{a.event}-sequence.json'
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(meta, f, indent=1)
    total = sum(fr['bytes'] for fr in frames)
    print(f'\n{len(frames)} frames, {total / 1024:.0f} KB -> {dest}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
