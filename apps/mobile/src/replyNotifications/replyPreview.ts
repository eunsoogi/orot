import Graphemer from 'graphemer';

/** Render only the saved answer; destinations and Markdown syntax need not appear on the lock screen. */
export function replyPreview(answer: string): string {
  const text = answer
    .replace(/```[^\n]*\n?/g, '')
    .replace(/!?\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(^|\n)\s{0,3}(?:#{1,6}\s+|>\s*|[-*+]\s+)/g, '$1')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Segment by grapheme so a truncated Korean character or emoji stays intact.
  const segments = new Graphemer().splitGraphemes(text);
  return segments.length <= 120 ? text : segments.slice(0, 119).join('') + '…';
}
