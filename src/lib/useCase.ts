/* ============================================================================
 * ACTIVE CASE
 *
 * A tiny external store rather than React context, for two reasons. The case is
 * read in the top bar, both routes and the status strip -- a context provider
 * would have to wrap the whole app to serve four consumers. And it is read
 * OUTSIDE React too: the terrain loader needs to know which stack to fetch
 * before any component renders.
 *
 * Persisted, so a reload does not silently drop the officer back onto a
 * different event than the one they were working.
 * ==========================================================================*/

import { useSyncExternalStore } from 'react';
import { CASE_BY_ID, CASES, DEFAULT_CASE, type CaseDef, type CaseId } from '../data/cases';

const KEY = 'rzc.case';

function initial(): CaseId {
  try {
    const saved = localStorage.getItem(KEY) as CaseId | null;
    if (saved && CASE_BY_ID.has(saved)) return saved;
  } catch {
    /* Private windows and blocked storage both throw on read. Not worth
     * failing over -- fall through to the default. */
  }
  return DEFAULT_CASE;
}

let current: CaseId = initial();
const listeners = new Set<() => void>();

export function setCase(id: CaseId) {
  if (id === current || !CASE_BY_ID.has(id)) return;
  current = id;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* Storage is a convenience here, never a requirement. */
  }
  for (const fn of listeners) fn();
}

export const getCaseId = () => current;
export const getCase = (): CaseDef => CASE_BY_ID.get(current)!;

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The active case, re-rendering the caller when it changes. */
export function useCase(): CaseDef {
  const id = useSyncExternalStore(subscribe, getCaseId, () => DEFAULT_CASE);
  return CASE_BY_ID.get(id)!;
}

export { CASES };
