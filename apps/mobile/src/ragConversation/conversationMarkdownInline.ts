import { isPublicWebUrl } from '../externalMedicalEvidence/publicWebSources';

export type MarkdownRun = {
  readonly kind: 'text' | 'strong' | 'emphasis' | 'code' | 'link';
  readonly text: string;
  readonly url?: string;
};

const token =
  /\\[\\`*_[\]()!#<>]|!\[[^[\]\n]*\]\([^()\n]*\)|\[[^[\]\n]+\]\([^()\s]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_|<\/?[A-Za-z][^<>\n]*>/gu;

/** Parse a bounded, nonrecursive inline subset. Unrecognized syntax remains visible. */
export function markdownRuns(text: string): readonly MarkdownRun[] {
  const runs: MarkdownRun[] = [];
  let offset = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index;
    if (index > offset)
      runs.push({ kind: 'text', text: text.slice(offset, index) });
    const value = match[0];
    runs.push(markdownToken(value, text, index));
    offset = index + value.length;
  }
  if (offset < text.length)
    runs.push({ kind: 'text', text: text.slice(offset) });
  return runs;
}

/** Reuse the same literal web URL policy as source links, without granting provenance. */
function markdownToken(value: string, input: string, at: number): MarkdownRun {
  if (value.startsWith('\\')) return { kind: 'text', text: value.slice(1) };
  if (value.startsWith('`')) return { kind: 'code', text: value.slice(1, -1) };
  if (value.startsWith('[')) {
    const separator = value.indexOf('](');
    const url = value.slice(separator + 2, -1);
    if (/^https?:\/\/[^\\]+$/iu.test(url) && isPublicWebUrl(url))
      return { kind: 'link', text: value.slice(1, separator), url };
  }
  if (value.startsWith('_') || value.startsWith('*')) {
    const width = value.startsWith('__') || value.startsWith('**') ? 2 : 1;
    const body = value.slice(width, -width);
    const insideWord =
      value.startsWith('_') &&
      /[\p{L}\p{N}]/u.test(input.charAt(at - 1)) &&
      /[\p{L}\p{N}]/u.test(input.charAt(at + value.length));
    if (body.trim() === body && !insideWord)
      return { kind: width === 2 ? 'strong' : 'emphasis', text: body };
  }
  // HTML, images and unsupported destinations are displayed, never executed.
  return { kind: 'text', text: value };
}
