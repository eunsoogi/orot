import type { LanguageModelStreamEvent } from '@orot/model-runtime';
import type { TaskResponderInput } from './contracts';
import { reportTaskStreamEvent, type RuntimeContext } from './runtimeContext';
import { projectDisplayTextUpdate } from './streamProjection';

/** Projects only approved text and preserves replacements without exposing raw JSON. */
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
  const projectLayout =
    !prefix && context.options.provider.id.startsWith('chatgpt-plan:')
      ? context.options.task.projectStreamedLayout
      : undefined;
  let rawOutput = '';
  let displayed = prefix;
  let priorLayout: ReturnType<NonNullable<typeof projectLayout>>;
  return (event) => {
    rawOutput = event.type === 'text_delta' ? rawOutput + event.text : event.text;
    if (context.signal.aborted) return;
    if (projectLayout) {
      try {
        const layout = projectLayout(rawOutput, input);
        if (layout?.kind !== priorLayout?.kind || layout?.slots !== priorLayout?.slots) {
          priorLayout = layout;
          reportTaskStreamEvent(context, { type: 'layout_skeleton', layout });
        }
      } catch {
        if (priorLayout) reportTaskStreamEvent(context, { type: 'layout_skeleton' });
        priorLayout = undefined;
      }
    }
    const projected = projectedTaskText(context, input, rawOutput);
    const next = prefix + (projected ? (prefix ? '\n\n' : '') + projected : '');
    const update = projectDisplayTextUpdate(displayed, next);
    if (!update) return;
    reportTaskStreamEvent(context, update);
    displayed = next;
  };
}
