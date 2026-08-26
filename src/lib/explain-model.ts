/* ============================================================================
 * HOSTED MODEL BACKEND FOR THE EXPLANATION DOCKS
 *
 * The model is given the panel's fact bundle and nothing else, and is told it
 * may not introduce a figure that is not in it. That instruction is necessary
 * but not sufficient -- a model will occasionally ignore it -- so the answer is
 * put through `validate()` before anything is rendered. Prompt for grounding,
 * enforce it in code.
 *
 * TRANSPORT
 * ---------
 * Two paths, chosen by configuration:
 *
 *   VITE_EXPLAIN_PROXY  POST to your own endpoint, which holds the key. The
 *                       browser never sees it. Use this for anything deployed.
 *   VITE_OPENAI_API_KEY Browser calls OpenAI directly with the key compiled
 *                       into the bundle. Local development and laptop demos
 *                       only -- see .env.example.
 *
 * With neither set, `configured()` is false and the dock stays on the offline
 * matcher. That is also the fallback whenever a call fails, which matters more
 * than it sounds: this thing has to survive a hall with bad wifi.
 * ==========================================================================*/

import type { FactBundle } from './explain';

const KEY = import.meta.env.VITE_OPENAI_API_KEY as string | undefined;
const PROXY = import.meta.env.VITE_EXPLAIN_PROXY as string | undefined;
const MODEL = (import.meta.env.VITE_OPENAI_MODEL as string | undefined) || 'gpt-4o-mini';

export const configured = () => Boolean(PROXY || KEY);
export const backendLabel = () => (PROXY ? 'proxy' : KEY ? MODEL : 'offline');

/* --------------------------------------------------------------- prompt --- */

const SYSTEM = [
  'You explain figures on one panel of a disaster-management console to a State',
  'Disaster Management Authority officer who must defend a relocation decision.',
  '',
  'RULES, IN ORDER OF IMPORTANCE:',
  '1. You may only state figures that appear in the FACTS provided. Never',
  '   compute, estimate, convert, round or infer a new number. If a number is',
  '   not in FACTS, it does not go in your answer.',
  '2. Use no outside knowledge. You are not answering from what you know about',
  '   the world, only from what this panel is displaying.',
  '3. If FACTS cannot answer the question, say so plainly and name which facts',
  '   the panel does hold. A refusal is a correct answer here.',
  '4. Cite the label of every fact you used, in usedFacts, exactly as given.',
  '5. Be brief and concrete. Two or three sentences. No preamble, no hedging,',
  '   no restating the question. Write for someone who already knows the',
  '   domain.',
  '6. Quote figures exactly as they appear, including their units.',
].join('\n');

/** Structured output, so parsing is not a guessing game. */
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'usedFacts', 'answerable'],
  properties: {
    answer: { type: 'string' },
    usedFacts: { type: 'array', items: { type: 'string' } },
    answerable: {
      type: 'boolean',
      description: 'False when the supplied facts cannot answer the question.',
    },
  },
} as const;

function userMessage(bundle: FactBundle, question: string) {
  const facts = bundle.facts.map((f) => `- ${f.label}: ${f.value}`).join('\n');
  return `PANEL: ${bundle.subject}\n\nFACTS:\n${facts}\n\nQUESTION: ${question}`;
}

/* ------------------------------------------------------------------ call --- */

export interface ModelReply {
  answer: string;
  usedFacts: string[];
  answerable: boolean;
}

export async function askModel(
  bundle: FactBundle,
  question: string,
  signal?: AbortSignal,
): Promise<ModelReply> {
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: userMessage(bundle, question) },
    ],
    /* Low but not zero. The task is reporting, not composing. */
    temperature: 0.2,
    max_tokens: 400,
    response_format: {
      type: 'json_schema',
      json_schema: { name: 'explanation', strict: true, schema: SCHEMA },
    },
  };

  const url = PROXY || 'https://api.openai.com/v1/chat/completions';
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  /* The key is attached ONLY on the direct path. When a proxy is configured
   * the browser must not hold a key at all. */
  if (!PROXY && KEY) headers.authorization = `Bearer ${KEY}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`explain backend ${res.status}: ${detail.slice(0, 200)}`);
  }

  const json = await res.json();
  const raw = json?.choices?.[0]?.message?.content;
  if (typeof raw !== 'string') throw new Error('explain backend returned no content');

  const parsed = JSON.parse(raw) as ModelReply;
  if (typeof parsed.answer !== 'string') throw new Error('explain backend returned no answer');
  return {
    answer: parsed.answer,
    usedFacts: Array.isArray(parsed.usedFacts) ? parsed.usedFacts : [],
    answerable: parsed.answerable !== false,
  };
}
