"""
Fetch ECMWF IFS HRES open-data forecast precipitation for the Wayanad event and
render it as map overlays.

WHY ECMWF'S OWN FEED IS NOT USED
    data.ecmwf.int/forecasts serves a rolling ~4 day window and 404s for July
    2024. The AWS open-data mirror (s3://ecmwf-forecasts) retains from Jan 2023,
    so the archived run is reachable there.

WHY THIS IS CHEAP
    Each step file is ~117 MB, but ECMWF ships a .index sidecar giving the byte
    offset and length of every GRIB message. Total precipitation is one ~830 KB
    message, so we range-fetch only that.

WHAT IT SHOWS
    Total precipitation accumulated from the run's initialisation time. Run
    29 Jul 2024 00Z, so step 24 is the 24 h accumulation valid 30 Jul 00Z --
    the period containing the landslide. This is a genuine forecast: what the
    model said in advance, not a reconstruction after the fact.
"""
import json
import os
import struct
import time
import urllib.error
import urllib.request
import zlib

import numpy as np

RUN = '20240729'
CYCLE = '00z'
STEPS = list(range(0, 51, 3))     # 0..48 h at 3 h resolution
# ECMWF open data is mirrored to AWS, Google and Azure. The AWS bucket
# throttles anonymous range-request bursts hard (503 Slow Down); the Google
# mirror serves the same objects without complaint, so it is primary here.
BUCKETS = [
    'https://storage.googleapis.com/ecmwf-open-data',
    'https://ecmwf-forecasts.s3.amazonaws.com',
]
PREFIX = f'{RUN}/{CYCLE}/ifs/0p25/oper'


# India extent, matched to the app's map bounds
W, S, E, N = 68.0, 6.0, 97.5, 37.5

# Precipitation ramp, mm per 3 h window. Monotonic in lightness so it survives
# colour vision deficiency and greyscale; hue sequence follows normal
# meteorological convention so it reads pre-attentively.
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


def get(url, rng=None, tries=10):
    """S3 returns 503 Slow Down under burst; back off rather than give up."""
    for attempt in range(tries):
        req = urllib.request.Request(url)
        if rng:
            req.add_header('Range', f'bytes={rng[0]}-{rng[1]}')
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                return r.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in (503, 500, 429) or attempt == tries - 1:
                raise
            wait = min(60, 2 ** attempt)
            print(f'    {exc.code} from S3, retrying in {wait}s', flush=True)
            time.sleep(wait)
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError('unreachable')


def tp_message(step):
    """Range-fetch just the total-precipitation GRIB message for one step.

    Cached to disk per step: the bucket throttles a burst of range requests,
    and a partial run should resume rather than start over.
    """
    scratch = os.environ.get('SCRATCH', '.')
    cached = os.path.join(scratch, f'ec-tp-{RUN}-{step:02d}.grib2')
    if os.path.exists(cached) and os.path.getsize(cached) > 1000:
        with open(cached, 'rb') as f:
            return f.read(), None

    last_err = None
    for bucket in BUCKETS:
        base = f'{bucket}/{PREFIX}/{RUN}000000-{step}h-oper-fc'
        try:
            idx = get(f'{base}.index').decode('utf-8', 'replace')
            rec = next(json.loads(l) for l in idx.splitlines()
                       if l.strip() and json.loads(l).get('param') == 'tp')
            off, ln = int(rec['_offset']), int(rec['_length'])
            raw = get(f'{base}.grib2', (off, off + ln - 1))
            break
        except Exception as exc:                                # noqa: BLE001
            last_err = exc
            print(f'    {bucket.split("/")[2]} failed ({exc}), trying next mirror')
    else:
        raise last_err
    with open(cached, 'wb') as f:
        f.write(raw)
    return raw, rec


def decode(raw, tmp):
    import eccodes as ec
    with open(tmp, 'wb') as f:
        f.write(raw)
    with open(tmp, 'rb') as f:
        h = ec.codes_grib_new_from_file(f)
        ni, nj = ec.codes_get(h, 'Ni'), ec.codes_get(h, 'Nj')
        vals = ec.codes_get_array(h, 'values').reshape(nj, ni) * 1000.0   # m -> mm
        lats = ec.codes_get_array(h, 'latitudes').reshape(nj, ni)[:, 0]
        lons = ec.codes_get_array(h, 'longitudes').reshape(nj, ni)[0, :]
        meta = {k: ec.codes_get(h, k) for k in ('dataDate', 'dataTime', 'stepRange')}
        ec.codes_release(h)
    lons = ((lons + 180) % 360) - 180
    order = np.argsort(lons)
    return vals[:, order], lats, lons[order], meta


