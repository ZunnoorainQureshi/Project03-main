/**
 * Distractor generation.
 *
 * Strategy (per question):
 *  1. One **near-neighbor** distractor: a term that appears in the same
 *     sentence as the answer (or the closest sentence that contains one).
 *  2. One **same-POS, same-length** distractor: a keyterm whose length
 *     is within ±40% of the answer's length.
 *  3. One **length-matched random** distractor from the global pool.
 *
 * Lemma dedup is applied across the answer + all distractors.
 */

import type { ScoredTerm } from './score';
import type { CandidateTerm } from './nlp';

export interface DistractorContext {
  answer: CandidateTerm;
  /** All terms found in the answer's sentence (case-insensitive set). */
  sentenceTerms: CandidateTerm[];
  /** Global keyterm pool (sorted by score, descending). */
  keyterms: ScoredTerm[];
  /** All keyterm lemmas (for fast membership tests). */
  keytermSet: Set<string>;
  /** All keyterm lemmas seen in the answer's sentence. */
  sentenceLemmaSet: Set<string>;
  /** Total sentence count (for "random term from elsewhere" sampling). */
  rng: () => number;
}

function lengthMatch(a: string, b: string): boolean {
  const la = a.length;
  const lb = b.length;
  return la > 0 && lb > 0 && lb >= la * 0.6 && lb <= la * 1.4;
}

function pickFromList<T>(list: T[], rng: () => number, avoid: Set<string>, key: (x: T) => string): T | undefined {
  // Reservoir-style: shuffle indices with rng, pick first that satisfies.
  const idx = list.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  for (const i of idx) {
    const v = list[i];
    if (!avoid.has(key(v))) return v;
  }
  return undefined;
}

export function buildDistractors(ctx: DistractorContext): string[] {
  const { answer, sentenceTerms, keyterms, keytermSet, sentenceLemmaSet, rng } = ctx;
  const avoid = new Set<string>([answer.lemma]);
  const out: string[] = [];

  // ── 1. Near-neighbor from same sentence (if any)
  if (sentenceTerms.length > 0) {
    const nn = pickFromList(sentenceTerms, rng, avoid, (t) => t.lemma);
    if (nn) {
      out.push(nn.text);
      avoid.add(nn.lemma);
    }
  }

  // ── 2. Same-POS, length-matched keyterm
  const lenMatched = keyterms.filter(
    (k) => k.lemma !== answer.lemma && lengthMatch(answer.text, k.text)
  );
  const sm = pickFromList(lenMatched, rng, avoid, (k) => k.lemma);
  if (sm) {
    out.push(sm.text);
    avoid.add(sm.lemma);
  }

  // ── 3. Random length-matched keyterm from global pool
  const fallback = keyterms.filter((k) => lengthMatch(answer.text, k.text));
  const fb = pickFromList(fallback, rng, avoid, (k) => k.lemma);
  if (fb) {
    out.push(fb.text);
    avoid.add(fb.lemma);
  }

  // ── 4. Final fallback: any noun from anywhere
  let safety = 16;
  while (out.length < 3 && safety-- > 0) {
    const candidate = keyterms[Math.floor(rng() * keyterms.length)];
    if (candidate && !avoid.has(candidate.lemma)) {
      out.push(candidate.text);
      avoid.add(candidate.lemma);
    }
  }

  return out.slice(0, 3);
}

export { sentenceLemmaSet, keytermSet };
