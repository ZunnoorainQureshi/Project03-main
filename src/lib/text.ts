/**
 * Text normalisation + sentence splitting.
 * English-only. We keep this small and dependency-free for fast startup.
 */

// Abbreviations that often trip up sentence splitting.
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'vs', 'etc', 'e.g', 'i.e', 'cf', 'al', 'no', 'p', 'pp',
  'fig', 'figs', 'vol', 'vols', 'ed', 'eds', 'rev', 'trans',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
]);

const SMART_PUNCT = /[‘’“”–—]/g;
const WHITESPACE = /\s+/g;

const STOPWORDS = new Set([
  'a', 'about', 'above', 'across', 'after', 'against', 'all', 'almost', 'also', 'although',
  'always', 'am', 'among', 'an', 'and', 'another', 'any', 'are', 'as', 'at', 'be', 'because',
  'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'came', 'can', 'cannot',
  'could', 'did', 'do', 'does', 'doing', 'done', 'down', 'during', 'each', 'either', 'else',
  'ever', 'every', 'few', 'for', 'from', 'further', 'gave', 'goes', 'had', 'has', 'have',
  'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'however',
  'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'let', 'like', 'made', 'make',
  'many', 'may', 'maybe', 'me', 'might', 'mine', 'more', 'most', 'much', 'must', 'my',
  'myself', 'neither', 'never', 'no', 'nor', 'not', 'now', 'of', 'off', 'often', 'on',
  'once', 'one', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 'page', 'paragraph', 'part', 'per', 'perhaps', 'rather', 'said', 'same', 'saw',
  'say', 'says', 'section', 'see', 'seen', 'several', 'shall', 'she', 'should', 'since',
  'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'therefore', 'these', 'they', 'thing', 'things', 'this', 'those',
  'though', 'through', 'thus', 'time', 'times', 'to', 'too', 'two', 'under', 'until',
  'up', 'upon', 'us', 'use', 'used', 'using', 'value', 'very', 'via', 'want', 'wanted',
  'wants', 'way', 'we', 'well', 'went', 'were', 'what', 'when', 'where', 'whether', 'which',
  'while', 'who', 'whom', 'why', 'will', 'with', 'within', 'without', 'would', 'year', 'years',
  'yes', 'yet', 'you', 'your', 'yours', 'yourself', 'yourselves',
]);

/** Generic nouns to deprioritise as cloze answers. */
const GENERIC_NOUNS = new Set([
  'thing', 'way', 'time', 'year', 'people', 'part', 'case', 'system',
  'kind', 'use', 'number', 'fact', 'example', 'instance', 'point', 'set',
  'group', 'world', 'life', 'day', 'man', 'woman', 'child', 'place', 'area',
  'hand', 'side', 'head', 'information', 'work', 'level', 'order', 'end',
  'start', 'result', 'change', 'process', 'form', 'type', 'sense', 'word',
  'line', 'name', 'state', 'course', 'idea', 'term', 'body', 'field', 'book',
  'problem', 'question', 'issue', 'matter', 'item', 'figure', 'table',
]);

export { STOPWORDS, GENERIC_NOUNS };

/** Normalise whitespace and smart punctuation; drop pure-noise lines. */
export function normaliseText(raw: string): string {
  return raw
    .replace(SMART_PUNCT, (c) => {
      // Map smart quotes to ASCII, smart dashes to spaces
      switch (c) {
        case '‘': case '’': return "'";
        case '“': case '”': return '"';
        case '–': case '—': return ' - ';
        default: return c;
      }
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length >= 5)
    .filter((l) => !/^[\d\W_]+$/.test(l)) // drop pure-number / punctuation lines
    .join('\n');
}

/**
 * Split text into sentences using a regex that respects a small
 * abbreviation list. Returns sentences in source order.
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  const re = /[^.!?\n]+[.!?]+|\S[^.!?\n]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (!s) continue;

    // Skip if the trailing "period" actually closes a known abbreviation.
    const lastWord = s.split(/\s+/).slice(-2, -1)[0]?.toLowerCase().replace(/[.,]/g, '');
    if (lastWord && ABBREVIATIONS.has(lastWord) && !/[!?]$/.test(s)) continue;

    if (s.length < 8 || s.length > 320) continue;
    if (!/[A-Za-z]/.test(s)) continue;
    if (/^[\s•\-—>*\d.]+$/.test(s)) continue; // bullets / numbered lists

    out.push(s);
  }
  return out;
}

/** Cheap tokenizer: lowercased alphabetic words. */
export function tokenize(sentence: string): string[] {
  return sentence
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}
