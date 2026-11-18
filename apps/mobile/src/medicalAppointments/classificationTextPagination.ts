export interface ClassificationTextLine {
  readonly text: string;
  readonly height: number;
}

/** Native line measurements, not character guesses, determine readable pages at the current text scale. */
export function paginateClassificationLines(
  lines: readonly ClassificationTextLine[],
  availableHeight: number,
) {
  const pages: string[] = [];
  let current: string[] = [];
  let height = 0;
  for (const line of lines) {
    if (current.length && height + line.height > availableHeight) {
      pages.push(current.join('\n'));
      current = [];
      height = 0;
    }
    current.push(line.text.replace(/\r?\n$/, ''));
    height += line.height;
  }
  if (current.length) pages.push(current.join('\n'));
  return pages;
}
