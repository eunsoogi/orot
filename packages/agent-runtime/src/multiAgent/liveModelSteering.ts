import type {
  LanguageModelProvider,
  LanguageModelRequest,
  LanguageModelExecutionOptions,
} from '@orot/model-runtime';
import type { ExecutionConsentPort } from './contracts';
import { reportTaskStreamEvent, type RuntimeContext } from './runtimeContext';
import type { ModelCallOutcome } from './modelCall';
import { observeUntilAbort } from './operationObservation';
import { authorizeModelCall } from './modelAuthorization';

/** One successor is reserved in the existing graph budget. Never abort the original operation. */
export function liveModelSteering<TResult>(
  context: RuntimeContext<TResult>,
  operationId: string,
  request: LanguageModelRequest,
  consent: ExecutionConsentPort,
  prepare?: (
    signal: AbortSignal,
    request: LanguageModelRequest,
  ) => Promise<ModelCallOutcome | 'ready' | undefined>,
): { provider: LanguageModelProvider; close(): Promise<void> } {
  const provider = context.options.provider;
  const store = context.options.operationJournal?.steering;
  const budget = context.midTurnSteeringBudget;
  if (
    !provider.capabilities.midTurnSteering ||
    !budget?.available ||
    budget.used ||
    !store?.beginLive ||
    !store.settleLive ||
    !store.subscribe ||
    context.modelCallPurpose === 'preview_review'
  )
    return { provider, close: async () => {} };
  const steeringAbort = new AbortController();
  const abortSteering = () => steeringAbort.abort();
  context.signal.addEventListener('abort', abortSteering, { once: true });
  if (context.signal.aborted) abortSteering();
  const signal = steeringAbort.signal;
  let active = true;
  let control: { submit(id: string, text: string): Promise<void> } | undefined;
  let draining: Promise<void> | undefined;
  let submitted: string | undefined;
  let wakeAgain = false;
  async function drain() {
    if (!active || !control || budget!.used || context.signal.aborted) return;
    const row = (await store!.list()).find((item) => item.status === 'queued');
    if (!row || !active) return;
    // The additional text is authorized together with the unchanged active context.
    const payload: LanguageModelRequest = {
      ...request,
      messages: [...request.messages, { role: 'user', content: row.text }],
    };
    if (prepare) {
      const prepared = await observeUntilAbort(prepare(signal, payload), signal);
      if (prepared.kind !== 'value' || prepared.value !== 'ready') return;
    }
    const grant = await authorizeModelCall(payload, context.options.execution, consent, signal);
    if (
      !active ||
      context.signal.aborted ||
      grant.status !== 'authorized' ||
      !grant.consume(payload, context.options.execution, signal)
    )
      return;
    if (!(await store!.beginLive!(operationId, row.id))) return;
    // Reserve before sending, including uncertain delivery. A new UI submission is never a replay.
    budget!.used = true;
    submitted = row.id;
    if (!active || context.signal.aborted) {
      await store!.settleLive!(operationId, row.id, 'failed');
      return;
    }
    try {
      await observeUntilAbort(control!.submit(row.id, row.text), signal);
    } catch {
      /* Delivery is uncertain: preserve the durable claim, never auto-resubmit. */
    }
  }
  const wake = async () => {
    if (draining) {
      wakeAgain = true;
      return;
    }
    if (!draining)
      draining = drain()
        .catch(() => {})
        .finally(() => {
          draining = undefined;
          if (wakeAgain) {
            wakeAgain = false;
            void wake();
          }
        });
    // Storage emits while persisting a claim; never await our own drain recursively.
  };
  const unsubscribe = store.subscribe(wake);
  const midTurnSteering: NonNullable<LanguageModelExecutionOptions['midTurnSteering']> = {
    onReady(value) {
      if (active) {
        control = value;
        void wake();
      }
    },
    async onEvent(event) {
      if (event.id !== submitted) return;
      const changed = await store.settleLive!(operationId, event.id, event.status);
      if (!changed) throw new Error('Live steering receipt was not persisted.');
      if (event.status === 'applied') reportTaskStreamEvent(context, { type: 'steering_applied' });
    },
  };
  return {
    provider: {
      ...provider,
      generate: (wire, options) => provider.generate(wire, { ...options, midTurnSteering }),
      ...(provider.stream
        ? {
            stream: (wire: LanguageModelRequest, options?: LanguageModelExecutionOptions) =>
              provider.stream!(wire, { ...options, midTurnSteering }),
          }
        : {}),
    },
    async close() {
      active = false;
      abortSteering();
      context.signal.removeEventListener('abort', abortSteering);
      unsubscribe();
      await draining;
    },
  };
}
