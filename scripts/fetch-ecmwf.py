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
import math
import os
import struct
import time
import urllib.error
import urllib.request
import zlib

import numpy as np

# Which run to pull. Defaults to the Wayanad event so the existing invocation
# is unchanged; ECMWF_RUN / ECMWF_CYCLE select another, and ECMWF_PREFIX keeps
# its output beside rather than on top of it.
#
# The open-data mirrors retain from January 2023. Anything earlier -- including
# the 1999, 2000 and 2004 Assam flood years -- cannot be fetched here at all,
# and no amount of retrying will change that.
RUN = os.environ.get('ECMWF_RUN', '20240729')
CYCLE = os.environ.get('ECMWF_CYCLE', '00z')
# NOTE: not `PREFIX` -- that name is already the S3 object path below.
OUT_PREFIX = os.environ.get('ECMWF_PREFIX', 'ecmwf')
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

# Cells read out beside the timeline, one per event case. The field itself is
# national and identical for every case -- only which grid cell gets quoted
# changes, so adding a case here costs nothing but a lookup.
CELLS = {
    'WAYANAD': {'lon': 76.15, 'lat': 11.45, 'label': 'Wayanad'},
    'KENDRAPARA': {'lon': 86.94, 'lat': 20.63, 'label': 'Kendrapara'},
    'ASSAM': {'lon': 94.22, 'lat': 26.95, 'label': 'Majuli'},
    'WESTBENGAL': {'lon': 88.10, 'lat': 21.90, 'label': 'Sundarbans'},
}

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
    # Keyed on the CYCLE as well as the date. Without it the 18Z fetch reads
    # back the 00Z messages cached under the same name earlier the same day and
    # labels them 18Z -- a silent substitution of a 29-hour-old forecast for a
    # 10-hour-old one, with nothing in the output to show it happened.
    cached = os.path.join(scratch, f'ec-tp-{RUN}{CYCLE[:2]}-{step:02d}.grib2')
    if os.path.exists(cached) and os.path.getsize(cached) > 1000:
        with open(cached, 'rb') as f:
            return f.read(), None

    last_err = None
    for bucket in BUCKETS:
        # The run HOUR is part of the object name, not just the path. This
        # read `{RUN}000000` and so silently fetched the 00Z run whatever
        # ECMWF_CYCLE said -- harmless while only 00Z was ever asked for, and
        # wrong the moment a live case wants the freshest cycle of the day.
        base = f'{bucket}/{PREFIX}/{RUN}{CYCLE[:2]}0000-{step}h-oper-fc'
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


def _ist_of(run, cycle):
    """Run initialisation restated in IST, for the timeline header."""
    import datetime as _dt
    t = _dt.datetime(int(run[:4]), int(run[4:6]), int(run[6:]), int(cycle[:2]),
                     tzinfo=_dt.timezone.utc)
    t += _dt.timedelta(hours=5, minutes=30)
    return t.strftime('%Y-%m-%dT%H:%M:00+05:30')


def mercator_rows(src_h, south, north):
    """Row indices resampling a plate-carree grid onto Mercator rows.

    MapLibre drapes an image source by interpolating linearly in PROJECTED
    space. An image whose rows are equal steps of latitude therefore lands in
    the wrong place, and over this field's 5.9 to 37.6 N span the error is not
    subtle: the Wayanad cell drew ~51 km north of where the rain fell, and the
    middle of the box ~101 km north. Longitude is unaffected -- Mercator x is
    linear in longitude -- so only rows are remapped.
    """
    y = lambda d: math.log(math.tan(math.radians(45.0 + d / 2.0)))       # noqa: E731
    inv = lambda v: 2.0 * (math.degrees(math.atan(math.exp(v))) - 45.0)  # noqa: E731
    yt, yb = y(north), y(south)
    yy = yt - (np.arange(src_h) + 0.5) / src_h * (yt - yb)
    lat = np.array([inv(v) for v in yy])
    rows = (north - lat) / (north - south) * src_h
    return np.clip(rows.astype(int), 0, src_h - 1)


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
            for key, c in CELLS.items():
                ci = int(np.abs(la - c['lat']).argmin())
                cj = int(np.abs(lo - c['lon']).argmin())
                # Snapped centre, so the app quotes the cell it actually read
                # rather than the point that was asked for.
                c['gridLon'] = round(float(lo[cj]), 3)
                c['gridLat'] = round(float(la[ci]), 3)
                c['_ij'] = (ci, cj)

        if prev is not None:
            inc = np.maximum(sub - prev, 0.0)        # rain in this 3 h window
            path = f'public/layers/{OUT_PREFIX}-inc-{step:02d}.png'
            # Cell readouts below are taken from `inc` on the native lat/lon
            # grid; only the drawn image is reprojected.
            mrows = mercator_rows(inc.shape[0], bounds[1], bounds[3])
            write_png(path, colourise(inc[mrows, :]))
            frames.append({
                'step': step,
                'file': f'/layers/{OUT_PREFIX}-inc-{step:02d}.png',
                # valid at the END of the window, in UTC minutes from the run
                'validMinutes': step * 60,
                'windowHours': 3,
                'maxMm': round(float(inc.max()), 1),
                'cellMm': {k: round(float(inc[c['_ij']]), 1)
                           for k, c in CELLS.items()},
                'bytes': os.path.getsize(path),
            })
            quoted = '  '.join(
                f"{c['label']} {inc[c['_ij']]:5.1f}" for c in CELLS.values())
            print(f'  +{step:02d}h  window {step-3:02d}-{step:02d}h  '
                  f'max {inc.max():6.1f} mm  {quoted}  '
                  f'({os.path.getsize(path)/1024:.0f} KB)')
        prev = sub

    meta = {
        'run': f'{RUN[:4]}-{RUN[4:6]}-{RUN[6:]}T{CYCLE[:2]}:00:00Z',
        'runIst': _ist_of(RUN, CYCLE),
        'bounds': bounds,
        'shape': list(prev.shape),
        'stepHours': 3,
        'cells': {k: {kk: vv for kk, vv in c.items() if not kk.startswith('_')}
                  for k, c in CELLS.items()},
        # Fallback only. The app derives the playhead from the active case's
        # own clock against `run`, so this timeline follows whichever event is
        # selected rather than being pinned to the one it was built for.
        'operatingPictureMinutes': 20 * 60 + 30,     # 30 Jul 02:00 IST = +20.5 h
        'frames': frames,
    }
    with open(f'public/layers/{OUT_PREFIX}-sequence.json', 'w') as f:
        json.dump(meta, f, indent=1)
    total = sum(f['bytes'] for f in frames)
    print(f'{len(frames)} frames, {total / 1024:.0f} KB total '
          f'-> public/layers/{OUT_PREFIX}-sequence.json')


if __name__ == '__main__':
    main()
