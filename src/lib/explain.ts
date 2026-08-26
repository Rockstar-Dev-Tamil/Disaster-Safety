/* ============================================================================
 * EXPLANATION ENGINE
 *
 * This file is the seam. Everything above it -- the dock, the transcript, the
 * pending and error states -- is written against `ask()` and knows nothing
 * about where an answer comes from.
 *
 * Three sources, tried in order: a hosted model when one is configured (see
 * explain-model.ts), then a table of authored answers, then the fact bundle
 * itself. Any of them can fail or decline and the next one runs, so the docks
 * keep working with no key and no network -- just with blunter answers.
 *
 * THE CONTRACT, WHICH DOES NOT CHANGE WHEN THE MODEL ARRIVES
 * ---------------------------------------------------------
 * An answer may narrate ONLY figures that are already on screen in the same
 * scope. It may not reach for outside knowledge, and it may not compute a new
 * number. This is not a stylistic preference: the whole defensibility claim of
 * the console is that every figure traces to a weighted overlay an officer can
 * reproduce. An answer containing a number the overlay never produced would
 * launder a guess into that chain.
 *
 * So the panel does not pass a question. It passes a QUESTION PLUS THE FACTS
 * IT IS CURRENTLY DISPLAYING, and the answer is checked back against those
 * facts before it is ever rendered -- see `validate()`. When the model is
 * wired in, the bundle becomes its context and the validator becomes the gate
 * on its output. A model cannot be trusted not to invent a figure; it can be
 * prevented from having one displayed.
 * ==========================================================================*/

import type { ExplainScope } from '../data/schema';
import { explain as lookup } from '../data/explanations';
import { askModel, configured } from './explain-model';

/* ------------------------------------------------------------- bundle --- */

export interface Fact {
  /** Stable key, used as the citation handle. */
  key: string;
  /** How the figure is labelled on screen. Matched against the question. */
  label: string;
  /** Rendered exactly as the panel renders it. */
  value: string;
  /** Extra words that should match this fact but are not in the label. */
  aka?: string[];
}

/** Everything the calling panel currently has on screen, and nothing else. */
export interface FactBundle {
  scope: ExplainScope;
  /** What the panel is about, e.g. "Chooralmala — short-term tier". */
  subject: string;
  facts: Fact[];
}

/* ------------------------------------------------------------ answers --- */

export type TurnState = 'pending' | 'answered' | 'ungrounded' | 'failed';

export interface Turn {
  id: number;
  question: string;
  state: TurnState;
  text: string;
  /** Fact keys the answer drew on, for the "drawn from" line. */
  sources: string[];
  /** Set when the answer named a figure the bundle does not contain. */
  offending?: string[];
}

/* ---------------------------------------------------------- validation --- */

/** Numerals that carry no claim on their own and should not be checked. */
const BENIGN = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '100']);

const numerals = (s: string) =>
  (s.match(/-?\d[\d,]*\.?\d*/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.$/, ''));

/**
 * Every number an answer states must already appear in the bundle.
 *
 * This is the gate that makes a language model safe to put here. It cannot
 * check that an answer is *right*, but it can guarantee the answer did not
 * introduce a quantity the console never computed -- which is the failure mode
 * that would actually cost an officer their case.
 */
export function validate(text: string, bundle: FactBundle): string[] {
  const known = new Set<string>();
  for (const f of bundle.facts) for (const n of numerals(f.value)) known.add(n);
  return numerals(text).filter((n) => !known.has(n) && !BENIGN.has(n));
}

/* ---------------------------------------------------------------- ask --- */

/** Facts whose label or aliases share a meaningful word with the question. */
function relevant(question: string, bundle: FactBundle): Fact[] {
  const words = question
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
  if (!words.length) return [];
  return bundle.facts.filter((f) => {
    const hay = `${f.label} ${(f.aka ?? []).join(' ')}`.toLowerCase();
    return words.some((w) => hay.includes(w));
  });
}

/**
 * Answer a question about a panel.
 *
 * Async and artificially delayed on purpose: the pending state has to be a
 * real state that the interface is built around, not something bolted on the
 * day the network call arrives.
 */
export async function ask(
  bundle: FactBundle,
  question: string,
  signal?: AbortSignal,
): Promise<Omit<Turn, 'id' | 'question'>> {
  /* 0. The hosted model, when one is configured.
   *
   *    Its answer is put through the SAME gate as any other generated text --
   *    a model is exactly the kind of author the validator exists for. An
   *    answer naming a figure this panel does not display is withheld, not
   *    shown with a caveat.
   *
   *    Any failure falls through to the offline paths below rather than
   *    surfacing an error. A venue with bad wifi should degrade to slightly
   *    blunter answers, not to a dead panel. */
  if (configured()) {
    try {
      const reply = await askModel(bundle, question, signal);
      if (reply.answerable && reply.answer.trim()) {
        const bad = validate(reply.answer, bundle);
        return {
          state: bad.length ? 'ungrounded' : 'answered',
          text: reply.answer.trim(),
          sources: reply.usedFacts,
          offending: bad.length ? bad : undefined,
        };
      }
      /* The model said the facts cannot answer it. That is a real answer, but
       * the authored table may still have something, so keep going. */
    } catch (err) {
      if ((err as DOMException)?.name === 'AbortError') throw err;
      console.warn('[explain] model backend unavailable, using offline answers:', err);
    }
  } else {
    /* Keeps the pending state honest offline: without it the reply lands in
     * the same frame as the question and the transcript looks pre-baked. */
    await new Promise((r) => setTimeout(r, 420));
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  /* 1. Authored answers first. Hand-written for the questions an officer
   *    actually asks, and richer than anything assembled from labels.
   *
   *    NOT put through the validator, deliberately. These strings are source
   *    code: they are reviewed at commit, and they legitimately cite published
   *    constants the live bundle has no reason to carry -- the 1:50,000 sheet
   *    scale, a statutory distance, the Sphere floor. Validating them flagged
   *    a correct answer as ungrounded purely because "1:50,000" is not a
   *    number the panel displays. The validator exists to gate text NOBODY
   *    reviewed, which is exactly what a hosted model will produce. */
  const authored = lookup(bundle.scope, question);
  if (!('miss' in authored)) {
    return { state: 'answered', text: authored.text, sources: authored.sources };
  }

  /* 2. Otherwise read the question against what the panel is displaying and
   *    report those figures back verbatim. Assembling the answer FROM the
   *    bundle rather than from prose means the wireframe already obeys the
   *    contract the model will have to obey. */
  const hits = relevant(question, bundle);
  if (hits.length) {
    const list = hits.map((f) => `${f.label} is ${f.value}`).join('; ');
    const text = `On ${bundle.subject}, the panel currently shows: ${list}.`;
    /* Generated text goes through the gate. Trivially clean today, because it
     * is assembled from the bundle -- but this is the path a model's answer
     * will take, and it should already be closed before the model arrives. */
    const bad = validate(text, bundle);
    return {
      state: bad.length ? 'ungrounded' : 'answered',
      text,
      sources: hits.map((f) => f.label),
      offending: bad.length ? bad : undefined,
    };
  }

  /* 3. Say so. A miss is a correct answer -- the alternative is reaching for
   *    general knowledge, which is the one thing this surface must never do. */
  return {
    state: 'answered',
    text:
      `Nothing on this panel answers that. This scope covers ${bundle.subject}, ` +
      `and can only report figures it is displaying: ` +
      `${bundle.facts.slice(0, 6).map((f) => f.label.toLowerCase()).join(', ')}. ` +
      `Ask about one of those, or open the panel that carries the figure.`,
    sources: [],
  };
}
