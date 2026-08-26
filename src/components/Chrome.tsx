import { useEffect, useState } from 'react';
import type { Habitation, TierKey } from '../data/schema';
import { int, ts } from '../lib/format';
import { ALERT_TEXT } from '../lib/severity';
import { FlagDot } from './primitives';
import { Wordmark } from './Wordmark';

/* ---------------------------------------------------------------- top --- */

export function TopBar({ onShowKeys }: { onShowKeys: () => void }) {
  const hash = typeof window !== 'undefined' ? window.location.hash : '';
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <Wordmark height={27} />
        <span className="brand-sep" aria-hidden />
        <span className="brand-app">
          Red Zone Console
          <span className="org">Multi-hazard · Module 1</span>
        </span>
      </div>
      <nav className="topbar-nav">
        <a className={hash.startsWith('#/evac/') ? '' : 'active'} href="#/map">
          Red zone map
        </a>
        <a className={hash.startsWith('#/evac/') ? 'active' : ''} href={hash.startsWith('#/evac/') ? hash : '#/map'}>
          Evacuation planning
        </a>
      </nav>

      <div className="topbar-spacer" />
      <div className="topbar-right">
        <button
          onClick={onShowKeys}
          style={{
            background: 'transparent',
            border: '1px solid var(--line-2)',
            color: 'var(--fg-2)',
            fontSize: 'var(--fs-xs)',
            padding: '1px 6px',
          }}
          title="Keyboard shortcuts"
        >
          ? keys
        </button>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------- strip --- */

/** A habitation may hold several tiers at once, so the three counts overlap
 *  and do not sum to the total. Carried on the cells it qualifies rather than
 *  as a permanent line of prose in the strip. */
const TIER_CAVEAT = 'Independent flags — a habitation may hold several tiers, so these do not sum';

export function StatusStrip({
  clock,
  all,
  filtered,
}: {
  clock: string;
  all: Habitation[];
  filtered: Habitation[];
}) {
  /* The picture is frozen at a scenario timestamp. Rather than fabricate live
   * updates, the strip shows how OLD the picture is and ticks that. */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const advisories = all.filter((h) => h.current.alert === 'RED' || h.current.alert === 'ORANGE');
  const red = all.filter((h) => h.current.alert === 'RED').length;

  const tierCount = (t: TierKey, status: 'FLAGGED' | 'WITHHELD') =>
    all.filter((h) => h.tiers[t] === status).length;

  return (
    <footer className="statusstrip">
      <div className="ss-cell">
        <span className="ss-label">Picture as of</span>
        <span className="ss-val mono">{ts(clock)}</span>
      </div>
      <div className="ss-cell">
        <span className="ss-label">Session</span>
        <span className="ss-val mono">
          T+{String(Math.floor(tick / 60)).padStart(2, '0')}:{String(tick % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="ss-cell">
        <span className="ss-label">Advisories</span>
        <span className="ss-val mono">{int(advisories.length)}</span>
        <span style={{ color: ALERT_TEXT.RED }} className="mono">
          {int(red)} red
        </span>
      </div>
      <div className="ss-cell ss-tier" title={TIER_CAVEAT}>
        <span className="ss-label">Immediate</span>
        <FlagDot status="FLAGGED" />
        <span className="ss-val mono">{int(tierCount('IMMEDIATE', 'FLAGGED'))}</span>
      </div>
      <div className="ss-cell ss-tier" title={TIER_CAVEAT}>
        <span className="ss-label">Short-term</span>
        <FlagDot status="FLAGGED" />
        <span className="ss-val mono">{int(tierCount('SHORT_TERM', 'FLAGGED'))}</span>
      </div>
      <div className="ss-cell ss-tier" title={TIER_CAVEAT}>
        <span className="ss-label">Long-term</span>
        <FlagDot status="FLAGGED" />
        <span className="ss-val mono">{int(tierCount('LONG_TERM', 'FLAGGED'))}</span>
        <FlagDot status="WITHHELD" />
        <span className="ss-val mono" style={{ color: 'var(--flag-held)' }}>
          {int(tierCount('LONG_TERM', 'WITHHELD'))} withheld
        </span>
      </div>
      <div className="ss-cell">
        <span className="ss-label">In view</span>
        <span className="ss-val mono">
          {int(filtered.length)} / {int(all.length)}
        </span>
      </div>
      <div className="ss-cell ss-spacer" />
    </footer>
  );
}

/* -------------------------------------------------------------- keys --- */

const KEYS: Array<[string, string]> = [
  ['/', 'Focus habitation filter'],
  ['1 · 2 · 3', 'Switch to Immediate / Short-term / Long-term tab'],
  ['↑ ↓', 'Move through the filtered habitation list'],
  ['Enter', 'Open the highlighted habitation'],
  ['E', 'Focus the explanation input for the current scope'],
  ['C', 'Cycle the score basis (current / susceptibility)'],
  ['B', 'Cycle the basemap (none / dim / terrain)'],
  ['Esc', 'Close the habitation panel'],
  ['?', 'Show this sheet'],
];

export function KeyboardSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="kbdsheet" onClick={onClose}>
      <div className="kbdsheet-inner" onClick={(e) => e.stopPropagation()}>
        <div className="block-head">
          <span>Keyboard</span>
          <span className="aux">Esc to close</span>
        </div>
        {KEYS.map(([k, d]) => (
          <div className="kbdsheet-row" key={k}>
            <span className="kbd">{k}</span>
            <span style={{ color: 'var(--fg-1)' }}>{d}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
