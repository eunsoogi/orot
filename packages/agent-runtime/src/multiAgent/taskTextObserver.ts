import type { LanguageModelStreamEvent } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import { reportTaskStreamEvent, type RuntimeContext } from './runtimeContext';

/** Raw JSON stays private even when a task projection rejects a partial value. */
export function projectedTaskText<TResult>(
  context: RuntimeContext<TResult>,
  input: TaskResponderInput,
  raw: string,
): string {
  try {
    return context.options.task.projectStreamedText?.(raw, input) ?? '';
  } catch {
    return '';
  }
}

/** A later source group appends to prior approved display text instead of resetting the draft. */
export function createTaskTextObserver<TResult>(
  context: RuntimeContext<TResult>,
  input: TaskResponderInput,
  prefix = '',
):
  | ((event: Extract<LanguageModelStreamEvent, { type: 'text_delta' | 'text_snapshot' }>) => void)
  | undefined {
  if (!context.onTaskStreamEvent || !context.options.task.projectStreamedText) return undefined;
  let rawOutput = '';
  let displayed = prefix;
  return (event) => {
    rawOutput = event.type === 'text_delta' ? rawOutput + event.text : event.text;
    const projected = projectedTaskText(context, input, rawOutput);
    const next = prefix + (projected ? (prefix ? '\n\n' : '') + projected : '');
    if (next === displayed) return;
    reportTaskStreamEvent(
      context,
      next.startsWith(displayed)
        ? { type: 'text_delta', text: next.slice(displayed.length) }
        : { type: 'text_snapshot', text: next },
    );
    displayed = next;
  };
}
