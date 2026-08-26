import { useState, type ReactNode } from 'react';
import type { Habitation, HazardType, TierKey } from '../data/schema';
import { HAZARD_LABEL } from '../data/schema';
import { OVERLAYS, isIngested } from '../data/layers';
import { BAND_FILL, BAND_LABEL, BAND_RANGE, BAND_TEXT, BAND_ORDER, bandFor } from '../lib/severity';
import { FlagDot, ProvChip } from './primitives';
import type { Basemap, ScoreField } from './MapCanvas';
import { int } from '../lib/format';

export interface Filters {
  hazards: Set<HazardType>;
  states: string;
  threshold: number;
  scoreField: ScoreField;
  tiers: Set<TierKey>;
}

const HAZARDS: HazardType[] = ['LANDSLIDE', 'FLOOD', 'CYCLONE', 'COASTAL_EROSION', 'CLOUDBURST'];
const TIERS: Array<[TierKey, string]> = [
  ['IMMEDIATE', 'Immediate'],
  ['SHORT_TERM', 'Short-term'],
  ['LONG_TERM', 'Long-term'],
];

/**
 * A rail group that can fold away.
 *
 * Same contract as `Block`: the head keeps the STATE ("dim", "5/5", "3 active")
 * so folding a group never hides what it is currently doing -- only the
 * controls that set it. The rail is a filter surface, and an officer reads its
 * current settings far more often than they change them.
 */
function RailSection({
  title,
  count,
  children,
  collapsible,
  defaultOpen = true,
  style,
}: {
  title: string;
  count?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  style?: React.CSSProperties;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!collapsible) {
    return (
      <section className="rail-section" style={style}>
        <div className="rail-head">
          <span>{title}</span>
          {count ? <span className="count">{count}</span> : null}
        </div>
        {children}
      </section>
    );
  }
  return (
    <section className={`rail-section${open ? ' open' : ''}`} style={style}>
      <button className="rail-head disclose" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="caret" aria-hidden />
        <span>{title}</span>
        {count ? <span className="count">{count}</span> : null}
      </button>
      <div className="collapse">{children}</div>
    </section>
  );
}

