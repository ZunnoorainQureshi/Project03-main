/**
 * TF / DF / TF-IDF scoring across the document.
 * We treat each paragraph (block separated by blank lines) as a "document"
 * for IDF purposes. Sentences are queried against this paragraph corpus.
 */

import { extractTerms, type CandidateTerm } from './nlp';
import { splitSentences, tokenize } from './text';

export interface ScoredTerm extends CandidateTerm {
  /** Higher = more important. */
  score: number;
  /** Document frequency. */
  df: number;
  /** Position weight: 1.0 mid-sentence, ~0.6 at extremes. */
  positionWeight: number;
  /** Length-bonus component (kept for debugging). */
  lengthBonus: number;
}

export interface CorpusStats {
  /** df.get(lemma) → number of paragraphs containing it. */
  df: Map<string, number>;
  /** Total paragraph count. */
  N: number;
  /** Per-paragraph token sets, for quick lookup. */
  paragraphTokens: Set<string>[];
}

/** Build a paragraph-keyed corpus. */
function buildCorpus(text: string): { paragraphs: string[]; stats: CorpusStats } {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 40);

  const paragraphTokens = paragraphs.map((p) => new Set(tokenize(p)));
  const df = new Map<string, number>();
  for (const tokens of paragraphTokens) {
    for (const t of tokens) {
      df.set(t, (df.get(t) ?? 0) + 1);
    }
  }

  return {
    paragraphs,
    stats: { df, N: paragraphTokens.length, paragraphTokens },
  };
}

/** Inverse document frequency with smoothing. */
export function idf(df: number, N: number): number {
  return Math.log((1 + N) / (1 + df)) + 1;
}

/** Score a term (lemma) given corpus statistics. */
export function scoreLemma(
  lemma: string,
  sentenceTf: number,
  stats: CorpusStats
): number {
  const df = stats.df.get(lemma) ?? 0;
  if (df === 0) return 0;
  const idfScore = idf(df, stats.N);
  return sentenceTf * idfScore;
}

/** Length bonus (capped). */
export function lengthBonus(text: string): number {
  return Math.min(1.5, Math.log2(Math.max(1, text.length)) * 0.5);
}

/** Position weight: prefers mid-sentence terms. */
export function positionWeight(index: number, total: number): number {
  if (total <= 1) return 1;
  const center = (total - 1) / 2;
  const dist = Math.abs(index - center) / center; // 0..1
  return 1 - 0.4 * dist;
}

/**
 * Pre-compute the top keyterms (lemma → ScoredTerm) across the whole
 * document. We use this for: (a) the global distractor pool, (b) tuning
 * the cloze selection for Hard mode (where we want rarer terms).
 */
export function computeKeyterms(text: string, topN = 400): { keyterms: ScoredTerm[], stats: CorpusStats } {
  const { stats } = buildCorpus(text);
  const sentences = splitSentences(text);

  const acc = new Map<string, ScoredTerm & { tf: number }>();
  for (const s of sentences) {
    const tokens = tokenize(s);
    if (!tokens.length) continue;
    const tf = new Map<string, number>();
    for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
    for (const [lemma, count] of tf) {
      const normTf = count / tokens.length;
      if (!acc.has(lemma)) {
        acc.set(lemma, {
          text: lemma,
          lemma,
          isAcronym: /^[A-Z][A-Z0-9&.-]{1,7}$/.test(lemma),
          isProper: /^[A-Z]/.test(lemma) && lemma.length > 1,
          isGeneric: false,
          score: 0,
          df: stats.df.get(lemma) ?? 0,
          positionWeight: 1,
          lengthBonus: 0,
          tf: normTf,
        });
      } else {
        acc.get(lemma)!.tf += normTf;
      }
    }
  }

  const out: ScoredTerm[] = [];
  for (const t of acc.values()) {
    if (t.df === 0) continue;
    const idfScore = idf(t.df, stats.N);
    let s = t.tf * idfScore;
    s += lengthBonus(t.text) * 0.5;
    if (t.isAcronym) s += 0.5;
    if (t.isProper) s += 0.25;
    out.push({ ...t, score: s });
  }

  out.sort((a, b) => b.score - a.score);
  return { keyterms: out.slice(0, topN), stats };
}

export { buildCorpus };
