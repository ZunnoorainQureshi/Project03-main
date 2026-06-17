/**
 * NLP helpers — noun/acronym extraction built on top of `compromise`.
 * We keep the surface tiny: we only need candidate terms per sentence,
 * with a flag for "is this likely a key term?".
 */

import nlp from 'compromise';
import { GENERIC_NOUNS, STOPWORDS } from './text';

export interface CandidateTerm {
  /** Original surface form (preserves case). */
  text: string;
  /** Lowercased lemma-ish form for dedup. */
  lemma: string;
  /** True if the term is uppercased and short (likely an acronym). */
  isAcronym: boolean;
  /** True if the term starts with a capital inside a sentence. */
  isProper: boolean;
  /** True if the term is a generic noun we should deprioritise. */
  isGeneric: boolean;
}

const ACRONYM_RE = /^[A-Z][A-Z0-9&.-]{1,7}$/;
const CODE_NOISE_RE = /[{};]|=>|::|<\/?[a-z]/i;

export function extractTerms(sentence: string): CandidateTerm[] {
  if (CODE_NOISE_RE.test(sentence)) return [];

  const doc = nlp(sentence);
  const nouns = doc.nouns().out('array') as string[];
  // Also try terms (multi-word noun phrases).
  const phrases = doc.match('#Noun+').out('array') as string[];

  const seen = new Set<string>();
  const out: CandidateTerm[] = [];

  for (const raw of [...new Set([...nouns, ...phrases])]) {
    const text = raw.trim();
    if (!text) continue;
    if (text.length < 3 || text.length > 40) continue;

    const lemma = text.toLowerCase().replace(/[^a-z0-9'\s-]/g, '');
    if (!lemma || lemma.length < 3) continue;
    if (STOPWORDS.has(lemma)) continue;
    if (seen.has(lemma)) continue;
    seen.add(lemma);

    const firstChar = text[0];
    const isAcronym = ACRONYM_RE.test(text);
    const isProper = !!firstChar && firstChar === firstChar.toUpperCase() && /[A-Z]/.test(firstChar) && !isAcronym;
    const isGeneric = GENERIC_NOUNS.has(lemma);

    out.push({ text, lemma, isAcronym, isProper, isGeneric });
  }

  return out;
}
