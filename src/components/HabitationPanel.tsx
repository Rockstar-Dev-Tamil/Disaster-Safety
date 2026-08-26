import { useState } from 'react';
import type {
  CandidateSite,
  ExplainScope,
  Habitation,
  ImmediateTier,
  LongTermTier,
  ShortTermTier,
  TierKey,
} from '../data/schema';
import { HAZARD_LABEL } from '../data/schema';
import { FactorTable } from './FactorTable';
import { ExplainDock } from './ExplainDock';
import { PublishedBlock, PublishedSummary } from './PublishedClass';
import {
  AssessmentHead,
  Block,
  Fig,
  FlagDot,
  OccupancyMeter,
  ProvChip,
  ProvLine,
  ScoreBox,
  TIER_STATUS_COLOR,
  TIER_STATUS_LABEL,
} from './primitives';
import { ALERT_FILL, ALERT_TEXT, BAND_TEXT } from '../lib/severity';
import { coord, dateOnly, durationShort, int, ts, tsShort } from '../lib/format';

const TIERS: Array<[TierKey, string, string]> = [
  ['IMMEDIATE', 'Immediate', '1'],
  ['SHORT_TERM', 'Short-term', '2'],
  ['LONG_TERM', 'Long-term', '3'],
];

const TIER_SCOPE: Record<TierKey, ExplainScope> = {
  IMMEDIATE: 'TIER_IMMEDIATE',
  SHORT_TERM: 'TIER_SHORT_TERM',
  LONG_TERM: 'TIER_LONG_TERM',
};