def colourise(sub):
    h, w = sub.shape
    rgba = np.zeros((h, w, 4), dtype=np.uint8)
    for lo, col in reversed(BANDS):
        rgba[sub < lo] = (*col, 205)
    rgba[sub < BANDS[0][0]] = (0, 0, 0, 0)          # below 1 mm: transparent
    return rgba


def write_png(path, rgba):
    """Minimal PNG writer -- avoids depending on an image library."""
    h, w, _ = rgba.shape
    raw = b''.join(b'\x00' + rgba[y].tobytes() for y in range(h))

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
    """Fetch the 3-hourly sequence and emit INCREMENTAL fields.

    ECMWF total precipitation is accumulated from initialisation, so tp(step)
    is everything since 00Z. What an operator wants is rain falling in each
    window -- rain now, then rain next -- which is tp(step) - tp(step-3).
    Differencing here means the app never has to.
    """
    scratch = os.environ.get('SCRATCH', '.')
    os.makedirs('public/layers', exist_ok=True)

    prev = None
    frames = []
    bounds = None
    run_epoch_utc = 0            # 2024-07-29T00:00Z

    for step in STEPS:
        raw, _ = tp_message(step)
        vals, lats, lons, _meta = decode(raw, os.path.join(scratch, f'tp{step}.grib2'))

        ii = np.where((lats >= S) & (lats <= N))[0]
        jj = np.where((lons >= W) & (lons <= E))[0]
        sub = vals[ii.min():ii.max() + 1, jj.min():jj.max() + 1]
        la, lo = lats[ii.min():ii.max() + 1], lons[jj.min():jj.max() + 1]
        if la[0] < la[-1]:
            sub, la = sub[::-1], la[::-1]

        if bounds is None:
            half = 0.125
            bounds = [round(float(lo[0] - half), 4), round(float(la[-1] - half), 4),
                      round(float(lo[-1] + half), 4), round(float(la[0] + half), 4)]
            wi = int(np.abs(la - 11.45).argmin())
            wj = int(np.abs(lo - 76.15).argmin())

        if prev is not None:
            inc = np.maximum(sub - prev, 0.0)        # rain in this 3 h window
            path = f'public/layers/ecmwf-inc-{step:02d}.png'
            write_png(path, colourise(inc))
            frames.append({
                'step': step,
                'file': f'/layers/ecmwf-inc-{step:02d}.png',
                # valid at the END of the window, in UTC minutes from the run
                'validMinutes': step * 60,
                'windowHours': 3,
                'maxMm': round(float(inc.max()), 1),
                'wayanadCellMm': round(float(inc[wi, wj]), 1),
                'bytes': os.path.getsize(path),
            })
            print(f'  +{step:02d}h  window {step-3:02d}-{step:02d}h  '
                  f'max {inc.max():6.1f} mm  Wayanad {inc[wi, wj]:5.1f} mm  '
                  f'({os.path.getsize(path)/1024:.0f} KB)')
        prev = sub

    meta = {
        'run': '2024-07-29T00:00:00Z',
        'runIst': '2024-07-29T05:30:00+05:30',
        'bounds': bounds,
        'shape': list(prev.shape),
        'stepHours': 3,
        'cell': {'lon': 76.25, 'lat': 11.5},
        # where the app's operating picture sits on this timeline
        'operatingPictureMinutes': 20 * 60 + 30,     # 30 Jul 02:00 IST = +20.5 h
        'frames': frames,
    }
    with open('public/layers/ecmwf-sequence.json', 'w') as f:
        json.dump(meta, f, indent=1)
    total = sum(f['bytes'] for f in frames)
    print(f'{len(frames)} frames, {total / 1024:.0f} KB total '
          f'-> public/layers/ecmwf-sequence.json')


if __name__ == '__main__':
    main()
