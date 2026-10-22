import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { CalendarBridge, CalendarEvent } from '../src/calendar/types';
import { classifyCalendarEvents } from '../src/medicalAppointments/classificationWorkflow';
import { createLocalQueryProbeFixtures } from './localRecordQueryProbeFixtures';

const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

/** Measures the shipping classifier with a declared zero-network scripted model, never actual inference latency. */
export async function measureScaleCalendar(
  count: number,
  cancelAfterFirst = false,
) {
  const appointment = createLocalQueryProbeFixtures().appointment;
  const inputStarted = performance.now();
  const events: CalendarEvent[] = Array.from({ length: count }, (_, index) => ({
    calendarEventIdentifier: `scale-calendar-${index}`,
    effectiveAt: appointment.effectiveAt,
    endsAt: '2090-01-03T10:00:00.000Z',
    calendarEventSnapshot: appointment.calendarEventSnapshot!,
  }));
  const byId = new Map(
    events.map(event => [event.calendarEventIdentifier, event]),
  );
  const bridge: CalendarBridge = {
    requestAccessAndListUpcomingEvents: async () => ({
      access: 'fullAccess',
      events,
    }),
    findEvent: async id => ({
      access: 'fullAccess',
      event: byId.get(id) ?? null,
    }),
    addEventStoreListener: () => ({ remove() {} }),
  };
  const inputMs = performance.now() - inputStarted;
  const inputBytes = bytes(events);
  const controller = new AbortController();
  const started = performance.now();
  let modelCalls = 0,
    maximumRequestBytes = 0;
  let firstDispatchMs: number | null = null,
    firstProgressMs: number | null = null;
  let timeBudgetExceeded = false;
  function respond(request: LanguageModelRequest) {
    modelCalls += 1;
    firstDispatchMs ??= performance.now() - started;
    maximumRequestBytes = Math.max(maximumRequestBytes, bytes(request));
    const content = (index: number) => {
      const message = request.messages[index];
      if (
        !message ||
        message.role === 'tool' ||
        typeof message.content !== 'string'
      )
        throw new Error('Invalid classifier messages');
      return message.content;
    };
    const candidates = (
      JSON.parse(content(1)) as { candidates: { candidateId: string }[] }
    ).candidates;
    const citation = content(2);
    return providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: {
          classifications: candidates.map(candidate => ({
            candidateId: candidate.candidateId,
            decision: 'medical_medium',
          })),
        },
        citations: JSON.parse(citation.slice(citation.indexOf('\n') + 1)),
      }),
      toolCalls: [],
      finishReason: 'complete' as const,
    });
  }
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'synthetic-scale-provider',
    displayName: 'Scripted local scale model',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: async request => respond(request),
  };
  const result = await classifyCalendarEvents({
    events,
    bridge,
    provider,
    modelId: 'synthetic-scale-model',
    recipient: 'local-test',
    remoteProcessing: false,
    consent: { authorize: async () => 'authorized' },
    signal: controller.signal,
    onProgress(progress) {
      if (progress.completedBatches) {
        firstProgressMs ??= performance.now() - started;
        if (cancelAfterFirst) controller.abort();
        // Synthetic performance runs stop after twenty seconds; production workflow budgets are untouched.
        if (performance.now() - started > 20000) {
          timeBudgetExceeded = true;
          controller.abort();
        }
      }
    },
  });
  if (
    (!cancelAfterFirst &&
      !timeBudgetExceeded &&
      result.status !== 'complete') ||
    (cancelAfterFirst && result.completedBatches !== 1)
  )
    throw new Error(
      'Scale classification did not preserve completion/cancellation: ' +
        result.status,
    );
  const metrics = {
    events: count,
    inputMs,
    inputBytes,
    elapsedMs: performance.now() - started,
    firstDispatchMs,
    firstProgressMs,
    modelCalls,
    maximumRequestBytes,
    status: result.status,
    completedBatches: result.completedBatches,
    totalBatches: result.totalBatches,
    scriptedModel: true,
    timeBudgetExceeded,
    cancelAfterFirst,
  };
  console.info('OROT_AI_SCALE_CALENDAR', JSON.stringify(metrics));
  return metrics;
}
