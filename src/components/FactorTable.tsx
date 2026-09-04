import type { Assessment } from '../data/schema';
import { contribution } from '../data/sources';
import { ProvChip, ProvLine } from './primitives';
import { BAND_TEXT } from '../lib/severity';

/**
 * The breakdown. Shows raw ground value, the normalisation that produced the
 * class score, the published weight, and the resulting contribution -- so the
 * headline number is visibly the arithmetic of the rows beneath it. The weight
 * column is footed with its own sum: if that is not 1.000 the model is wrong
 * and the officer should be able to see that without being told.
 */
export function FactorTable({ a, dense }: { a: Assessment; dense?: boolean }) {
  const maxContribution = Math.max(...a.factors.map(contribution));
  const weightSum = a.factors.reduce((s, f) => s + f.weight, 0);

  return (
    <>
      <table className="ftable">
        <thead>
          <tr>
            <th>Factor</th>
            {!dense && <th>Observed value</th>}
            <th className="r">Class</th>
            <th className="r">Weight</th>
            <th className="r">Contribution</th>
          </tr>
        </thead>
        <tbody>
          {a.factors.map((f) => (
            <tr key={f.key}>
              <td>
                {f.label}
                {f.provenance ? (
                  <>
                    {' '}
                    <ProvChip p={f.provenance} />
                  </>
                ) : null}
                {dense ? <span className="fnote">{f.raw}</span> : null}
                {!dense && f.scale ? <span className="fnote">{f.scale}</span> : null}
                {!dense && f.note ? <span className="fnote">{f.note}</span> : null}
              </td>
              {!dense && <td>{f.raw}</td>}
              <td className="r mononum">{f.normalised}</td>
              <td className="r mononum">{f.weight.toFixed(2)}</td>
              <td className="r mononum">
                {contribution(f).toFixed(1)}
                <span className="cbar">
                  <i style={{ width: `${(contribution(f) / maxContribution) * 100}%` }} />
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={dense ? 2 : 3}>
              {a.aggregation ?? 'Weighted sum'}
            </td>
            <td className="r mononum">{weightSum.toFixed(3)}</td>
            <td className="r mononum" style={{ color: BAND_TEXT[a.band] }}>
              {a.score.toFixed(1)}
            </td>
          </tr>
        </tfoot>
      </table>
      <ProvLine p={a.provenance} />
    </>
  );
}
