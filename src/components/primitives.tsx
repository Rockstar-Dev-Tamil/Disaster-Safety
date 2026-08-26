import type { ReactNode } from 'react';
import type { Assessment, Provenance, SusceptibilityBand, TierStatus } from '../data/schema';
import { BAND_FILL, BAND_LABEL, BAND_TEXT } from '../lib/severity';
import { dateOnly, ts } from '../lib/format';

/* -------------------------------------------------------- provenance --- */

const CHIP: Record<Provenance['status'], { cls: string; label: string }> = {
  PENDING_OVERLAY: { cls: 'prov-pending', label: 'Pending overlay' },
  LIVE: { cls: 'prov-live', label: 'Live' },
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

export function Block({
  title,
  aux,
  children,
  flush,
}: {
  title: string;
  aux?: ReactNode;
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <section className="block">
      <div className="block-head">
        <span>{title}</span>
        {aux ? <span className="aux">{aux}</span> : null}
      </div>
      <div className={flush ? 'block-body flush' : 'block-body'}>{children}</div>
    </section>
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
