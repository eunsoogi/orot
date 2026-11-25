import { markdownRuns, type MarkdownRun } from './conversationMarkdownInline';

type Heading = {
  readonly kind: 'heading';
  readonly runs: readonly MarkdownRun[];
};
type Paragraph = {
  readonly kind: 'paragraph';
  readonly runs: readonly MarkdownRun[];
};
type Code = { readonly kind: 'code'; readonly text: string };
type Item = {
  readonly kind: 'item';
  readonly marker: string;
  readonly runs: readonly MarkdownRun[];
};
export type MarkdownBlock = Heading | Paragraph | Code | Item;

const maxLength = 12_000;
const maxLines = 160;
const maxBlocks = 80;
const maxRuns = 180;
const fence = /^ {0,3}(`{3,}|~{3,})[ \t]*[A-Za-z0-9_+.-]*[ \t]*$/u;
const closeFence = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;
const heading = /^ {0,3}#{1,6}[ \t]+(.+)$/u;
const item = /^ {0,3}([-+*]|\d{1,9}[.)])[ \t]+(.+)$/u;

/** Presentation-only admission. Over-budget/plain content keep the existing text path. */
export function parseAssistantMarkdown(
  content: string,
): readonly MarkdownBlock[] | undefined {
  if (content.length > maxLength || !/[\n\\`_*#\[+~-]/u.test(content))
    return undefined;
  const lines = content.split(/\r\n?|\n/u);
  if (lines.length > maxLines) return undefined;
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];
  let markup = false;
  let runsCount = 0;

  const runs = (body: string) => {
    const parsed = markdownRuns(body);
    runsCount += parsed.length;
    if (
      parsed.some(run => run.kind !== 'text') ||
      parsed.map(run => run.text).join('') !== body
    )
      markup = true;
    return parsed;
  };
  const flush = () => {
    if (!paragraph.length) return;
    blocks.push({ kind: 'paragraph', runs: runs(paragraph.join('\n')) });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const opening = fence.exec(line)?.[1];
    const title = heading.exec(line)?.[1];
    const list = item.exec(line);
    if (opening) {
      flush();
      let found = i + 1;
      while (found < lines.length) {
        const closing = closeFence.exec(lines[found]!)?.[1];
        if (
          closing &&
          closing[0] === opening[0] &&
          closing.length >= opening.length
        )
          break;
        found += 1;
      }
      if (found === lines.length) {
        // Preserve an unfinished fence literally instead of turning its text into links.
        blocks.push({ kind: 'code', text: lines.slice(i).join('\n') });
      } else {
        markup = true;
        blocks.push({
          kind: 'code',
          text: lines.slice(i + 1, found).join('\n'),
        });
      }
      i = found;
    } else if (title) {
      flush();
      markup = true;
      blocks.push({ kind: 'heading', runs: runs(title) });
    } else if (list) {
      flush();
      markup = true;
      const marker = list[1]!.length === 1 ? '•' : list[1]!;
      blocks.push({ kind: 'item', marker, runs: runs(list[2]!) });
    } else if (line.trim()) {
      paragraph.push(line);
    } else {
      flush();
    }
  }
  flush();
  return (markup || blocks.length > 1) &&
    blocks.length <= maxBlocks &&
    runsCount <= maxRuns
    ? blocks
    : undefined;
}
