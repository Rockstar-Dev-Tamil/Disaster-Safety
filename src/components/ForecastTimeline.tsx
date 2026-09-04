import { useEffect, useRef, useState } from 'react';
import { ts } from '../lib/format';

export interface SequenceFrame {
  step: number;
  file: string;
  validMinutes: number;
  windowHours: number;
  maxMm: number;
  /** Rain in this window at each case's own grid cell, keyed by case id. */
  cellMm: Record<string, number>;
}

export interface SequenceMeta {
  run: string;
  runIst: string;
  bounds: [number, number, number, number];
  stepHours: number;
  /** Fallback playhead. Superseded by the active case's clock when given. */
  operatingPictureMinutes: number;
  cells: Record<string, { lon: number; lat: number; label: string;
                          gridLon?: number; gridLat?: number }>;
  frames: SequenceFrame[];
}

/** Frame pair plus blend factor. The map cross-fades between them so the field
 *  morphs continuously instead of snapping every 3 h. */
export interface BlendState {
  a: SequenceFrame;
  b: SequenceFrame;
  f: number;
}

const IST_OFFSET_MIN = 330;

/** Minutes from run initialisation to an arbitrary instant.
 *
 * The forecast field is national and the same for every case; what differs is
 * where on its timeline the event sits. Deriving that from the case clock
 * rather than baking it means the timeline follows whichever event is
 * selected, and a new case needs no change here at all. */
function minutesFromRun(runIsoUtc: string, clockIso: string): number | null {
  const r = Date.parse(runIsoUtc);
  const t = Date.parse(clockIso);
  if (!Number.isFinite(r) || !Number.isFinite(t)) return null;
  return Math.round((t - r) / 60000);
}

