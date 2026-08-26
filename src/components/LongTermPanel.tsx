import type { Habitation } from '../data/schema';
import {
  CONSTRUCTION_OBLIGATIONS,
  FACTOR_BASIS,
  FIELD_SURVEY_REQUIRED,
  UNADDRESSED_RISKS,
  type HostBand,
  type LongTermCandidate,
  type LongTermResult,
  type LongTermWeights,
} from '../lib/longterm';
import { int } from '../lib/format';

const LABEL: Record<keyof LongTermWeights, string> = {
  continuity: 'Community continuity',
  health: 'Health access',
  road: 'Road access',
  livelihood: 'Livelihood proxy',
  education: 'Education access',
  settlement: 'Settlement access',
  commons: 'Common property',
};

const BAND_COLOR: Record<HostBand, string> = {
  ABSORBED: 'var(--sev-low-fg)',
  STRAIN: 'var(--sev-mod-fg)',
  TRANSFORMATIVE: 'var(--sev-vhigh-fg)',
  UNKNOWN: 'var(--fg-3)',
};

const m = (v: number | null) =>
  v === null ? '—' : v < 1000 ? `${Math.round(v)} m` : `${(v / 1000).toFixed(1)} km`;

export function LongTermPanel({
  h,
  result,
  weights,
  selected,
  onSelect,
  eligiblePct,
}: {
  h: Habitation;
  result: LongTermResult;
  weights: LongTermWeights;
  selected: number | null;
  onSelect: (id: number | null) => void;
  eligiblePct: number;
}) {
  return (
    <>
      <section className="block">
        <div className="block-head">
          <span>Permanent tier · exclusions</span>
          <span className="aux">{eligiblePct.toFixed(1)}% eligible</span>
        </div>
        <div className="block-body">
          <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--fg-2)', lineHeight: 1.5 }}>
            Looser on gradient than a camp (15° against 5°, terracing is viable for a permanent
            build) and far stricter on everything else: <b>every</b> mapped landslide class is
            excluded rather than Medium and above, along with forest requiring diversion under the
            Forest (Conservation) Act 1980 and protected areas under the Wildlife Protection Act
            1972.
          </div>
        </div>
      </section>

      {result.withheld ? (
        <section className="block">
          <div className="block-head">
            <span>Long-term tier</span>
            <span className="aux" style={{ color: 'var(--flag-held)' }}>
              withheld
            </span>
          </div>
          <div
            style={{
              padding: 'var(--s-4) var(--s-5)',
              background: '#2a2109',
              color: '#e8c96a',
              fontSize: 'var(--fs-sm)',
              lineHeight: 1.5,
            }}
          >
            <b style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 400 }}>
              No viable destination
            </b>
            <div style={{ marginTop: 'var(--s-2)', color: 'var(--fg-1)' }}>
              {result.withheldReason}
            </div>
            <div style={{ marginTop: 'var(--s-3)', color: 'var(--fg-2)', fontSize: 'var(--fs-xs)' }}>
              This is an answer, not a failure, and it is not the same as "not flagged". The
              habitation still requires permanent resettlement; the tier reopens the moment a
              viable site is identified.
            </div>
          </div>
        </section>
      ) : (
        <section className="block">
          <div className="block-head">
            <span>Candidate destinations</span>
            <span className="aux">
              {result.candidates.length} pass · {result.failedCapacity} failed capacity
            </span>
          </div>
          <div
            style={{
              padding: 'var(--s-2) var(--s-5)',
              background: 'var(--bg-0)',
              borderBottom: '1px solid var(--line-1)',
              color: 'var(--fg-2)',
              fontSize: 'var(--fs-xs)',
              lineHeight: 1.4,
            }}
          >
            Capacity is a gate, not a score: {int(result.failedCapacity)} zones cleared every
            exclusion but cannot hold all {int(h.households)} households as one site. Centralised
            resettlement outperforms scattered on measured resilience, so a partial site is a
            failure rather than a partial success.
          </div>
          {result.candidates.slice(0, 12).map((c) => (
            <CandidateCard
              key={c.zone.id}
              c={c}
              weights={weights}
              selected={selected === c.zone.id}
              onSelect={() => onSelect(selected === c.zone.id ? null : c.zone.id)}
            />
          ))}
        </section>
      )}

      {/* ------------------------------------------------ evidence tiers --- */}
      <section className="block">
        <div className="block-head">
          <span>What this analysis cannot see</span>
        </div>
        <table className="rowtable">
          <tbody>
            {UNADDRESSED_RISKS.map((r) => (
              <tr key={r.risk}>
                <td style={{ color: 'var(--fg-2)', width: 190 }}>{r.risk}</td>
                <td style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{r.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="block-body" style={{ borderTop: '1px solid var(--line-1)' }}>
          <div className="field-label">Requires field survey</div>
          {FIELD_SURVEY_REQUIRED.map((f) => (
            <div key={f} style={{ color: 'var(--fg-2)', fontSize: 'var(--fs-xs)', padding: '1px 0' }}>
              — {f}
            </div>
          ))}
        </div>
        <div className="provline">
          <div>
            Three of Cernea's eight impoverishment risks can be addressed geospatially, two can only
            be proxied, and three cannot be seen at all. No composite livability score is produced,
            because resettlement fails on exactly the dimensions a GIS cannot measure — summing them
            would imply a completeness this does not have.
          </div>
        </div>
      </section>
    </>
  );
}

function CandidateCard({
  c,
  weights,
  selected,
  onSelect,
}: {
  c: LongTermCandidate;
  weights: LongTermWeights;
  selected: boolean;
  onSelect: () => void;
}) {
  const passed = c.compliance.filter((x) => x.pass).length;
  const maxC = Math.max(...Object.values(c.contributions));

  return (
    <div style={{ borderBottom: '1px solid var(--line-2)' }}>
      <button
        onClick={onSelect}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--s-4)',
          width: '100%',
          background: selected ? 'var(--bg-sel)' : 'var(--bg-2)',
          border: 0,
          borderLeft: `3px solid ${selected ? 'var(--accent)' : 'var(--line-3)'}`,
          padding: 'var(--s-3) var(--s-5)',
          textAlign: 'left',
        }}
      >
        <span className="routecard-rank">#{c.rank}</span>
        <span style={{ flex: 1 }}>
          <span style={{ color: 'var(--fg-0)', fontSize: 'var(--fs-sm)' }}>
            {c.zone.nearestTown ? `near ${c.zone.nearestTown.name}` : 'unnamed area'}
            {c.observed.talukName ? (
              <span style={{ color: 'var(--fg-3)' }}> · {c.observed.talukName}</span>
            ) : null}
          </span>
          <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
            {c.zone.areaHa.toFixed(0)} ha · {int(c.capacityGate.households)} households ·{' '}
            {c.observed.distOriginKm.toFixed(1)} km
          </span>
        </span>
        <span
          className="mono"
          style={{ color: passed >= 5 ? 'var(--sev-low-fg)' : 'var(--sev-mod-fg)' }}
          title="Third Schedule siting items passed"
        >
          {passed}/7
        </span>
        <span className="mono" style={{ color: 'var(--fg-0)', minWidth: 34, textAlign: 'right' }}>
          {c.score.toFixed(0)}
        </span>
        <span style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{selected ? '−' : '+'}</span>
      </button>

      {selected ? (
        <>
          {/* host impact */}
          <div
            style={{
              padding: 'var(--s-3) var(--s-5)',
              borderTop: '1px solid var(--line-1)',
              background: 'var(--bg-0)',
              fontSize: 'var(--fs-xs)',
              lineHeight: 1.45,
            }}
          >
            <span style={{ color: 'var(--fg-2)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              Host impact
            </span>
            <div style={{ marginTop: 2, color: 'var(--fg-1)' }}>
              {c.host.body ? (
                <>
                  <b className="mono">+{int(c.host.incomingPersons)}</b> into{' '}
                  {c.host.body.name} (population{' '}
                  <b className="mono">{int(c.host.body.population)}</b>) ={' '}
                  <b className="mono" style={{ color: BAND_COLOR[c.host.band] }}>
                    +{c.host.deltaPct.toFixed(1)}%
                  </b>{' '}
                  <span style={{ color: BAND_COLOR[c.host.band] }}>{c.host.band}</span>
                  <div style={{ color: 'var(--fg-3)', marginTop: 2 }}>
                    Service load falls on the host body — school seats, PHC and water. Assigned by
                    nearest local-body centroid, not by boundary.
                  </div>
                </>
              ) : (
                <span style={{ color: 'var(--fg-3)' }}>No population data for the nearest body.</span>
              )}
            </div>
          </div>

          {/* factor table */}
          <table className="ftable">
            <thead>
              <tr>
                <th>Factor · Cernea risk</th>
                <th className="r">Observed</th>
                <th className="r">Weight</th>
                <th className="r">Contribution</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(weights) as Array<keyof LongTermWeights>).map((k) => {
                const basis = FACTOR_BASIS[k];
                const raw =
                  k === 'continuity'
                    ? `${c.observed.distOriginKm.toFixed(1)} km${c.observed.sameTaluk ? ' · same taluk' : c.observed.sameTaluk === false ? ' · different taluk' : ''}`
                    : k === 'health'
                      ? m(c.observed.healthM)
                      : k === 'road'
                        ? m(c.observed.roadM)
                        : k === 'education'
                          ? m(c.observed.schoolM)
                          : k === 'settlement'
                            ? m(c.observed.townM)
                            : k === 'commons'
                              ? m(c.observed.commonsM)
                              : 'land-use match';
                return (
                  <tr key={k}>
                    <td>
                      {LABEL[k]}
                      <span className="fnote">
                        {basis.risk}
                        {basis.tier === 'PROXIED' ? ' · PROXY' : ''}
                      </span>
                    </td>
                    <td className="r mononum">{raw}</td>
                    <td className="r mononum">{weights[k].toFixed(2)}</td>
                    <td className="r mononum">
                      {c.contributions[k].toFixed(1)}
                      <span className="cbar">
                        <i style={{ width: `${maxC > 0 ? (c.contributions[k] / maxC) * 100 : 0}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Weighted sum</td>
                <td className="r mononum">
                  {Object.values(weights).reduce((a, b) => a + b, 0).toFixed(2)}
                </td>
                <td className="r mononum">{c.score.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>

          {/* statutory compliance */}
          <div className="block-head" style={{ borderTop: '1px solid var(--line-2)' }}>
            <span>RFCTLARR Third Schedule · siting</span>
            <span className="aux">{passed} of 7</span>
          </div>
          <table className="rowtable">
            <tbody>
              {c.compliance.map((it) => (
                <tr key={it.item}>
                  <td style={{ width: 26, color: it.pass ? 'var(--sev-low-fg)' : 'var(--sev-vhigh-fg)' }}>
                    {it.pass ? '✓' : '✗'}
                  </td>
                  <td>
                    <span style={{ color: 'var(--fg-0)' }}>
                      item {it.item} · {it.label}
                    </span>
                    <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
                      {it.requirement}
                    </span>
                  </td>
                  <td className="r mononum" style={{ width: 74 }}>
                    {m(it.observedM)}
                  </td>
                  <td className="r mononum" style={{ width: 68, color: 'var(--fg-3)' }}>
                    ≤ {m(it.thresholdM)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div
            style={{
              padding: 'var(--s-3) var(--s-5)',
              borderTop: '1px solid var(--line-1)',
              color: 'var(--fg-2)',
              fontSize: 'var(--fs-xs)',
              lineHeight: 1.45,
            }}
          >
            <b style={{ color: 'var(--fg-1)', fontWeight: 400 }}>
              {CONSTRUCTION_OBLIGATIONS.length} further Third Schedule items are construction
              obligations, not siting tests
            </b>{' '}
            — drainage, drinking water, anganwadi, Panchayat Ghar, electricity and the rest. A site
            cannot pass or fail on them; the acquirer must build them, and they belong in the
            project cost rather than the site score.
            {c.directionDeltaDeg !== null ? (
              <div style={{ marginTop: 'var(--s-2)' }}>
                Bearing differs from the short-term destination by{' '}
                <span className="mono">{c.directionDeltaDeg.toFixed(0)}°</span>
                {c.directionDeltaDeg > 90
                  ? ' — this would move people in a different direction from the camp, meaning two moves rather than one.'
                  : ' — consistent with the camp direction.'}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
