import {
  DEFAULT_ROUTE_PARAMS,
  RISK_COLOR,
  RISK_LABEL,
  type Route,
  type RouteParams,
  type RouteResult,
  type RouteSegment,
} from '../lib/routing';
import type { Zone } from '../lib/zones';
import { int } from '../lib/format';

function mins(m: number) {
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h ? `${h} h ${r} min` : `${r} min`;
}

export function RoutePanel({
  zone,
  result,
  params,
  setParams,
  blocked,
  onToggleBlock,
  selectedRoute,
  onSelectRoute,
  replanNote,
  offNetwork,
}: {
  zone: Zone;
  result: RouteResult | null;
  params: RouteParams;
  setParams: (p: RouteParams) => void;
  blocked: Set<number>;
  onToggleBlock: (edgeIndex: number) => void;
  selectedRoute: number;
  onSelectRoute: (id: number) => void;
  replanNote: string | null;
  /** Straight-line legs from origin to the network and network to the zone. */
  offNetwork: { startKm: number; endKm: number } | null;
}) {
  return (
    <section className="block">
      <div className="block-head">
        <span>Step 7 · Routes to this zone</span>
        <span className="aux">
          {result?.routes.length ?? 0} found
          {blocked.size ? ` · ${blocked.size} blocked` : ''}
        </span>
      </div>

      {replanNote ? (
        <div className="recompute-log">
          <span className="hd">Recomputed</span>
          {replanNote}
        </div>
      ) : null}

      {/* ------------------------------------------------------ params --- */}
      <div className="block-body" style={{ borderBottom: '1px solid var(--line-1)' }}>
        <div className="field">
          <label className="field-label">
            Risk aversion — <span className="mono">{params.riskAversion.toFixed(2)}</span>
          </label>
          <input
            className="inp"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={params.riskAversion}
            onChange={(e) => setParams({ ...params, riskAversion: Number(e.target.value) })}
          />
          <div className="fig-sub">
            0 = fastest route, 1 = safest. Blends segment time against segment risk in the cost.
          </div>
        </div>

        <div className="field">
          <label className="field-label">Highest class a convoy may be committed to</label>
          <div className="seg">
            {([1, 2, 3, 4] as const).map((c) => (
              <button
                key={c}
                className={params.maxAcceptableClass === c ? 'on' : ''}
                onClick={() => setParams({ ...params, maxAcceptableClass: c })}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <label className="chk">
          <input
            type="checkbox"
            checked={params.nightOperation}
            onChange={(e) => setParams({ ...params, nightOperation: e.target.checked })}
          />
          <span className="chk-box" />
          <span className="chk-label">Night operation (speeds derated 20%)</span>
        </label>

        <button
          className="railbtn"
          style={{ marginTop: 'var(--s-3)' }}
          onClick={() => setParams(DEFAULT_ROUTE_PARAMS)}
        >
          Reset routing parameters
        </button>
      </div>

      {/* ------------------------------------------------------ result --- */}
      {!result || !result.reachable ? (
        <div className="empty" style={{ padding: 'var(--s-5)' }}>
          <strong>No route to this zone</strong>
          The road network holds no path from the origin to the nearest junction serving this zone
          {blocked.size ? ' with the current blockages in force' : ''}. That is a decision, not an
          error: this zone cannot be used, and the shortlist should fall to the next one.
        </div>
      ) : (
        <>
          {result.observationRequired.length > 0 ? (
            <div
              style={{
                padding: 'var(--s-4) var(--s-5)',
                background: '#241010',
                borderBottom: '1px solid var(--line-2)',
                color: '#ff9c8e',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.5,
              }}
            >
              <b style={{ letterSpacing: '0.06em', textTransform: 'uppercase', fontWeight: 400 }}>
                Observation required
              </b>
              <div style={{ marginTop: 'var(--s-2)', color: 'var(--fg-1)' }}>
                No route clears class {params.maxAcceptableClass}. Every option crosses at least one
                segment above it. Send ground observation on these before committing a convoy:
              </div>
              <ul style={{ margin: 'var(--s-3) 0 0', paddingLeft: 18 }}>
                {result.observationRequired.map((s) => (
                  <li key={s.edgeIndex} style={{ color: 'var(--fg-1)', marginBottom: 2 }}>
                    <span style={{ color: RISK_COLOR[s.risk.cls] }}>class {s.risk.cls}</span>{' '}
                    {s.name} — {s.risk.drivers[0]}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {result.routes.map((r) => (
            <RouteCard
              key={r.id}
              r={r}
              selected={selectedRoute === r.id}
              onSelect={() => onSelectRoute(r.id)}
              blocked={blocked}
              onToggleBlock={onToggleBlock}
              maxAcceptable={params.maxAcceptableClass}
            />
          ))}

          {offNetwork && offNetwork.startKm + offNetwork.endKm > 0.05 ? (
            <div
              style={{
                padding: 'var(--s-3) var(--s-5)',
                borderTop: '1px solid var(--line-1)',
                background: 'var(--bg-0)',
                color: 'var(--fg-2)',
                fontSize: 'var(--fs-xs)',
                lineHeight: 1.45,
              }}
            >
              Off-network legs, shown dashed:{' '}
              <span className="mono">{offNetwork.startKm.toFixed(2)} km</span> from the habitation
              to the mapped network and{' '}
              <span className="mono">{offNetwork.endKm.toFixed(2)} km</span> from the network to the
              zone. The graph carries tertiary roads and above, so the last approach into a hamlet
              or onto open ground is not routed and its time is not in the total above.
            </div>
          ) : null}

          <div className="provline">
            <div>
              Routes rank on WORST segment, then time — never on mean risk, which would hide one
              impassable culvert inside 40 km of good road. Capacity at this zone is{' '}
              <span className="mono">{int(zone.capacityPersons)}</span> persons.
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function RouteCard({
  r,
  selected,
  onSelect,
  blocked,
  onToggleBlock,
  maxAcceptable,
}: {
  r: Route;
  selected: boolean;
  onSelect: () => void;
  blocked: Set<number>;
  onToggleBlock: (i: number) => void;
  maxAcceptable: number;
}) {
  return (
    <div className={`routecard${selected ? ' sel' : ''}`}>
      <button className="routecard-head" onClick={onSelect}>
        <span className="routecard-rank">#{r.rank}</span>
        <span className="swatch" style={{ background: RISK_COLOR[r.worstClass] }} />
        <span className="routecard-name">
          {r.acceptable ? 'Acceptable' : `Exceeds class ${maxAcceptable}`}
          <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
            {r.segments.length} segments · worst {RISK_LABEL[r.worstClass]}
          </span>
        </span>
        <span className="mono" style={{ color: 'var(--fg-0)' }}>
          {mins(r.minutes)}
        </span>
      </button>

      <div className="routecard-figs">
        <div className="fig">
          <div className="fig-label">Distance</div>
          <div className="fig-val">{r.km.toFixed(1)} km</div>
        </div>
        <div className="fig">
          <div className="fig-label">Arrival</div>
          <div className="fig-val">{mins(r.minutes)}</div>
        </div>
        <div className="fig">
          <div className="fig-label">Worst segment</div>
          <div className="fig-val" style={{ color: RISK_COLOR[r.worstClass] }}>
            {r.worstClass}
          </div>
        </div>
        <div className="fig">
          <div className="fig-label">Mean risk</div>
          <div className="fig-val">{r.meanRisk.toFixed(0)}</div>
          <div className="fig-sub">not ranked on</div>
        </div>
      </div>

      {selected ? (
        <div>
          {r.segments.map((s) => (
            <SegmentRow
              key={`${s.edgeIndex}-${s.from}`}
              s={s}
              blocked={blocked.has(s.edgeIndex)}
              onToggle={() => onToggleBlock(s.edgeIndex)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SegmentRow({
  s,
  blocked,
  onToggle,
}: {
  s: RouteSegment;
  blocked: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`segrow${blocked ? ' blocked' : ''}`} title={s.risk.drivers.join(' · ')}>
      <span className="segbar" style={{ background: RISK_COLOR[s.risk.cls] }} />
      <span className="segname">
        {s.name}
        <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
          {s.risk.drivers[0]}
        </span>
      </span>
      <span className="segnum">{s.km.toFixed(2)} km</span>
      <span className="segnum" style={{ color: RISK_COLOR[s.risk.cls] }}>
        c{s.risk.cls}
      </span>
      <button className={`blockbtn${blocked ? ' on' : ''}`} onClick={onToggle}>
        {blocked ? 'blocked' : 'block'}
      </button>
    </div>
  );
}
