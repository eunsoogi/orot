import type { ModelTextObserver } from './modelCall';
import type { TaskResponderInput } from './contracts';
import { reportTaskStreamEvent, type RuntimeContext } from './runtimeContext';
import { projectDisplayTextUpdate } from './streamProjection';

const maxLayoutStreamUnits = 36_000;

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
): ModelTextObserver | undefined {
  if (!context.onTaskStreamEvent || !context.options.task.projectStreamedText) return undefined;
  const projectLayout =
    !prefix && context.options.provider.id.startsWith('chatgpt-plan:')
      ? context.options.task.projectStreamedLayout
      : undefined;
  let rawOutput = '';
  let displayed = prefix;
  const buffered: ModelTextObserver = (event) => {
    if (context.signal.aborted) return;
    rawOutput = event.type === 'text_delta' ? rawOutput + event.text : event.text;
    const projected = projectedTaskText(context, input, rawOutput);
    const next = prefix + (projected ? (prefix ? '\n\n' : '') + projected : '');
    const update = projectDisplayTextUpdate(displayed, next);
    if (!update) return;
    reportTaskStreamEvent(context, update);
    displayed = next;
  };
  if (!projectLayout) return buffered;
  let layoutRaw: string | undefined = '';
  let priorLayout: ReturnType<typeof projectLayout>;
  return Object.assign(buffered, {
    projectOwnedTransport(event: Parameters<ModelTextObserver>[0]) {
      if (context.signal.aborted) return;
      const old = event.type === 'text_snapshot' ? '' : layoutRaw;
      layoutRaw =
        old !== undefined && old.length + event.text.length <= maxLayoutStreamUnits
          ? old + event.text
          : undefined;
      let layout: typeof priorLayout;
      try {
        layout = layoutRaw === undefined ? undefined : projectLayout(layoutRaw, input);
      } catch {
        layout = undefined;
      }
      if (layout?.kind === priorLayout?.kind && layout?.slots === priorLayout?.slots) return;
      priorLayout = layout;
      reportTaskStreamEvent(context, { type: 'layout_skeleton', layout });
    },
  });
}
