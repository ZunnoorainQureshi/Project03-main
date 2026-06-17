/**
 * Top-level orchestrator: PDF text → Question[].
 *
 * Determinism: every random pick goes through the supplied `rng` so tests
 * can pin the seed. Production calls pass `Math.random`.
 */

import { extractPdf } from './pdf';
import { normaliseText, splitSentences } from './text';
import { computeKeyterms, type ScoredTerm } from './score';
import { pickCloze, type ClozeChoice } from './cloze';
import { buildDistractors } from './distractors';
import { extractTerms } from './nlp';
import type {
  Difficulty,
  GenerationOptions,
  GenerationPhase,
  Question,
} from './types';

function makeRng(seed?: number): () => number {
  if (seed === undefined) return Math.random;
  // Mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function progress(
  options: GenerationOptions | undefined,
  phase: GenerationPhase,
  ratio: number
) {
  options?.onProgress?.(phase, ratio);
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function buildExplanation(difficulty: Difficulty, term: string, sentence: string): string {
  switch (difficulty) {
    case 'easy':
      return `The term \`${term}\` appears in the source text.`;
    case 'medium':
      return `Re-read the original sentence: ${sentence}`;
    case 'hard':
      return `Distractors share the same grammatical role and length; \`${term}\` is the only term that fits the verb frame.`;
  }
}

function sentenceDensity(difficulty: Difficulty): number {
  // Approximate words per question.
  return { easy: 80, medium: 60, hard: 45 }[difficulty];
}

export async function generateQuiz(
  file: File,
  options: GenerationOptions
): Promise<Question[]> {
  const rng = makeRng();
  const { difficulty, count, maxPages = 200 } = options;

  // ── 1. Parse PDF ───────────────────────────────────────────────────
  progress(options, 'parsing', 0);
  const parse = await extractPdf(file, (done, total) => {
    progress(options, 'parsing', total > 0 ? done / total : 0);
  });
  if (parse.appearsScanned) {
    throw new Error(
      'This PDF appears to be a scanned document with no selectable text. v1 does not support OCR — please run the PDF through a free OCR tool first.'
    );
  }

  // ── 2. Normalise & split sentences ─────────────────────────────────
  progress(options, 'normalising', 0);
  const clean = normaliseText(parse.fullText);
  const allSentences = splitSentences(clean);

  // Limit work for very long PDFs.
  const sentences = allSentences.slice(0, maxPages * 40);
  progress(options, 'normalising', 1);
  await new Promise(r => setTimeout(r, 0));

  if (sentences.length < 8) {
    throw new Error('Not enough readable text in this PDF to generate a quiz.');
  }

  // ── 3. Score keyterms ──────────────────────────────────────────────
  progress(options, 'scoring', 0);
  const { keyterms, stats } = computeKeyterms(clean, 400);
  const keytermSet = new Set(keyterms.map((k) => k.lemma));
  progress(options, 'scoring', 1);

  // ── 4. Generate questions ──────────────────────────────────────────
  progress(options, 'generating', 0);
  const questions: Question[] = [];
  const seen = new Set<string>(); // dedup by (masked, answerLemma)
  const usedSentences = new Set<string>();
  const targetDensity = sentenceDensity(difficulty);
  const totalWords = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0);
  // Soft cap on the upper bound of questions we will *try* to make.
  const ceiling = Math.max(count, Math.ceil(totalWords / targetDensity));
  const attemptPool = shuffle(sentences, rng).slice(0, ceiling * 3);

  let i = 0;
  for (const sentence of attemptPool) {
    if (questions.length >= count) break;
    if (usedSentences.has(sentence)) continue;
    if (sentence.length < 30) continue;

    const choice: ClozeChoice | null = pickCloze(sentence, stats, difficulty, rng);
    if (!choice) continue;

    const key = `${choice.masked.toLowerCase()}|${choice.term.lemma}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const sentenceTerms = extractTerms(sentence);
    const distractors = buildDistractors({
      answer: choice.term,
      sentenceTerms,
      keyterms,
      keytermSet,
      sentenceLemmaSet: new Set(sentenceTerms.map((t) => t.lemma)),
      rng,
    });

    if (distractors.length < 3) continue;

    const optionsList = shuffle([choice.term.text, ...distractors], rng);
    const correctIndex = optionsList.indexOf(choice.term.text) as 0 | 1 | 2 | 3;

    questions.push({
      id: questions.length + 1,
      prompt: choice.masked,
      sourceSentence: sentence,
      options: optionsList as [string, string, string, string],
      correctIndex,
      explanation: buildExplanation(difficulty, choice.term.text, sentence),
      difficulty,
    });

    usedSentences.add(sentence);
    i++;
    if (i % 4 === 0) {
      progress(options, 'generating', Math.min(1, questions.length / count));
      // yield to the browser
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  progress(options, 'generating', 1);
  progress(options, 'done', 1);
  return questions;
}
