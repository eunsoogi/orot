import { utf8ByteLength } from '../../aiFeatures/integration/evidenceUtils';
import { publisherHtmlByteLimit } from './medlinePlusSeeds';

function plainText(value: string, limit: number) {
  const values: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
  };
  const text = value
    .replace(/&([a-z]+|#x[0-9a-f]+|#[0-9]+);/gi, (whole, entity: string) => {
      if (!entity.startsWith('#')) return values[entity] ?? whole;
      const hex = entity[1]?.toLowerCase() === 'x';
      const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return code >= 32 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff)
        ? String.fromCodePoint(code)
        : ' ';
    })
    .replace(/\s+/g, ' ')
    .trim();
  // Consume metadata as plain data; never preserve markup for display or execution.
  return text && !/[<>]/.test(text) ? text.slice(0, limit) : '';
}

function attributes(tag: string) {
  const parsed = new Map<string, string>();
  for (const part of tag.matchAll(
    /([a-z_][a-z_0-9:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
  )) {
    const name = part[1]?.toLowerCase();
    if (!name || parsed.has(name)) return new Map<string, string>();
    parsed.set(name, part[2] ?? part[3] ?? '');
  }
  return parsed;
}

/** Parse only inert publisher head metadata, without a browser, scripts or body extraction. */
export function readPublisherHead(html: string, exactUrl: string) {
  if (
    html.length > publisherHtmlByteLimit ||
    utf8ByteLength(html) > publisherHtmlByteLimit
  )
    return undefined;
  const inert = html.replace(
    /<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    '',
  );
  const head = inert.match(/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i)?.[1];
  if (!head || /<(?:script|style|noscript|template)\b/i.test(head))
    return undefined;
  const rawTitles = [...head.matchAll(/<title\s*>([^<>]*)<\/title\s*>/gi)];
  if (rawTitles.length !== 1) return undefined;
  const title = plainText(rawTitles[0]?.[1] ?? '', 180);
  if (!title) return undefined;
  let summary = '';
  for (const match of head.matchAll(
    /<(meta|link)\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi,
  )) {
    const attr = attributes(match[0]);
    if (
      match[1]?.toLowerCase() === 'link' &&
      attr.get('rel')?.toLowerCase() === 'canonical' &&
      attr.get('href') !== exactUrl
    )
      return undefined;
    if (
      match[1]?.toLowerCase() === 'meta' &&
      attr.get('name')?.toLowerCase() === 'description'
    ) {
      const content = attr.get('content');
      if (summary || !content) return undefined;
      summary = plainText(content, 360);
      if (!summary) return undefined;
    }
  }
  return { title, summary };
}