export function SideRail({
  filters,
  setFilters,
  results,
  all,
  states,
  selectedId,
  onSelect,
  overlayId,
  setOverlayId,
  basemap,
  setBasemap,
}: {
  filters: Filters;
  setFilters: (f: Filters) => void;
  results: Habitation[];
  all: Habitation[];
  states: string[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  overlayId: string | null;
  setOverlayId: (id: string | null) => void;
  basemap: Basemap;
  setBasemap: (b: Basemap) => void;
}) {
  const patch = (p: Partial<Filters>) => setFilters({ ...filters, ...p });

  const toggleHazard = (h: HazardType) => {
    const next = new Set(filters.hazards);
    if (next.has(h)) next.delete(h);
    else next.add(h);
    patch({ hazards: next });
  };

  const toggleTier = (t: TierKey) => {
    const next = new Set(filters.tiers);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    patch({ tiers: next });
  };

  const hazardCount = (h: HazardType) => all.filter((x) => x.hazards.includes(h)).length;
  const tierCount = (t: TierKey) => all.filter((x) => x.tiers[t] === 'FLAGGED').length;

  return (
    <aside className="rail">
      {/* ----------------------------------------------------- basemap --- */}
      <RailSection
        title="Basemap"
        count={basemap === 'off' ? 'none' : basemap}
        collapsible
        defaultOpen={false}
      >
        <div className="rail-body">
          <div className="seg">
            {(['off', 'dim', 'terrain'] as Basemap[]).map((b) => (
              <button key={b} className={basemap === b ? 'on' : ''} onClick={() => setBasemap(b)}>
                {b === 'off' ? 'None' : b === 'dim' ? 'Dim' : 'Terrain'}
              </button>
            ))}
          </div>
          <div className="fig-sub" style={{ marginTop: 'var(--s-3)' }}>
            Hillshade only — no boundaries. Use None on a projector.
          </div>
        </div>
      </RailSection>

      {/* ---------------------------------------------------- overlays --- */}
      <RailSection
        title="Overlay"
        count={`${OVERLAYS.filter(isIngested).length}/${OVERLAYS.length} ingested`}
      >
        <div className="rail-body">
          <label className="chk">
            <input
              type="radio"
              name="overlay"
              checked={overlayId === null}
              onChange={() => setOverlayId(null)}
            />
            <span className="chk-box" />
            <span className="chk-label">None</span>
          </label>
          {OVERLAYS.map((l) => {
            const on = isIngested(l);
            return (
              <label
                className="chk"
                key={l.id}
                title={on ? l.meaning : `${l.meaning}\n\nNot ingested — no URL wired.`}
              >
                <input
                  type="radio"
                  name="overlay"
                  disabled={!on}
                  checked={overlayId === l.id}
                  onChange={() => setOverlayId(l.id)}
                />
                <span className="chk-box" />
                <span className="chk-label" style={!on ? { color: 'var(--fg-3)' } : undefined}>
                  {l.label}
                </span>
                {!on ? <ProvChip p={l.provenance} /> : null}
              </label>
            );
          })}
        </div>
      </RailSection>

      {/* ------------------------------------------------------- score --- */}
      <RailSection
        title="Score basis"
        count={
          filters.threshold > 0
            ? `${filters.scoreField} · ≥${filters.threshold}`
            : filters.scoreField
        }
        collapsible
        defaultOpen={false}
      >
        <div className="rail-body">
          <div className="field">
            <div className="seg">
              <button
                className={filters.scoreField === 'current' ? 'on' : ''}
                onClick={() => patch({ scoreField: 'current' })}
              >
                Current
              </button>
              <button
                className={filters.scoreField === 'susceptibility' ? 'on' : ''}
                onClick={() => patch({ scoreField: 'susceptibility' })}
              >
                Susceptibility
              </button>
            </div>
            <div className="fig-sub" style={{ marginTop: 'var(--s-3)' }}>
              {filters.scoreField === 'current'
                ? 'Operational state at the picture timestamp. Moves with the feed.'
                : 'Standing terrain assessment. Moves only on reassessment.'}
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="threshold">
              Risk threshold — at or above {filters.threshold}
            </label>
            <input
              id="threshold"
              className="inp"
              type="range"
              min={0}
              max={100}
              step={1}
              value={filters.threshold}
              onChange={(e) => patch({ threshold: Number(e.target.value) })}
            />
          </div>
        </div>
      </RailSection>

      {/* ------------------------------------------------------ hazard --- */}
      <RailSection
        title="Hazard type"
        count={`${filters.hazards.size}/${HAZARDS.length}`}
        collapsible
        defaultOpen={false}
      >
        <div className="rail-body">
          {HAZARDS.map((h) => (
            <label className="chk" key={h}>
              <input type="checkbox" checked={filters.hazards.has(h)} onChange={() => toggleHazard(h)} />
              <span className="chk-box" />
              <span className="chk-label">{HAZARD_LABEL[h]}</span>
              <span className="chk-count">{int(hazardCount(h))}</span>
            </label>
          ))}
        </div>
      </RailSection>

      {/* ------------------------------------------------- tier filter --- */}
      <RailSection
        title="Tier membership"
        count={filters.tiers.size ? `${filters.tiers.size} active` : 'any'}
        collapsible
        defaultOpen={false}
      >
        <div className="rail-body">
          {TIERS.map(([k, label]) => (
            <label className="chk" key={k}>
              <input type="checkbox" checked={filters.tiers.has(k)} onChange={() => toggleTier(k)} />
              <span className="chk-box" />
              <span className="chk-label">{label}</span>
              <span
                className="chk-count"
                title="Independent flags — a habitation may hold several tiers, so these do not sum"
              >
                {int(tierCount(k))}
              </span>
            </label>
          ))}
        </div>
      </RailSection>

      {/* ------------------------------------------------------- state --- */}
      <RailSection
        title="State"
        count={filters.states || 'all'}
        collapsible
        defaultOpen={false}
      >
        <div className="rail-body">
          <select className="inp" value={filters.states} onChange={(e) => patch({ states: e.target.value })}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </RailSection>

      {/* ----------------------------------------------------- results --- */}
      <section
        className="rail-section"
        style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      >
        <div className="rail-head">
          <span>Habitations</span>
          <span className="count">{int(results.length)}</span>
        </div>
        <div className="hitlist">
          {results.slice(0, 400).map((h) => {
            const score = filters.scoreField === 'current' ? h.current.score : h.susceptibility.score;
            const band = bandFor(score);
            return (
              <button
                key={h.id}
                className={`hit${selectedId === h.id ? ' sel' : ''}`}
                onClick={() => onSelect(h.id)}
                data-hit={h.id}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    background: BAND_FILL[band],
                    display: 'block',
                  }}
                />
                <span>
                  <span className="hit-name">{h.name}</span>
                  <span className="hit-sub" style={{ display: 'block' }}>
                    {h.district}, {h.state}
                  </span>
                </span>
                <span className="hit-score" style={{ color: BAND_TEXT[band] }}>
                  {score.toFixed(1)}
                </span>
              </button>
            );
          })}
          {results.length === 0 ? (
            <div className="empty">
              <strong>No habitations match</strong>
              Widen the threshold or re-enable a hazard type. Filters are conjunctive.
            </div>
          ) : null}
          {results.length > 400 ? (
            <div className="empty" style={{ color: 'var(--fg-3)' }}>
              Showing first 400 of {int(results.length)}. Narrow the filters to see the rest.
            </div>
          ) : null}
        </div>
      </section>

      {/* ------------------------------------------------------ legend --- */}
      <RailSection title="Severity class" collapsible defaultOpen={false}>
        <div className="rail-body">
          {[...BAND_ORDER].reverse().map((b) => (
            <div className="legend-row" key={b}>
              <span
                style={{
                  width: 10,
                  height: 10,
                  background: BAND_FILL[b],
                  border: '1px solid #0b0c0e',
                  display: 'block',
                }}
              />
              <span className="lbl">{BAND_LABEL[b]}</span>
              <span className="rng">{BAND_RANGE[b]}</span>
            </div>
          ))}
          <div className="legend-note">
            Ramp is monotonic in lightness and survives red-green colour vision deficiency.
            Marker size and stroke weight carry severity redundantly; the score is always printed.
          </div>
        </div>
      </RailSection>

      <FlagLegend />
    </aside>
  );
}

function FlagLegend() {
  return (
    <RailSection title="Tier flag state" collapsible defaultOpen={false}>
      <div className="rail-body">
        <div className="legend-row">
          <FlagDot status="FLAGGED" />
          <span className="lbl">Flagged</span>
        </div>
        <div className="legend-row">
          <FlagDot status="WITHHELD" />
          <span className="lbl">Withheld</span>
        </div>
        <div className="legend-row">
          <FlagDot status="NOT_FLAGGED" />
          <span className="lbl">Not flagged</span>
        </div>
        <div className="legend-note">
          Withheld means criteria are met but no viable destination exists. It is not the same as
          not flagged, and must not be read as safe.
        </div>
      </div>
    </RailSection>
  );
}
