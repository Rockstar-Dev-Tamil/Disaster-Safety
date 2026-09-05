import type { Habitation } from '../data/schema';
import {
  DEFAULT_RULES,
  DEFAULT_WEIGHTS,
  EXCLUSION,
  EXCLUSION_LABEL,
  type Rules,
  type Weights,
  shortlist as buildShortlist,
  type Zone,
  type ZoneResult,
} from '../lib/zones';
import { int } from '../lib/format';
import { Block } from './primitives';

const LANDUSE_LABEL: Record<number, string> = {
  0: 'Unmapped',
  2: 'Paddy',
  3: 'Open cultivated / plantation',
  4: 'Forest or scrub',
  5: 'Restricted',
  6: 'Built-up',
};

const WEIGHT_LABEL: Record<keyof Weights, string> = {
  area: 'Contiguous area',
  slope: 'Ground gradient',
  distOrigin: 'Proximity to origin',
  distRoad: 'Road access',
  distTown: 'Settlement access',
  drainage: 'Drainage margin',
  rain: 'Rain on site (moves with the clock)',
};

const SPHERE = 45;

export function ZonePanel({
  h,
  result,
  areas,
  mergeKm,
  zoom,
  rules,
  setRules,
  weights,
  setWeights,
  selected,
  onSelect,
  shortlistSize,
  setShortlistSize,
}: {
  h: Habitation;
  result: ZoneResult;
  areas: Zone[];
  mergeKm: number;
  zoom: number;
  rules: Rules;
  setRules: (r: Rules) => void;
  weights: Weights;
  setWeights: (w: Weights) => void;
  selected: number | null;
  onSelect: (id: number | null) => void;
  shortlistSize: number;
  setShortlistSize: (n: number) => void;
}) {
  const { stats } = result;
  const zones = areas;
  const picked = buildShortlist(zones, shortlistSize, rules.minSeparationKm);
  const shortlist = picked.map((p) => p.zone);
  const displacedBy = new Map(picked.map((p) => [p.zone.id, p.displaced]));

  /* A selection made on the map may not be in the shortlist. Work out which
   * zone it is and, more usefully, why it is not on the list. */
  /* Resolve through membership: after merging, the selected cluster id may now
   * live inside an area carrying a different id. */
  const matches = (z: Zone) =>
    selected !== null && (z.id === selected || z.memberIds.includes(selected));
  const offListSelection =
    selected !== null && !shortlist.some(matches) ? (zones.find(matches) ?? null) : null;
  const offListReason = (() => {
    if (!offListSelection) return '';
    const clash = picked.find((p) =>
      p.displaced.some((d) => d.rank === offListSelection.rank),
    );
    if (clash) {
      const d = clash.displaced.find((x) => x.rank === offListSelection.rank)!;
      return `Ranked #${offListSelection.rank} of ${zones.length}, but sits ${d.km.toFixed(1)} km from #${clash.zone.rank} — inside the ${rules.minSeparationKm} km separation rule.`;
    }
    return `Ranked #${offListSelection.rank} of ${zones.length}; the shortlist shows the top ${shortlistSize} after separation. Raise the shortlist size to include it.`;
  })();
  const totalCapacity = shortlist.reduce((a, z) => a + z.capacityPersons, 0);
  const shortfall = h.population - totalCapacity;

  const wSum = Object.values(weights).reduce((a, b) => a + b, 0);

  return (
    <>
      {/* --------------------------------------------------- eligibility --- */}
      <Block
        title="Step 3 · Exclusions"
        aux={`${int(Math.round(stats.eligibleHa))} ha · ${stats.eligiblePct.toFixed(1)}% eligible`}
        collapsible
        flush
      >
        <table className="rowtable">
          <tbody>
            {Object.entries(stats.byReason)
              .filter(([code]) => Number(code) !== EXCLUSION.OUTSIDE_RADIUS)
              .sort((a, b) => b[1] - a[1])
              .map(([code, n]) => {
                const c = Number(code);
                const pct = stats.cellsInRadius ? (n / stats.cellsInRadius) * 100 : 0;
                return (
                  <tr key={code}>
                    <td style={{ color: c === EXCLUSION.NONE ? 'var(--sev-low-fg)' : 'var(--fg-2)' }}>
                      {EXCLUSION_LABEL[c]}
                    </td>
                    <td className="r mononum" style={{ width: 78 }}>
                      {int(n * 1)}
                    </td>
                    <td className="r mononum" style={{ width: 58 }}>
                      {pct.toFixed(1)}%
                    </td>
                  </tr>
                );
              })}
          </tbody>
          <tfoot>
            <tr>
              <td>Eligible ground</td>
              <td className="r mononum">{int(Math.round(stats.eligibleHa))} ha</td>
              <td className="r mononum">{stats.eligiblePct.toFixed(1)}%</td>
            </tr>
          </tfoot>
        </table>
        <div className="provline">
          <div>First matching rule wins. Rules are hard constraints, not weights.</div>
        </div>
      </Block>

      {/* -------------------------------------------------------- rules --- */}
      <Block
        title="Constraint rules"
        aux={
          JSON.stringify(rules) === JSON.stringify(DEFAULT_RULES)
            ? 'published defaults'
            : 'modified'
        }
        collapsible
        flush
      >
        <div className="block-body">
          <Slider
            label="Max ground gradient"
            value={rules.maxSlopeDeg}
            min={2}
            max={15}
            step={0.5}
            unit="°"
            note="Sphere camp gradient 5–7% (≈4–5°)"
            onChange={(v) => setRules({ ...rules, maxSlopeDeg: v })}
          />
          <Slider
            label="Min drainage margin"
            value={rules.minDrainageMarginM}
            min={0}
            max={10}
            step={0.5}
            unit=" m"
            note="0 = off. Floodplain control is the published KSDMA flood layer; this is a local-relief proxy that duplicates it and fights the gradient limit."
            onChange={(v) => setRules({ ...rules, minDrainageMarginM: v })}
          />
          <label className="chk">
            <input
              type="checkbox"
              checked={rules.excludeBuiltUp}
              onChange={(e) => setRules({ ...rules, excludeBuiltUp: e.target.checked })}
            />
            <span className="chk-box" />
            <span className="chk-label">Exclude built-up land</span>
          </label>
          <label className="chk" style={{ marginBottom: 'var(--s-4)' }}>
            <input
              type="checkbox"
              checked={rules.excludePaddy}
              onChange={(e) => setRules({ ...rules, excludePaddy: e.target.checked })}
            />
            <span className="chk-box" />
            <span className="chk-label">Exclude paddy</span>
          </label>
          <Slider
            label="Shortlist separation"
            value={rules.minSeparationKm}
            min={0}
            max={20}
            step={1}
            unit=" km"
            note="Minimum spacing between shortlisted zones. 0 = rank only."
            onChange={(v) => setRules({ ...rules, minSeparationKm: v })}
          />
          <Slider
            label="Minimum zone size"
            value={rules.minZoneHa}
            min={1}
            max={60}
            step={1}
            unit=" ha"
            note={`1 cell = 1 ha · ${int(stats.clustersBelowFloor)} of ${int(stats.clustersFound)} clusters below floor · ${int(stats.removedByOpening)} cells removed as speckle`}
            onChange={(v) => setRules({ ...rules, minZoneHa: v })}
          />
          <button
            className="railbtn"
            style={{ marginTop: 'var(--s-3)' }}
            onClick={() => setRules(DEFAULT_RULES)}
            disabled={JSON.stringify(rules) === JSON.stringify(DEFAULT_RULES)}
          >
            Reset to published rules
          </button>
        </div>
      </Block>

      {/* ------------------------------------------------------ weights --- */}
      <Block title="Step 4 · Suitability weights" aux={`Σ ${wSum.toFixed(2)}`} collapsible flush>
        <div className="block-body">
          {(Object.keys(weights) as Array<keyof Weights>).map((k) => (
            <Slider
              key={k}
              label={WEIGHT_LABEL[k]}
              value={weights[k]}
              min={0}
              max={0.5}
              step={0.05}
              unit=""
              onChange={(v) => setWeights({ ...weights, [k]: v })}
            />
          ))}
          <button
            className="railbtn"
            style={{ marginTop: 'var(--s-3)' }}
            onClick={() => setWeights(DEFAULT_WEIGHTS)}
          >
            Reset to published weights
          </button>
        </div>
      </Block>

      {/* -------------------------------------------------------- zones --- */}
      <section className="block">
        <div className="block-head">
          <span>Step 5–6 · Candidate zones</span>
          <span className="aux">
            {int(zones.length)} {mergeKm > 0 ? 'areas' : 'zones'} · showing {shortlist.length}
          </span>
        </div>
        {mergeKm > 0 ? (
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
            {int(result.zones.length)} clusters merged within{' '}
            <span className="mono">{mergeKm.toFixed(1)} km</span> at z{zoom.toFixed(1)}, capacity
            pooled. Zoom in to separate.
          </div>
        ) : null}
        <div className="block-body" style={{ borderBottom: '1px solid var(--line-1)' }}>
          <div className="seg">
            {[5, 10, 20, 40].map((n) => (
              <button
                key={n}
                className={shortlistSize === n ? 'on' : ''}
                onClick={() => setShortlistSize(n)}
              >
                top {n}
              </button>
            ))}
          </div>
        </div>

        {zones.length === 0 ? (
          <div className="empty" style={{ padding: 'var(--s-5)' }}>
            <strong>No eligible ground within {rules.radiusKm} km</strong>
            Every cell in the operation radius fails at least one hard constraint. This is an
            answer, not an error: it means transitional camp siting is not available here and the
            operation must fall back on existing building stock or a wider radius.
          </div>
        ) : (
          <>
            {/* Every cluster is clickable on the map, so a selection can land
                outside the shortlist. Render its card anyway, with why it did
                not make the list -- otherwise clicking a dim ellipse
                highlights it and shows nothing. */}
            {offListSelection ? (
              <>
                <div
                  style={{
                    padding: 'var(--s-2) var(--s-5)',
                    background: 'var(--bg-0)',
                    borderBottom: '1px solid var(--line-1)',
                    fontSize: 'var(--fs-xs)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: 'var(--fg-2)',
                  }}
                >
                  Selected · not shortlisted
                </div>
                <ZoneCard
                  z={offListSelection}
                  displaced={[]}
                  offListReason={offListReason}
                  selected
                  onSelect={() => onSelect(null)}
                />
              </>
            ) : null}

            {shortlist.map((z) => (
              <ZoneCard
                key={z.id}
                z={z}
                displaced={displacedBy.get(z.id) ?? []}
                selected={matches(z)}
                onSelect={() => onSelect(matches(z) ? null : z.id)}
              />
            ))}

            <div
              style={{
                padding: 'var(--s-4) var(--s-5)',
                borderTop: '1px solid var(--line-2)',
                background: shortfall > 0 ? '#2a2109' : 'var(--bg-0)',
                fontSize: 'var(--fs-sm)',
                lineHeight: 1.45,
                color: shortfall > 0 ? '#e8c96a' : 'var(--fg-2)',
              }}
            >
              {shortfall > 0 ? (
                <>
                  Shortlist holds <b className="mono">{int(totalCapacity)}</b> of{' '}
                  <b className="mono">{int(h.population)}</b> — short by{' '}
                  <b className="mono">{int(shortfall)}</b>. Remainder needs existing building stock,
                  a wider radius, or relaxed gradient.
                </>
              ) : (
                <>
                  Shortlist holds <b className="mono">{int(totalCapacity)}</b> against{' '}
                  <b className="mono">{int(h.population)}</b> to be moved, at the Sphere norm of{' '}
                  {SPHERE} m² per person.
                </>
              )}
            </div>
          </>
        )}
      </section>

      <section className="block">
        <div className="block-head">
          <span>Step 7 · Routing</span>
          <span className="aux">not yet built</span>
        </div>
        <div className="empty" style={{ padding: 'var(--s-5)' }}>
          <strong>Reachability not yet assessed</strong>
          Zones are ranked on siting factors only. A zone that scores well but cannot be reached on
          a route below the risk threshold will drop off this list once routing lands — and the
          panel will say that it did, and why.
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- parts --- */

function ZoneCard({
  z,
  displaced,
  offListReason,
  selected,
  onSelect,
}: {
  z: Zone;
  displaced: Array<{ rank: number; km: number; score: number }>;
  offListReason?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const maxContribution = Math.max(...Object.values(z.contributions));
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
        <span className="routecard-rank">#{z.rank}</span>
        <span style={{ flex: 1 }}>
          <span style={{ color: 'var(--fg-0)', fontSize: 'var(--fs-sm)' }}>
            {z.nearestTown ? `near ${z.nearestTown.name}` : 'unnamed area'}
            {z.memberIds.length > 1 ? (
              <span style={{ color: 'var(--fg-3)' }}> · {z.memberIds.length} clusters</span>
            ) : null}
          </span>
          <span style={{ display: 'block', color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>
            {z.areaHa.toFixed(1)} ha · {z.distOriginKm.toFixed(1)} km from origin
          </span>
        </span>
        <span className="mono" style={{ color: 'var(--fg-0)', minWidth: 34, textAlign: 'right' }}>
          {z.score.toFixed(0)}
        </span>
        <span style={{ color: 'var(--fg-3)', fontSize: 'var(--fs-xs)' }}>{selected ? '−' : '+'}</span>
      </button>

      {selected ? (
        <>
          {offListReason ? (
            <div
              style={{
                padding: 'var(--s-3) var(--s-5)',
                borderTop: '1px solid var(--line-1)',
                background: '#2a2109',
                color: '#e8c96a',
                fontSize: 'var(--fs-xs)',
                lineHeight: 1.45,
              }}
            >
              {offListReason}
            </div>
          ) : null}
          <div className="panel-figs" style={{ margin: 0, border: 0, borderTop: '1px solid var(--line-1)' }}>
            <div className="fig">
              <div className="fig-label">Area</div>
              <div className="fig-val">{z.areaHa.toFixed(1)} ha</div>
            </div>
            <div className="fig">
              <div className="fig-label">Capacity</div>
              <div className="fig-val">{int(z.capacityPersons)}</div>
              <div className="fig-sub">at {SPHERE} m²/person</div>
            </div>
            <div className="fig">
              <div className="fig-label">Extent</div>
              <div className="fig-val">
                {Math.round(z.semiMajorM * 2)}×{Math.round(z.semiMinorM * 2)} m
              </div>
              <div className="fig-sub">indicative</div>
            </div>
            <div className="fig">
              <div className="fig-label">Road</div>
              <div className="fig-val">{Math.round(z.factors.distRoadM)} m</div>
              <div className="fig-sub">last leg</div>
            </div>
          </div>

          <table className="ftable">
            <thead>
              <tr>
                <th>Factor</th>
                <th className="r">Observed</th>
                <th className="r">Contribution</th>
              </tr>
            </thead>
            <tbody>
              <FactorRow
                name="Contiguous area"
                raw={`${z.areaHa.toFixed(0)} ha · ${int(z.capacityPersons)} persons`}
                c={z.contributions.area}
                max={maxContribution}
              />
              {/* Land use no longer scores: 74% of the grid is unmapped, so the
                  factor handed 0.6 to almost everything and discriminated
                  nothing. It survives as a hard exclusion, which did work. */}
              <tr>
                <td>Land use</td>
                <td className="r">{LANDUSE_LABEL[z.factors.landuse] ?? '—'}</td>
                <td className="r" style={{ color: 'var(--fg-3)' }}>
                  not scored
                </td>
              </tr>
              <FactorRow name="Ground gradient" raw={`${z.factors.slope.toFixed(1)}°`} c={z.contributions.slope} max={maxContribution} />
              <FactorRow name="Proximity to origin" raw={`${z.factors.distOriginKm.toFixed(1)} km`} c={z.contributions.distOrigin} max={maxContribution} />
              <FactorRow name="Road access" raw={`${Math.round(z.factors.distRoadM)} m`} c={z.contributions.distRoad} max={maxContribution} />
              <FactorRow name="Settlement access" raw={`${(z.factors.distTownM / 1000).toFixed(1)} km`} c={z.contributions.distTown} max={maxContribution} />
              <FactorRow name="Drainage margin" raw={`${z.factors.drainageM.toFixed(1)} m`} c={z.contributions.drainage} max={maxContribution} />
              {/* Only shown when a rain field was actually in the score. With
                  no grid the term is redistributed, not zeroed, so a row
                  reading 0.0 mm would misreport the ranking. */}
              {z.contributions.rain > 0 ? (
                <FactorRow name="Rain on site, this 3 h" raw={`${z.factors.rainMm.toFixed(1)} mm`} c={z.contributions.rain} max={maxContribution} />
              ) : null}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Weighted sum</td>
                <td className="r mononum">{z.score.toFixed(1)}</td>
              </tr>
            </tfoot>
          </table>

          {displaced.length ? (
            <div
              style={{
                padding: 'var(--s-3) var(--s-5)',
                borderTop: '1px solid var(--line-1)',
                background: 'var(--bg-0)',
                fontSize: 'var(--fs-xs)',
                color: 'var(--fg-2)',
                lineHeight: 1.45,
              }}
            >
              Displaced {displaced.length} higher-or-similar zone
              {displaced.length > 1 ? 's' : ''} for separation:{' '}
              {displaced
                .slice(0, 4)
                .map((d) => `#${d.rank} (${d.km.toFixed(1)} km, score ${d.score.toFixed(0)})`)
                .join(', ')}
              . Independence preferred over marginal score — a shortlist clustered on one hillside
              shares one failure.
            </div>
          ) : null}

          <div className="provline">
            <div>
              Ellipse is the second moment of the eligible cells in this cluster, drawn at two
              standard deviations. It marks where eligible ground clusters — it is not a site
              boundary, and at 100 m grid with 1:50,000 hazard input it could not be.
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function FactorRow({ name, raw, c, max }: { name: string; raw: string; c: number; max: number }) {
  return (
    <tr>
      <td>{name}</td>
      <td className="r mononum">{raw}</td>
      <td className="r mononum">
        {c.toFixed(1)}
        <span className="cbar">
          <i style={{ width: `${max > 0 ? (c / max) * 100 : 0}%` }} />
        </span>
      </td>
    </tr>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  note,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  note?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <label className="field-label">
        {label} — <span className="mono">{value.toFixed(unit === '' ? 2 : 1)}{unit}</span>
      </label>
      <input
        className="inp"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {note ? <div className="fig-sub">{note}</div> : null}
    </div>
  );
}
