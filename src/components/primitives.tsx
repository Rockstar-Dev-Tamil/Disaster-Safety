import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Assessment, Provenance, SusceptibilityBand, TierStatus } from '../data/schema';
import { BAND_FILL, BAND_LABEL, BAND_TEXT } from '../lib/severity';
import { dateOnly, ts } from '../lib/format';

/* -------------------------------------------------------- provenance --- */

const CHIP: Record<Provenance['status'], { cls: string; label: string }> = {
  PENDING_OVERLAY: { cls: 'prov-pending', label: 'Pending overlay' },
  LIVE: { cls: 'prov-live', label: 'Live' },
  UNATTRIBUTED: { cls: 'prov-unattributed', label: 'Source unverified' },
  STUB_M2: { cls: 'prov-stub', label: 'M2 not implemented' },
  STUB_M4: { cls: 'prov-stub', label: 'M4 not implemented' },
};

export function ProvChip({ p }: { p: Provenance }) {
  const c = CHIP[p.status];
  return <span className={`badge ${c.cls}`}>{c.label}</span>;
}

/** The source line that sits under any figure. Never optional. */
export function ProvLine({ p }: { p: Provenance }) {
  return (
    <div className="provline">
      <ProvChip p={p} />
      <div>
        <span className="src">{p.source}</span>
        {' — '}
        {p.agency}
        {p.method ? <> · {p.method}</> : null}
        {p.resolution ? <> · {p.resolution}</> : null}
        {p.assessedOn ? <> · assessed {dateOnly(p.assessedOn)}</> : null}
        {p.observedAt ? <> · observed {ts(p.observedAt)}</> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ layout --- */

/**
 * A titled section.
 *
 * With `collapsible`, the head becomes a disclosure control. The rule for the
 * label is that collapsing must never hide the FINDING -- only the row-by-row
 * detail behind it. So `aux` on a collapsible block should carry the headline
 * ("15.3% eligible", "6 factors, score 78.4"), and the rows go inside.
 */
export function Block({
  title,
  aux,
  children,
  flush,
  collapsible,
  defaultOpen = false,
}: {
  title: string;
  aux?: ReactNode;
  children: ReactNode;
  flush?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const body = <div className={flush ? 'block-body flush' : 'block-body'}>{children}</div>;

  if (!collapsible) {
    return (
      <section className="block">
        <div className="block-head">
          <span>{title}</span>
          {aux ? <span className="aux">{aux}</span> : null}
        </div>
        {body}
      </section>
    );
  }

  return (
    <section className={`block${open ? ' open' : ''}`}>
      <button
        className="block-head disclose"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="caret" aria-hidden />
        <span>{title}</span>
        {aux ? <span className="aux">{aux}</span> : null}
      </button>
      <div className="collapse" hidden={false}>
        {body}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- motion --- */

const reduced = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Eases a displayed number toward a new value.
 *
 * Only ever attached to a HEADLINE figure, never to the rows of a factor
 * table: for the ~300 ms of the tween the headline does not reconcile with its
 * breakdown, and that is tolerable for one number confirming a recompute but
 * not for a table the officer is reading down. The tween always LANDS on the
 * exact target rather than on the last eased frame, so the resting value is
 * the computed value and not an artefact of the animation.
 */
export function useAnimatedNumber(target: number, ms = 300) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  const raf = useRef(0);

  useEffect(() => {
    if (reduced() || from.current === target) {
      from.current = target;
      setShown(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - t) * (1 - t); // ease-out quad
      if (t >= 1) {
        from.current = target;
        setShown(target); // exact landing
        return;
      }
      setShown(a + (target - a) * e);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, ms]);

  return shown;
}

/** A numeral that counts to its new value when the system recomputes it. */
export function CountUp({
  value,
  decimals = 0,
  suffix,
  className,
  style,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const shown = useAnimatedNumber(value);
  const text =
    decimals > 0
      ? shown.toFixed(decimals)
      : Math.round(shown).toLocaleString('en-IN');
  return (
    <span className={className} style={style}>
      {text}
      {suffix ? <span className="unit">{suffix}</span> : null}
    </span>
  );
}

export function Fig({
  label,
  value,
  sub,
  mono = true,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="fig">
      <div className="fig-label" title={label}>
        {label}
      </div>
      <div className="fig-val" style={mono ? undefined : { fontFamily: 'var(--ff-ui)' }}>
        {value}
      </div>
      {sub ? <div className="fig-sub">{sub}</div> : null}
    </div>
  );
}

export function BandTag({ band }: { band: SusceptibilityBand }) {
  return (
    <span className="scorebox-band" style={{ color: BAND_TEXT[band] }}>
      {BAND_LABEL[band]}
    </span>
  );
}

/* -------------------------------------------------------- tier flags --- */

export const TIER_STATUS_LABEL: Record<TierStatus, string> = {
  FLAGGED: 'Flagged',
  NOT_FLAGGED: 'Not flagged',
  WITHHELD: 'Withheld',
};

export const TIER_STATUS_CLS: Record<TierStatus, string> = {
  FLAGGED: 'on',
  NOT_FLAGGED: 'off',
  WITHHELD: 'held',
};

export const TIER_STATUS_COLOR: Record<TierStatus, string> = {
  FLAGGED: 'var(--flag-on)',
  NOT_FLAGGED: 'var(--fg-3)',
  WITHHELD: 'var(--flag-held)',
};

export function FlagDot({ status }: { status: TierStatus }) {
  return <span className={`flagdot ${TIER_STATUS_CLS[status]}`} />;
}

/* ------------------------------------------------------------ meters --- */

export function OccupancyMeter({ occupancy, capacity }: { occupancy: number; capacity: number }) {
  const frac = capacity === 0 ? 0 : Math.min(1, occupancy / capacity);
  const band: SusceptibilityBand =
    frac >= 0.9 ? 'VERY_HIGH' : frac >= 0.7 ? 'HIGH' : frac >= 0.4 ? 'MODERATE' : 'LOW';
  return (
    <span className="meter">
      <span className="meter-track">
        <span
          className="meter-fill"
          style={{ width: `${frac * 100}%`, background: BAND_FILL[band] }}
        />
      </span>
      <span className="mono">{Math.round(frac * 100)}%</span>
    </span>
  );
}

/* --------------------------------------------------------- score box --- */

export function ScoreBox({
  label,
  score,
  band,
  timestampLabel,
  timestamp,
  color,
}: {
  label: string;
  score: number;
  band?: SusceptibilityBand;
  timestampLabel: string;
  timestamp?: string;
  color?: string;
}) {
  return (
    <div className="scorebox">
      <div className="scorebox-head">
        <span className="scorebox-label">{label}</span>
      </div>
      <div className="scorebox-main">
        <span className="scorebox-num" style={{ color: color ?? (band ? BAND_TEXT[band] : undefined) }}>
          {score.toFixed(1)}
        </span>
        {band ? <BandTag band={band} /> : null}
      </div>
      <div className="scorebox-ts">
        {timestampLabel} {timestamp ? ts(timestamp) : '--'}
      </div>
    </div>
  );
}

/** Renders an Assessment's headline number with its band. */
export function AssessmentHead({ a }: { a: Assessment }) {
  return (
    <>
      <span className="mono" style={{ color: BAND_TEXT[a.band] }}>
        {a.score.toFixed(1)}
      </span>{' '}
      <BandTag band={a.band} />
    </>
  );
}

/* ------------------------------------------------------ map overlays --- */

/**
 * A box floating over the map that can be folded to its title bar.
 *
 * The bottom edge of the map stage carries three of these -- legend, forecast
 * transport, explain dock -- and with a wide forecast transport open they
 * overlap each other. Rather than fight for space, each can be folded to a
 * single row so the officer decides which one is worth the map it covers.
 */
export function OverlayBox({
  title,
  aux,
  children,
  defaultOpen = true,
  className,
}: {
  title: string;
  aux?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`obox${open ? ' open' : ''}${className ? ` ${className}` : ''}`}>
      <button className="obox-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="caret" aria-hidden />
        <span className="obox-title">{title}</span>
        {aux ? <span className="obox-aux">{aux}</span> : null}
      </button>
      <div className="collapse">{children}</div>
    </div>
  );
}