/** Run time + elapsed minutes -> ISO in IST. */
function istAt(runIsoUtc: string, minutes: number): string {
  const m = runIsoUtc.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return runIsoUtc;
  const base = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const d = new Date(base + (minutes + IST_OFFSET_MIN) * 60000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00+05:30`;
}

export function ForecastTimeline({
  meta,
  onBlend,
  focus,
}: {
  meta: SequenceMeta;
  onBlend: (b: BlendState | null) => void;
  /** Active case: which cell to quote, and which clock to sit the playhead on.
   *  Null falls back to whatever the sequence was built with. `live` says the
   *  clock is wall-clock now rather than a fixed event time, which changes what
   *  the footnote can honestly claim. */
  focus?: { key: string; clock: string; live?: boolean } | null;
}) {
  const first = meta.frames[0].validMinutes;
  const last = meta.frames[meta.frames.length - 1].validMinutes;

  /* The case clock may sit outside the forecast window entirely -- a live case
   * has no fixed clock at all. Clamp rather than scroll off the track, and
   * remember whether we had to, because a clamped marker is not the operating
   * picture and should not claim to be. */
  const rawOp = focus?.clock ? minutesFromRun(meta.run, focus.clock) : null;
  const opMinutes = rawOp === null
    ? meta.operatingPictureMinutes
    : Math.max(first, Math.min(last, rawOp));
  const opOutside = rawOp !== null && (rawOp < first || rawOp > last);

  const cellKey = focus?.key && meta.cells?.[focus.key] ? focus.key : null;
  const cell = cellKey ? meta.cells[cellKey] : null;

  /* Clock position in minutes from run initialisation. Continuous, not
   * frame-indexed -- the point is that it slides. */
  const [minutes, setMinutes] = useState(opMinutes);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(60); // forecast-minutes per real second
  const raf = useRef(0);
  const lastT = useRef(0);

  /* resolve clock -> frame pair + blend factor */
  useEffect(() => {
    const fr = meta.frames;
    let i = 0;
    while (i < fr.length - 2 && fr[i + 1].validMinutes <= minutes) i++;
    const a = fr[i];
    const b = fr[Math.min(i + 1, fr.length - 1)];
    const span = b.validMinutes - a.validMinutes;
    const f = span > 0 ? Math.max(0, Math.min(1, (minutes - a.validMinutes) / span)) : 0;
    onBlend({ a, b, f });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minutes, meta]);

  useEffect(() => () => onBlend(null), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Switching case moves the event, so the playhead moves with it. Only when
   * paused: yanking the clock out from under a running animation would look
   * like a glitch rather than a change of subject. */
  useEffect(() => {
    if (!playing) setMinutes(opMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opMinutes]);

  /* animation loop */
  useEffect(() => {
    if (!playing) {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = 0;
      return;
    }
    lastT.current = performance.now();
    const tick = (now: number) => {
      const dt = (now - lastT.current) / 1000;
      lastT.current = now;
      setMinutes((m) => {
        const next = m + dt * speed;
        return next >= last ? first : next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, speed, first, last]);

  const fr = meta.frames;
  let idx = 0;
  while (idx < fr.length - 2 && fr[idx + 1].validMinutes <= minutes) idx++;
  const cur = fr[idx];
  const opPct = ((opMinutes - first) / (last - first)) * 100;

  return (
    <div className="fctl">
      <div className="fctl-head">
        <span>ECMWF HRES forecast · run {ts(meta.runIst)}</span>
        <span className="mono">+{(minutes / 60).toFixed(1)} h</span>
      </div>

      <div className="fctl-row">
        <button className="fctl-btn" onClick={() => setPlaying((p) => !p)} title="Play / pause">
          {playing ? '❚❚' : '▶'}
        </button>
        <button
          className="fctl-btn"
          onClick={() => {
            setPlaying(false);
            setMinutes(Math.max(first, cur.validMinutes - meta.stepHours * 60));
          }}
          title="Previous step"
        >
          ‹
        </button>
        <button
          className="fctl-btn"
          onClick={() => {
            setPlaying(false);
            setMinutes(Math.min(last, cur.validMinutes + meta.stepHours * 60));
          }}
          title="Next step"
        >
          ›
        </button>

        <div className="fctl-track">
          <input
            type="range"
            min={first}
            max={last}
            step={1}
            value={minutes}
            onChange={(e) => {
              setPlaying(false);
              setMinutes(Number(e.target.value));
            }}
            aria-label="Forecast clock"
          />
          {/* where the app's operating picture sits on this timeline */}
          <span className="fctl-marker" style={{ left: `${opPct}%` }} title="Operating picture" />
        </div>

        <button
          className="fctl-btn"
          onClick={() => setSpeed((s) => (s === 60 ? 180 : s === 180 ? 360 : 60))}
          title="Playback speed"
        >
          {speed === 60 ? '1×' : speed === 180 ? '3×' : '6×'}
        </button>
      </div>

      <div className="fctl-read">
        <span className="mono">{ts(istAt(meta.run, minutes))}</span>
        <span>
          window {cur.step - cur.windowHours}–{cur.step} h
        </span>
        <span>
          peak <b className="mono">{cur.maxMm.toFixed(1)}</b> mm/3h
        </span>
        {cell && cellKey ? (
          <span>
            {cell.label} cell{' '}
            <b className="mono">{(cur.cellMm?.[cellKey] ?? 0).toFixed(1)}</b> mm/3h
          </span>
        ) : null}
      </div>

      <div className="fctl-note">
        Forecast, not observation — issued {ts(meta.runIst)}
        {focus?.live ? '' : ', before the event'}. 0.25° (~28 km);
        {opOutside
          ? ' this case’s clock falls outside the forecast window, so the marker is clamped to the nearest end and is not the operating picture.'
          : focus?.live
            ? ` the marker is now, ${(opMinutes / 60).toFixed(1)} h into this run.`
            : ` the marker on the track is the operating picture at ${ts(istAt(meta.run, opMinutes))}.`}
      </div>
    </div>
  );
}
