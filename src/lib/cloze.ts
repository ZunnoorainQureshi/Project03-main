/**
 * Cloze selection — pick the best term to mask in a given sentence.
 *
 *  - Easy:   prefer long, frequent, unambiguous terms.
 *  - Medium: default (top score × position weight).
 *  - Hard:   prefer rare terms, acronyms, multi-word phrases.
 */

import { extractTerms, type CandidateTerm } from './nlp';
import {
  lengthBonus,
  positionWeight,
  scoreLemma,
  buildCorpus,
} from './score';
import type { ScoredTerm, CorpusStats } from './score';
import type { Difficulty } from './types';

export interface ClozeChoice {
  term: CandidateTerm;
  /** The sentence with the term replaced by `_____`. */
  masked: string;
  /** Position (token index) of the term in the sentence. */
  position: number;
}

function findTermSpan(
  sentence: string,
  term: string
): { start: number; end: number } | null {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Avoid relying on `\b` because terms can include punctuation (e.g. "A/B", "e.g.").
  // Ensure the match is not embedded inside a larger alphanumeric/"word-like" token.
  const re = new RegExp(
    `(^|[^A-Za-z0-9_])(${escaped})(?=([^A-Za-z0-9_]|$))`,
    'i'
  );

  const m = re.exec(sentence);
  if (!m) return null;

  // m[2] is the actual matched term.
  const start = m.index + m[1].length;
  const end = start + m[2].length;
  return { start, end };
}

export function pickCloze(
  sentence: string,
  stats: CorpusStats,
  difficulty: Difficulty,
  rng: () => number
): ClozeChoice | null {
  const candidates = extractTerms(sentence);
  if (candidates.length === 0) return null;

  // Reject sentences where the term would be at the very edge.
  const tokens = sentence.split(/\s+/);
  const total = tokens.length;
  if (total < 8) return null;
  const sentenceTf = new Map<string, number>();
  for (const c of candidates) {
    sentenceTf.set(c.lemma, (sentenceTf.get(c.lemma) ?? 0) + 1);
  }

  const scored = candidates.map((c) => {
    const tf = sentenceTf.get(c.lemma) ?? 1;
    let score = scoreLemma(c.lemma, tf, stats);
    score += lengthBonus(c.text) * 0.5;

    if (difficulty === 'easy') {
      if (c.isAcronym) score -= 0.8; // skip acronyms
      if (c.isGeneric) score -= 0.6;
    } else if (difficulty === 'hard') {
      if (c.isAcronym) score += 1.0;
      if (c.isProper && !c.isAcronym) score += 0.4;
      if (c.isGeneric) score -= 1.0;
    } else {
      if (c.isGeneric) score -= 0.3;
    }

    // Find span & position weight.
    const span = findTermSpan(sentence, c.text);
    if (!span) return { c, score: -1, position: -1, masked: sentence };

    const upto = sentence.slice(0, span.start);
    const position = upto.split(/\s+/).length - 1;
    const pw = positionWeight(position, total);
    score *= pw;

    // Easy mode: prefer terms in the middle 60% of the sentence.
    if (difficulty === 'easy' && (position < 2 || position > total - 3)) score -= 0.5;

    // Multi-word bonuses for hard mode.
    if (c.text.includes(' ') && difficulty === 'hard') score += 0.5;

    return { c, score, position, span };
  });

  // `span` is optional in the intermediate scored objects.
  const valid = scored.filter((s): s is typeof s & { span: { start: number; end: number } } => {
    return s.score > 0 && !!s.span;
  });

  if (valid.length === 0) return null;

  // Easy: pick highest score deterministically; Medium: same; Hard: add
  // small jitter so the rare-term bias doesn't always pick the same one.
  valid.sort((a, b) => b.score - a.score);
  const chosen =
    difficulty === 'hard' && valid.length > 1
      ? valid[Math.floor(rng() * Math.min(3, valid.length))]
      : valid[0];

  const { start, end } = chosen.span;
  const masked = sentence.slice(0, start) + '_____' + sentence.slice(end);
  return { term: chosen.c, masked, position: chosen.position };
}

export type { ScoredTerm };
