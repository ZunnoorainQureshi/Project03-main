/**
 * PDF.js wrapper. Lazily imports `pdfjs-dist` so SSR / build paths that
 * never reach `extractPdf` don't pull the worker into the bundle.
 *
 * The worker is loaded via Vite's `new URL(..., import.meta.url)` pattern
 * so dev and build both resolve it correctly without manual copying.
 */

import type { ParseResult } from './types';

let _configured = false;

async function getPdfjs() {
  // Dynamic import — pdfjs-dist pulls in a worker + DOMMatrix; we want it
  // strictly on the client.
  const pdfjs = await import('pdfjs-dist');
  if (!_configured) {
    const workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url
    ).toString();
    pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
    _configured = true;
  }
  return pdfjs;
}

/**
 * Extract text from every page of a PDF File using PDF.js.
 *
 * Returns a per-page string array and a `appearsScanned` flag (true if
 * 90% of pages have zero selectable text).
 */
export async function extractPdf(
  file: File,
  onProgress?: (pagesDone: number, totalPages: number) => void
): Promise<ParseResult> {
  const pdfjs = await getPdfjs();
  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  const total = doc.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= total; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    // Group items by Y-band (transform[5]) to preserve paragraph breaks.
    const lines = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items) {
      if (!('str' in item)) continue;
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y)!.push({ x, str: item.str });
    }
    const sortedYs = [...lines.keys()].sort((a, b) => b - a);
    const pageLines = sortedYs.map((y) => {
      const items = lines.get(y)!.sort((a, b) => a.x - b.x);
      return items.map((it) => it.str).join(' ').replace(/\s+/g, ' ').trim();
    });
    pages.push(pageLines.join('\n'));
    onProgress?.(i, total);
    
    // Yield to the browser occasionally to keep the progress bar animation smooth
    if (i % 5 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const fullText = pages.join('\n\n');
  const emptyPages = pages.filter((p) => p.replace(/\s+/g, '').length === 0).length;
  const appearsScanned = total > 0 && emptyPages / total > 0.9;

  return { fullText, pages, appearsScanned };
}
