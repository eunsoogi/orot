import { possibilityReportTemplate } from './conversationReportTemplate';

export type NarrativePart = {
  readonly kind: 'body' | 'heading';
  readonly text: string;
};

/** The stored response is the only source; parse just unmistakable ATX heading lines.
 * No clinical section inference, link parsing, or interpretation of quoted/fenced text. */
export function savedPossibilityNarrativeParts(
  text: string,
): readonly NarrativePart[] | undefined {
  const reservedTitle = possibilityReportTemplate().title;
  const parts: NarrativePart[] = [];
  let body: string[] = [];
  let fence: string | undefined;
  let hasHeading = false;
  const flush = () => {
    if (body.length) parts.push({ kind: 'body', text: body.join('\n') });
    body = [];
  };
  for (const line of text.split('\n')) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/u.exec(line);
    if (delimiter) {
      const marker = delimiter[1]!;
      if (!fence) fence = marker;
      else if (
        fence[0] === marker[0] &&
        marker.length >= fence.length &&
        delimiter[2]!.trim() === ''
      )
        fence = undefined;
      body.push(line);
      continue;
    }
    const heading = !fence && /^#{1,6}[ \t]+([^#\s].*?)[ \t\r]*$/u.exec(line);
    if (!heading) {
      body.push(line);
      continue;
    }
    const title = heading[1]!.replace(/[ \t]+#+[ \t]*$/u, '');
    if (!title) {
      body.push(line);
      continue;
    }
    // The canonical parser owns this title. If it rejected the structure, keep
    // the entire answer literal rather than minting a second report heading.
    if (title === reservedTitle) return undefined;
    flush();
    hasHeading = true;
    parts.push({ kind: 'heading', text: title });
  }
  flush();
  return hasHeading ? parts : undefined;
}