export function HabitationPanel({
  h,
  onClose,
  activeTier,
  setActiveTier,
}: {
  h: Habitation;
  onClose: () => void;
  activeTier: TierKey;
  setActiveTier: (t: TierKey) => void;
}) {
  return (
    <div className="panel">
      <header className="panel-head">
        <div className="panel-head-top">
          <div>
            <div className="panel-title">
              {h.name}
              {h.nameLocal ? (
                <span style={{ color: 'var(--fg-2)', fontWeight: 400, marginLeft: 8 }}>
                  {h.nameLocal}
                </span>
              ) : null}
            </div>
            <div className="panel-breadcrumb">
              {h.block} block · {h.district} · {h.state} ·{' '}
              <span className="mono">LGD {h.lgdCode}</span>
            </div>
          </div>
          <button className="panel-close" onClick={onClose} title="Close panel (Esc)">
            ×
          </button>
        </div>

        <div className="panel-figs">
          <Fig label="Population" value={int(h.population)} sub="Census 2011, projected" />
          <Fig label="Households" value={int(h.households)} sub="Enumerated" />
          <Fig label="Hazards" value={h.hazards.map((x) => HAZARD_LABEL[x]).join(', ')} mono={false} />
          <Fig label="Coordinates" value={coord(h.lngLat)} />
        </div>

        {/* Two scores, never one. They answer different questions and cannot
            be collapsed without one of them becoming indefensible. */}
        <div className="scorepair">
          <ScoreBox
            label="Standing susceptibility"
            score={h.susceptibility.score}
            band={h.susceptibility.band}
            timestampLabel="assessed"
            timestamp={h.susceptibility.provenance.assessedOn}
          />
          <ScoreBox
            label={`Current — IMD ${h.current.alert}`}
            score={h.current.score}
            timestampLabel="observed"
            timestamp={h.current.observedAt}
            color={ALERT_TEXT[h.current.alert]}
          />
        </div>

        {/* What the published sheets say about this ground, at every tier. */}
        <PublishedSummary id={h.id} />

        {/* Hand-off to the habitation-level workspace. This is a commitment,
            not navigation: it is the officer saying "we are working this one
            now", so it reads as an action rather than a link. */}
        <a
          className="linkbtn"
          href={`#/evac/${encodeURIComponent(h.id)}`}
          style={{ marginTop: 'var(--s-4)' }}
        >
          <span>
            Open evacuation planning
            <span className="sub" style={{ display: 'block' }}>
              Loads terrain, hazard and road network for a 30 km operation radius
            </span>
          </span>
          <span style={{ color: 'var(--accent)', fontSize: 'var(--fs-lg)' }}>→</span>
        </a>
      </header>

      {/* Habitation-level scope: answers about the header figures and the two
          score breakdowns. The tier-level dock at the foot of the panel answers
          about whichever tier is open. */}
      <ExplainDock scope="HABITATION" />

      <div className="tierstrip">
        {TIERS.map(([k, label, key]) => {
          const status = h.tiers[k];
          return (
            <button
              key={k}
              className={`tiertab${activeTier === k ? ' on' : ''}`}
              onClick={() => setActiveTier(k)}
              title={`${label} — ${TIER_STATUS_LABEL[status]}`}
            >
              <span className="tiertab-top">
                <FlagDot status={status} />
                <span className="tiertab-name">{label}</span>
                <span className="tiertab-key">{key}</span>
              </span>
              <span className="tiertab-status" style={{ color: TIER_STATUS_COLOR[status] }}>
                {TIER_STATUS_LABEL[status]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="panel-body">
        <TierBody h={h} tier={activeTier} />
      </div>

      <ExplainDock scope={TIER_SCOPE[activeTier]} />
    </div>
  );
}

/* ======================================================== tier bodies === */

function TierBody({ h, tier }: { h: Habitation; tier: TierKey }) {
  if (!h.detail) {
    return (
      <>
        <div className="empty">
          <strong>Tier assessment not authored for this habitation</strong>
          The flag above is derived from score thresholds. Breakdowns below are real; the three
          tier bodies are authored only for the Wayanad demonstration habitations.
        </div>
        <Block title="Standing susceptibility breakdown" aux={`score ${h.susceptibility.score.toFixed(1)}`} flush collapsible>
          <FactorTable a={h.susceptibility} />
        </Block>
        <Block title="Published hazard classification" aux="ingested sheets" flush collapsible>
          <PublishedBlock id={h.id} />
        </Block>
        <Block title="Current state drivers" aux={ts(h.current.observedAt)} flush collapsible>
          <FactorTable
            a={{
              score: h.current.score,
              band: h.susceptibility.band,
              factors: h.current.drivers,
              provenance: h.current.provenance,
            }}
          />
        </Block>
      </>
    );
  }

  if (tier === 'IMMEDIATE') return <ImmediateBody h={h} d={h.detail.immediate} />;
  if (tier === 'SHORT_TERM') return <ShortTermBody d={h.detail.shortTerm} id={h.id} />;
  return <LongTermBody h={h} d={h.detail.longTerm} />;
}

function TierRationale({
  status,
  rationale,
  since,
}: {
  status: Habitation['tiers'][TierKey];
  rationale: string;
  since?: string;
}) {
  return (
    <div
      className="block"
      style={{
        padding: 'var(--s-4) var(--s-5)',
        borderLeft: `3px solid ${TIER_STATUS_COLOR[status]}`,
        background: 'var(--bg-0)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)', marginBottom: 'var(--s-3)' }}>
        <FlagDot status={status} />
        <span style={{ color: TIER_STATUS_COLOR[status], letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: 'var(--fs-xs)' }}>
          {TIER_STATUS_LABEL[status]}
        </span>
        {since ? <span className="mono" style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>since {dateOnly(since)}</span> : null}
      </div>
      <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.45 }}>{rationale}</div>
    </div>
  );
}

/* ------------------------------------------------------------ immediate */

function ImmediateBody({ h, d }: { h: Habitation; d: ImmediateTier }) {
  const crossed = d.triggers.filter((t) => t.crossed).length;
  const totalCap = d.camps.reduce((a, c) => a + c.capacity, 0);
  const totalOcc = d.camps.reduce((a, c) => a + c.occupancy, 0);
  const free = totalCap - totalOcc;

  return (
    <>
      <TierRationale status={d.flag.status} rationale={d.flag.rationale} since={d.flag.since} />

      <Block title="Red zone status">
        <div style={{ fontSize: 'var(--fs-sm)' }}>{d.redZoneStatus}</div>
      </Block>

      <Block title="Triggers" aux={`${crossed} of ${d.triggers.length} crossed`} flush>
        <table className="rowtable">
          <thead>
            <tr>
              <th>Trigger</th>
              <th>Observed</th>
              <th>Threshold</th>
              <th className="r">Crossed</th>
            </tr>
          </thead>
          <tbody>
            {d.triggers.map((t) => (
              <tr key={t.key}>
                <td style={{ color: 'var(--fg-0)' }}>{t.label}</td>
                <td className="mononum">{t.observed}</td>
                <td>{t.threshold}</td>
                <td className="r mononum" style={{ color: t.crossed ? 'var(--sev-vhigh-fg)' : 'var(--fg-3)' }}>
                  {t.crossed ? tsShort(t.crossedAt) : 'no'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ProvLine p={d.triggers[0].provenance} />
      </Block>

      <Block
        title={`Feed — ${d.nowcast.stationName}`}
        aux={`${d.nowcast.distanceKm.toFixed(1)} km · ${coord(d.nowcast.lngLat)}`}
        flush
        collapsible
      >
        <table className="rowtable">
          <thead>
            <tr>
              <th>Time</th>
              <th className="r">3 h</th>
              <th className="r">24 h</th>
              <th className="r">Cumulative</th>
              <th className="r">Alert</th>
            </tr>
          </thead>
          <tbody>
            {d.nowcast.frames.map((f) => (
              <tr key={f.t}>
                <td className="mononum">{tsShort(f.t)}</td>
                <td className="r mononum">{f.rain3h.toFixed(1)}</td>
                <td className="r mononum">{f.rain24h.toFixed(1)}</td>
                <td className="r mononum">{f.rainCumulative.toFixed(1)}</td>
                <td className="r">
                  <span
                    className="badge"
                    style={{ color: ALERT_TEXT[f.alert], borderColor: ALERT_FILL[f.alert] }}
                  >
                    {f.alert}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 'var(--s-3) var(--s-5)', borderTop: '1px solid var(--line-1)' }}>
          {d.nowcast.thresholds.map((t) => (
            <div key={t.key} style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', padding: '1px 0' }}>
              <span className="mono" style={{ color: 'var(--fg-1)' }}>
                {t.value} mm
              </span>{' '}
              — {t.label}. {t.basis}
            </div>
          ))}
        </div>
        <ProvLine p={d.nowcast.provenance} />
      </Block>

      <Block
        title="Relief camps"
        aux={`${int(free)} free of ${int(totalCap)} · ${int(h.population)} to move`}
        flush
      >
        <table className="rowtable">
          <thead>
            <tr>
              <th>Camp</th>
              <th className="r">Distance</th>
              <th className="r">Capacity</th>
              <th className="r">Free</th>
              <th className="r">Occupancy</th>
            </tr>
          </thead>
          <tbody>
            {d.camps.map((c) => (
              <tr key={c.id}>
                <td>
                  <span style={{ color: 'var(--fg-0)' }}>{c.name}</span>
                  <span className="fnote" style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                    {c.type} · {c.facilities.join(', ')}
                  </span>
                </td>
                <td className="r mononum">{c.distanceKm.toFixed(1)} km</td>
                <td className="r mononum">{int(c.capacity)}</td>
                <td className="r mononum">{int(c.capacity - c.occupancy)}</td>
                <td className="r">
                  <OccupancyMeter occupancy={c.occupancy} capacity={c.capacity} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {free < h.population ? (
          <div
            style={{
              padding: 'var(--s-3) var(--s-5)',
              borderTop: '1px solid var(--line-1)',
              color: 'var(--sev-high-fg)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            Spare capacity {int(free)} is short of the {int(h.population)} to be moved by{' '}
            {int(h.population - free)}. Additional camps must be opened or the lift split.
          </div>
        ) : null}
        <ProvLine p={d.camps[0].provenance} />
      </Block>

      <Block
        title="Estimated evacuation time"
        aux={durationShort(d.evacuation.totalMinutes)}
        flush
      >
        <table className="rowtable">
          <tbody>
            {d.evacuation.breakdown.map((b) => (
              <tr key={b.label}>
                <td style={{ color: 'var(--fg-2)', width: 190 }}>{b.label}</td>
                <td className="mononum">{b.value}</td>
                <td style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{b.note ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ padding: 'var(--s-3) var(--s-5)', borderTop: '1px solid var(--line-1)' }}>
          {d.evacuation.assumptions.map((a) => (
            <div key={a} style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', padding: '1px 0' }}>
              — {a}
            </div>
          ))}
        </div>
        <ProvLine p={d.evacuation.provenance} />
      </Block>

      <Block title="Routing" flush collapsible>
        <div className="empty" style={{ padding: 'var(--s-5)' }}>
          <strong>Not in this build</strong>
          The routing page (origin to camp, primary plus alternates, segment risk, blockage
          recomputation) is scoped out of the current round. The scenario identifier is wired and
          ready: <span className="mono">{d.routingScenarioId}</span>.
        </div>
      </Block>
    </>
  );
}

/* ----------------------------------------------------------- short-term */

function ShortTermBody({ d, id }: { d: ShortTermTier; id: string }) {
  return (
    <>
      <TierRationale status={d.flag.status} rationale={d.flag.rationale} since={d.flag.since} />

      <Block
        title="Static susceptibility"
        aux={`score ${d.susceptibility.score.toFixed(1)}`}
        flush collapsible>
        <FactorTable a={d.susceptibility} />
      </Block>

      <Block title="Published hazard classification" aux="ingested sheets" flush collapsible>
        <PublishedBlock id={id} />
      </Block>

      <Block title="Exposure" flush collapsible>
        <table className="rowtable">
          <tbody>
            {[d.exposure.structures, d.exposure.population, d.exposure.households, d.exposure.footprintHa].map(
              (f) => (
                <tr key={f.label}>
                  <td style={{ color: 'var(--fg-2)', width: 190 }}>{f.label}</td>
                  <td className="mononum" style={{ width: 90 }}>
                    {f.value}
                  </td>
                  <td>
                    <span style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{f.derivation}</span>
                  </td>
                  <td className="r">
                    <ProvChip p={f.provenance} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        <ProvLine p={d.exposure.structures.provenance} />
      </Block>

      <Block
        title="Seasonal window"
        aux={d.window.currentlyActive ? 'active' : 'inactive'}
        flush collapsible>
        <div className="block-body">
          <dl className="kv">
            <dt>Activates</dt>
            <dd className="mono">{d.window.activates}</dd>
            <dt>Lifts</dt>
            <dd className="mono">{d.window.lifts}</dd>
            <dt>Status</dt>
            <dd style={{ color: d.window.currentlyActive ? 'var(--sev-high-fg)' : 'var(--fg-2)' }}>
              {d.window.currentlyActive ? 'Active now' : 'Not active'}
            </dd>
            <dt>Basis</dt>
            <dd style={{ color: 'var(--fg-1)' }}>{d.window.basis}</dd>
          </dl>
        </div>
        <ProvLine p={d.window.provenance} />
      </Block>

      <Block title="Candidate transitional sites" aux={`${d.sites.length}`} flush>
        <table className="rowtable">
          <thead>
            <tr>
              <th>Site</th>
              <th className="r">Distance</th>
              <th className="r">Units</th>
              <th>Readiness</th>
            </tr>
          </thead>
          <tbody>
            {d.sites.map((s) => (
              <tr key={s.id}>
                <td>
                  <span style={{ color: 'var(--fg-0)' }}>{s.name}</span>
                  <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                    {s.type}
                    {s.note ? ` · ${s.note}` : ''}
                  </span>
                </td>
                <td className="r mononum">{s.distanceKm.toFixed(1)} km</td>
                <td className="r mononum">{int(s.unitsAvailable)}</td>
                <td>{s.readiness}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ProvLine p={d.sites[0].provenance} />
      </Block>
    </>
  );
}

/* ------------------------------------------------------------ long-term */

function LongTermBody({ h, d }: { h: Habitation; d: LongTermTier }) {
  const accepted = d.candidates
    .filter((c) => c.verdict === 'ACCEPTED')
    .sort((a, b) => b.suitability.score - a.suitability.score);
  const rejected = d.candidates.filter((c) => c.verdict === 'REJECTED');

  return (
    <>
      <TierRationale status={d.flag.status} rationale={d.flag.rationale} since={d.flag.since} />

      {d.flag.status === 'WITHHELD' ? (
        <div
          style={{
            padding: 'var(--s-4) var(--s-5)',
            background: '#2a2109',
            borderBottom: '1px solid var(--line-2)',
            color: '#e8c96a',
            fontSize: 'var(--fs-sm)',
            lineHeight: 1.45,
          }}
        >
          {d.candidates.length} candidate destinations were assessed and all {d.candidates.length}{' '}
          were disqualified. This is not the same as no action being required — the habitation
          remains flagged for immediate and short-term action, and the long-term tier reopens as
          soon as a viable site is identified.
        </div>
      ) : null}

      <Block title="Why mitigation is insufficient" flush collapsible>
        <div className="block-body" style={{ borderBottom: '1px solid var(--line-1)' }}>
          <div style={{ fontSize: 'var(--fs-sm)', lineHeight: 1.45 }}>{d.mitigationRejection.summary}</div>
        </div>
        <table className="rowtable">
          <thead>
            <tr>
              <th>Option considered</th>
              <th>Verdict</th>
              <th className="r">Indicative cost</th>
            </tr>
          </thead>
          <tbody>
            {d.mitigationRejection.options.map((o) => (
              <tr key={o.option}>
                <td>
                  <span style={{ color: 'var(--fg-0)' }}>{o.option}</span>
                  <span style={{ display: 'block', color: 'var(--fg-2)', fontSize: 'var(--fs-xs)', marginTop: 2 }}>
                    {o.reason}
                  </span>
                </td>
                <td style={{ color: 'var(--sev-high-fg)', whiteSpace: 'nowrap' }}>{o.verdict}</td>
                <td className="r mononum">{o.indicativeCost ?? '--'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ProvLine p={d.mitigationRejection.provenance} />
      </Block>

      <Block
        title="Ranked destinations"
        aux={`${accepted.length} accepted · ${rejected.length} rejected · ranked on suitability`}
        flush
      >
        {accepted.map((c, i) => (
          <SiteCard key={c.id} c={c} rank={i + 1} required={h.households} />
        ))}
        {rejected.map((c) => (
          <SiteCard key={c.id} c={c} rank={null} required={h.households} />
        ))}
      </Block>
    </>
  );
}

function SiteCard({
  c,
  rank,
  required,
}: {
  c: CandidateSite;
  rank: number | null;
  required: number;
}) {
  const [open, setOpen] = useState(rank === 1);
  const rejected = c.verdict === 'REJECTED';

  return (
    <div style={{ borderBottom: '1px solid var(--line-2)' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-4)',
          width: '100%',
          background: rejected ? 'var(--bg-0)' : 'var(--bg-2)',
          border: 0,
          borderLeft: `3px solid ${rejected ? 'var(--fg-3)' : 'var(--sev-low)'}`,
          padding: 'var(--s-3) var(--s-5)',
          textAlign: 'left',
        }}
      >
        <span className="routecard-rank">{rank !== null ? `#${rank}` : '--'}</span>
        <span style={{ flex: 1 }}>
          <span style={{ color: rejected ? 'var(--fg-2)' : 'var(--fg-0)', fontSize: 'var(--fs-sm)' }}>
            {c.name}
          </span>
          <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
            {c.block} block · {c.district} · {c.distanceKm.toFixed(1)} km
          </span>
        </span>
        <span className={`badge ${rejected ? 'reject' : 'accept'}`}>{c.verdict}</span>
        <span className="mono" style={{ color: rejected ? 'var(--fg-3)' : BAND_TEXT[c.suitability.band], minWidth: 38, textAlign: 'right' }}>
          {c.suitability.score.toFixed(1)}
        </span>
        <span style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{open ? '−' : '+'}</span>
      </button>

      {rejected && c.disqualifier ? (
        <div
          style={{
            padding: 'var(--s-3) var(--s-5)',
            background: '#241010',
            borderTop: '1px solid var(--line-1)',
            fontSize: 'var(--fs-xs)',
            color: '#ff9c8e',
            lineHeight: 1.45,
          }}
        >
          <b style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 400 }}>
            Disqualified — {c.disqualifier.factor}
          </b>
          <div style={{ color: 'var(--fg-1)', marginTop: 2 }}>
            Observed <span className="mono">{c.disqualifier.observed}</span> against threshold{' '}
            <span className="mono">{c.disqualifier.threshold}</span>. {c.disqualifier.rule}
          </div>
        </div>
      ) : null}

      {open ? (
        <>
          <div className="panel-figs" style={{ margin: 0, border: 0, borderTop: '1px solid var(--line-1)' }}>
            <Fig label="Distance" value={`${c.distanceKm.toFixed(1)} km`} />
            <Fig
              label="Households"
              value={int(c.capacity.households)}
              sub={`need ${int(required)}`}
            />
            <Fig label="Livability" value={c.livability.score.toFixed(1)} sub="Module 4" />
            <Fig label="Land" value={c.land.acquisitionStatus.split(';')[0]} mono={false} />
          </div>

          <Block title="Site suitability breakdown" aux={`score ${c.suitability.score.toFixed(1)}`} flush collapsible>
            <FactorTable a={c.suitability} dense />
          </Block>

          <Block title="Carrying capacity" aux={`${int(c.capacity.households)} households`} flush collapsible>
            <table className="rowtable">
              <tbody>
                <tr>
                  <td style={{ color: 'var(--fg-2)', width: 210 }}>Gross area</td>
                  <td className="r mononum" style={{ width: 80 }}>
                    {c.capacity.grossHa.toFixed(1)} ha
                  </td>
                  <td />
                </tr>
                {c.capacity.exclusions.map((e) => (
                  <tr key={e.label}>
                    <td style={{ color: 'var(--fg-2)', paddingLeft: 'var(--s-6)' }}>less {e.label}</td>
                    <td className="r mononum" style={{ color: 'var(--sev-high-fg)' }}>
                      −{e.ha.toFixed(1)} ha
                    </td>
                    <td style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{e.basis}</td>
                  </tr>
                ))}
                <tr>
                  <td style={{ color: 'var(--fg-0)' }}>Net developable</td>
                  <td className="r mononum">{c.capacity.netDevelopableHa.toFixed(1)} ha</td>
                  <td />
                </tr>
                <tr>
                  <td style={{ color: 'var(--fg-2)', paddingLeft: 'var(--s-6)' }}>
                    less infrastructure overhead
                  </td>
                  <td className="r mononum" style={{ color: 'var(--sev-high-fg)' }}>
                    −{c.capacity.infraOverheadPct}%
                  </td>
                  <td style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                    roads, drains, school, anganwadi, commons
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--fg-0)' }}>Residential area</td>
                  <td className="r mononum">{c.capacity.residentialHa.toFixed(1)} ha</td>
                  <td />
                </tr>
                <tr>
                  <td style={{ color: 'var(--fg-2)' }}>Plot norm</td>
                  <td className="r mononum">{c.capacity.plotNormCents} cent</td>
                  <td style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                    = {c.capacity.plotNormHa.toFixed(6)} ha. State-specific R&amp;R norm, shown as a
                    parameter.
                  </td>
                </tr>
              </tbody>
              <tfoot>
                <tr>
                  <td style={{ color: 'var(--fg-0)', fontWeight: 600 }}>Households accommodated</td>
                  <td
                    className="r mononum"
                    style={{
                      fontWeight: 600,
                      color:
                        c.capacity.households >= required ? 'var(--sev-low-fg)' : 'var(--sev-vhigh-fg)',
                    }}
                  >
                    {int(c.capacity.households)}
                  </td>
                  <td style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                    against {int(required)} required
                  </td>
                </tr>
              </tfoot>
            </table>
            <ProvLine p={c.capacity.provenance} />
          </Block>

          <Block title="Livability" aux={<><AssessmentHead a={c.livability} /></>} flush collapsible>
            <FactorTable a={c.livability} dense />
          </Block>

          <Block title="Land status" flush collapsible>
            <div className="block-body">
              <dl className="kv">
                <dt>Classification</dt>
                <dd>{c.land.classification}</dd>
                <dt>Ownership</dt>
                <dd>{c.land.ownership}</dd>
                <dt>Acquisition</dt>
                <dd>{c.land.acquisitionStatus}</dd>
                <dt>Encumbrances</dt>
                <dd>
                  {c.land.encumbrances.length === 0
                    ? 'None recorded'
                    : c.land.encumbrances.join('; ')}
                </dd>
              </dl>
            </div>
            <ProvLine p={c.land.provenance} />
          </Block>
        </>
      ) : null}
    </div>
  );
}

