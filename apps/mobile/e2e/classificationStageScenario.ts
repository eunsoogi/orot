import { providerFailure, providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { CalendarEvent } from '../src/calendar/types';

/** Test-only data and manually released responses; never reads Calendar or invokes an external model. */
export function classificationStageEvents(): readonly CalendarEvent[] {
  return Array.from({ length: 9 }, (_, index) => ({
    calendarEventIdentifier: `synthetic-stage-event-${index}`,
    effectiveAt: `2035-06-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
    endsAt: `2035-06-${String(index + 1).padStart(2, '0')}T01:00:00.000Z`,
    calendarEventSnapshot: {
      title:
        index === 0
          ? Array.from(
              { length: 30 },
              (_partValue, part) => `합성 긴 진료 예약 ${part + 1}`,
            ).join(' ')
          : `합성 진료 예약 ${index + 1}`,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  }));
}

export function createClassificationStageScenario(
  onWaiting: (phase: 'model' | 'save' | null) => void,
) {
  let pending: ((released: boolean) => void) | null = null;
  let disposed = false;
  let generation = 0;
  let savePaused = false;
  const wait = (phase: 'model' | 'save', signal?: AbortSignal) =>
    new Promise<boolean>(resolve => {
      if (disposed || signal?.aborted) return resolve(false);
      if (pending)
        throw new Error('Synthetic scenario supports one pending response');
      let settled = false;
      const finish = (released: boolean) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', abort);
        pending = null;
        if (!disposed) onWaiting(null);
        resolve(released);
      };
      const abort = () => finish(false);
      pending = finish;
      signal?.addEventListener('abort', abort, { once: true });
      onWaiting(phase);
    });
  const generate: LanguageModelProvider['generate'] = async (
    request,
    options,
  ) => {
    const started = generation;
    if (
      !(await wait('model', options?.signal)) ||
      disposed ||
      started !== generation ||
      options?.signal?.aborted
    )
      return providerFailure({
        code: 'provider_unavailable',
        message: 'Synthetic response cancelled.',
        retryable: false,
      });
    const candidateMessage = request.messages[1];
    const citationMessage = request.messages[2];
    if (
      !candidateMessage ||
      candidateMessage.role === 'tool' ||
      typeof candidateMessage.content !== 'string' ||
      !citationMessage ||
      citationMessage.role === 'tool' ||
      typeof citationMessage.content !== 'string'
    )
      throw new Error('Expected synthetic classification request');
    const payload = JSON.parse(candidateMessage.content) as {
      candidates: { candidateId: string }[];
    };
    const citations = JSON.parse(
      citationMessage.content.slice(citationMessage.content.indexOf('\n') + 1),
    );
    return providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: {
          classifications: payload.candidates.map(candidate => ({
            candidateId: candidate.candidateId,
            decision: 'medical_low',
          })),
        },
        citations,
      }),
      toolCalls: [],
      finishReason: 'complete',
    });
  };
  return {
    generate,
    // React StrictMode replays effect setup after cleanup; old continuations stay invalid.
    activate: () => {
      pending?.(false);
      generation += 1;
      disposed = false;
      savePaused = false;
      onWaiting(null);
    },
    release: () => pending?.(true),
    waitForSave: async () => {
      if (disposed) throw new Error('Synthetic save cancelled');
      if (savePaused) return;
      const started = generation;
      if (!(await wait('save')) || disposed || started !== generation)
        throw new Error('Synthetic save cancelled');
      savePaused = true;
    },
    dispose: () => {
      disposed = true;
      generation += 1;
      pending?.(false);
    },
  };
}
