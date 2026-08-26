/* Formatting helpers. Every figure that reaches the screen goes through one of
 * these, so grouping and precision stay uniform across panels. */

const IN = new Intl.NumberFormat('en-IN');

export const int = (n: number) => IN.format(Math.round(n));

export const dec1 = (n: number) => n.toFixed(1);

export const pct = (n: number) => `${Math.round(n)}%`;

/** Coordinates are always mono and always 4 dp. */
export const coord = ([lng, lat]: [number, number]) =>
  `${lat.toFixed(4)} N  ${lng.toFixed(4)} E`;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parses an ISO string with an explicit offset and renders it in that offset,
 *  never in the viewer's local zone -- an operator reads IST regardless of
 *  where the browser happens to be. */
function parts(iso: string) {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return {
    y: +m[1],
    mo: +m[2],
    d: +m[3],
    h: +m[4],
    mi: +m[5],
  };
}

export function ts(iso?: string): string {
  if (!iso) return '--';
  const p = parts(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')} ${MON[p.mo - 1]} ${p.y} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')} IST`;
}

export function tsShort(iso?: string): string {
  if (!iso) return '--';
  const p = parts(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')} ${MON[p.mo - 1]} ${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

export function dateOnly(iso?: string): string {
  if (!iso) return '--';
  const p = parts(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')} ${MON[p.mo - 1]} ${p.y}`;
}

/** Minutes elapsed since an ISO timestamp, against a fixed scenario clock.
 *  Used for the T+ age counter so "current" is honest rather than fabricated. */
export function ageMinutes(iso: string, now: string): number {
  const a = parts(iso);
  const b = parts(now);
  if (!a || !b) return 0;
  const toMin = (p: NonNullable<ReturnType<typeof parts>>) =>
    ((p.y * 12 + p.mo) * 31 + p.d) * 1440 + p.h * 60 + p.mi;
  return toMin(b) - toMin(a);
}

export function durationShort(mins: number): string {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
