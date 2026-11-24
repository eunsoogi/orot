import type { LanguageModelStreamEvent } from '@orot/model-runtime';

/** Keep append-only text compact while preserving structured-stream corrections as replacement snapshots. */
export function textUpdate(
  previous: string,
  current: string,
):
  | Extract<LanguageModelStreamEvent, { type: 'text_delta' }>
  | Extract<LanguageModelStreamEvent, { type: 'text_snapshot' }>
  | undefined {
  if (current === previous) return undefined;
  if (current.startsWith(previous)) {
    const text = current.slice(previous.length);
    return text ? { type: 'text_delta', text } : undefined;
  }
  return { type: 'text_snapshot', text: current };
}
