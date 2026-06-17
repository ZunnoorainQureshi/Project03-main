/**
 * Core types for the PDF-to-Quiz pipeline.
 */

export type Difficulty = 'easy' | 'medium' | 'hard';

export type ExportFormat = 'md' | 'csv' | 'pdf';

export interface Question {
  id: number;
  /** The cloze sentence with the answer replaced by `_____`. */
  prompt: string;
  /** The original unmasked sentence — shown next to the question. */
  sourceSentence: string;
  /** Four option strings, shuffled. */
  options: [string, string, string, string];
  /** Index into `options` of the correct answer. */
  correctIndex: 0 | 1 | 2 | 3;
  /** Human-readable explanation of why the answer is correct. */
  explanation: string;
  difficulty: Difficulty;
}

export interface GenerationOptions {
  difficulty: Difficulty;
  count: number;
  /** 1–200; default 200 (.PDF page cap). */
  maxPages?: number;
  /** Callback for progress reporting. */
  onProgress?: (phase: GenerationPhase, ratio: number) => void;
}

export type GenerationPhase =
  | 'parsing'
  | 'normalising'
  | 'scoring'
  | 'generating'
  | 'done'
  | 'error';

export interface ParseResult {
  /** All text from the PDF, page-joined. */
  fullText: string;
  /** Per-page text. */
  pages: string[];
  /** True if the document appears to be a scanned image (no text layer). */
  appearsScanned: boolean;
}
