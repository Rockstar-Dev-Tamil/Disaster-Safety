import { PUBLISHED, PUBLISHED_SOURCE, type PublishedSample } from '../data/published';
import { OVERLAYS } from '../data/layers';
import { ProvChip } from './primitives';
import { dateOnly } from '../lib/format';

/* Colour comes from the overlay registry so a class reads identically here and
 * on the map. One definition, two surfaces. */
const CLASS_COLOR: Record<string, string> = Object.assign(
  {},
  ...OVERLAYS.filter((o) => o.classColors).map((o) => o.classColors),
);

const SHEET_KEYS = ['landslide', 'flood'] as const;

function nearestLine(s: PublishedSample) {
  if (!s.nearestM) return 'No mapped zone within 5 km.';
  const entries = Object.entries(s.nearestM).sort((a, b) => a[1] - b[1]);
  return entries.map(([c, m]) => `${c} ${m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`}`).join(' · ');
}

/** Compact header row: what the publisher says about this ground. */
export function PublishedSummary({ id }: { id: string }) {
  const p = PUBLISHED[id];
  if (!p) return null;

  return (
    <div
      style={{
        marginTop: 'var(--s-4)',
        border: '1px solid var(--line-1)',
        background: 'var(--bg-0)',
      }}
    >
      {SHEET_KEYS.map((k) => {
        const s = p[k];
        if (!s) return null;
        const src = PUBLISHED_SOURCE[k];
        return (
          <div
            key={k}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--s-4)',
              padding: 'var(--s-2) var(--s-4)',
              borderBottom: '1px solid var(--line-1)',
              fontSize: 'var(--fs-xs)',
            }}
          >
            <span style={{ color: 'var(--fg-2)', width: 128, flex: 'none' }}>{src.label}</span>
            {s.insideZone && s.class ? (
              <>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    flex: 'none',
                    background: CLASS_COLOR[s.class] ?? 'var(--fg-3)',
                  }}
                />
                <span style={{ color: 'var(--fg-0)', flex: 1 }}>{s.class}</span>
                <span className="mono" style={{ color: 'var(--fg-3)' }}>
                  fid {s.fid}
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--fg-2)', flex: 1 }}>
                Outside mapped zones — nearest {nearestLine(s)}
              </span>
            )}
            <ProvChip p={{ status: 'LIVE', source: src.source, agency: src.agency }} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * Full block for the short-term tab.
 *
 * Shown NEXT TO the factor model, not instead of it. The published sheet gives
 * a class, not a weighted breakdown, so the two are different kinds of claim:
 * one is what the publisher assigns to this ground, the other is what this
 * model computes for it. Where they disagree, the officer needs to see the
 * disagreement rather than have it resolved silently in the data layer.
 */
export function PublishedBlock({ id }: { id: string }) {
  const p = PUBLISHED[id];
  if (!p) {
    return (
      <div className="empty" style={{ padding: 'var(--s-5)' }}>
        <strong>Outside ingested sheet coverage</strong>
        No published hazard sheet in this build covers this habitation. Only the Wayanad district
        landslide and flood sheets are ingested.
      </div>
    );
  }

  return (
    <>
      {SHEET_KEYS.map((k) => {
        const s = p[k];
        if (!s) return null;
        const src = PUBLISHED_SOURCE[k];
        return (
          <div key={k} style={{ borderBottom: '1px solid var(--line-1)' }}>
            <table className="rowtable">
              <tbody>
                <tr>
                  <td style={{ color: 'var(--fg-2)', width: 168 }}>Sheet</td>
                  <td colSpan={2}>{src.label}</td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--fg-2)' }}>Assigned class</td>
                  <td colSpan={2}>
                    {s.insideZone && s.class ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                        <span
                          style={{
                            width: 11,
                            height: 11,
                            background: CLASS_COLOR[s.class] ?? 'var(--fg-3)',
                            display: 'block',
                          }}
                        />
                        <span style={{ color: 'var(--fg-0)' }}>{s.class}</span>
                        <span className="mono" style={{ color: 'var(--fg-3)' }}>
                          feature {s.fid}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--fg-2)' }}>
                        Not inside any mapped polygon of this sheet
                      </span>
                    )}
                  </td>
                </tr>
                {!s.insideZone ? (
                  <tr>
                    <td style={{ color: 'var(--fg-2)' }}>Nearest mapped zone</td>
                    <td colSpan={2} className="mononum">
                      {nearestLine(s)}
                    </td>
                  </tr>
                ) : null}
                <tr>
                  <td style={{ color: 'var(--fg-2)' }}>Determined by</td>
                  <td colSpan={2} style={{ color: 'var(--fg-2)' }}>
                    Point-in-polygon of the habitation centroid against the published sheet.
                    Centroid precision limits this: a habitation is an area, and the sheet boundary
                    is a line.
                  </td>
                </tr>
                <tr>
                  <td style={{ color: 'var(--fg-2)' }}>Assessed</td>
                  <td colSpan={2} className="mononum">
                    {dateOnly(src.assessedOn)}
                  </td>
                </tr>
              </tbody>
            </table>
            <div className="provline">
              <ProvChip p={{ status: 'LIVE', source: src.source, agency: src.agency }} />
              <div>
                <span className="src">{src.source}</span> — {src.agency}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );
}
