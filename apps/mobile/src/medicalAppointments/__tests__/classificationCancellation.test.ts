import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelMessage,
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { CalendarBridge, CalendarEvent } from '../../calendar/types';
import { classifyCalendarEvents } from '../classificationWorkflow';

function event(index: number): CalendarEvent {
  const day = String(index + 1).padStart(2, '0');
  return {
    calendarEventIdentifier: `private-event-${index}`,
    effectiveAt: `2035-06-${day}T00:00:00.000Z`,
    endsAt: `2035-06-${day}T01:00:00.000Z`,
    calendarEventSnapshot: {
      title: '치과 진료',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function stringContent(
  message: LanguageModelMessage | undefined,
): string | undefined {
  return message &&
    message.role !== 'tool' &&
    typeof message.content === 'string'
    ? message.content
    : undefined;
}

function responseFor(request: LanguageModelRequest) {
  const candidates = JSON.parse(
    stringContent(request.messages[1]) ?? '',
  ).candidates;
  const citationMessage = stringContent(request.messages[2]) ?? '';
  const citations = JSON.parse(
    citationMessage.slice(citationMessage.indexOf('\n') + 1),
  );
  return providerSuccess({
    text: JSON.stringify({
      type: 'result',
      value: {
        classifications: candidates.map(
          (candidate: { candidateId: string }) => ({
            candidateId: candidate.candidateId,
            classification: 'medical',
            reason: '진료 목적이 제목에 있습니다.',
            uncertainty: 'low',
          }),
        ),
      },
      citations,
    }),
    toolCalls: [],
    finishReason: 'complete' as const,
  });
}

function provider(
  generate: LanguageModelProvider['generate'],
): LanguageModelProvider {
  return {
    kind: 'language-model',
    id: 'selected-provider',
    displayName: 'Selected provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
  };
}

function bridge(events: readonly CalendarEvent[]): CalendarBridge {
  const byId = new Map(
    events.map(value => [value.calendarEventIdentifier, value]),
  );
  return {
    requestAccessAndListUpcomingEvents: jest.fn(),
    findEvent: jest.fn(async identifier => ({
      access: 'fullAccess' as const,
      event: byId.get(identifier) ?? null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

describe('classification cancellation boundary', () => {
  it('does not dispatch to the provider when the caller aborts during consent', async () => {
    const controller = new AbortController();
    const candidate = event(0);
    const generate = jest.fn(async (request: LanguageModelRequest) =>
      responseFor(request),
    );
    const authorize = jest.fn(async () => {
      controller.abort();
      return 'authorized' as const;
    });

    const result = await classifyCalendarEvents({
      bridge: bridge([candidate]),
      events: [candidate],
      provider: provider(generate),
      modelId: 'selected-model',
      recipient: 'selected-account',
      remoteProcessing: true,
      consent: { authorize },
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.completedBatches).toBe(0);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });

  it('stops before the next batch when the caller aborts during the first provider call', async () => {
    const controller = new AbortController();
    const events = Array.from({ length: 9 }, (_, index) => event(index));
    let calls = 0;
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      calls += 1;
      if (calls === 1) controller.abort();
      return responseFor(request);
    });

    const result = await classifyCalendarEvents({
      bridge: bridge(events),
      events,
      provider: provider(generate),
      modelId: 'selected-model',
      recipient: 'selected-account',
      remoteProcessing: true,
      consent: { authorize: async () => 'authorized' },
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(result.completedBatches).toBe(0);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('does not start a later batch after a completed batch is cancelled', async () => {
    const controller = new AbortController();
    const events = Array.from({ length: 9 }, (_, index) => event(index));
    const generate = jest.fn(async (request: LanguageModelRequest) =>
      responseFor(request),
    );

    const result = await classifyCalendarEvents({
      bridge: bridge(events),
      events,
      provider: provider(generate),
      modelId: 'selected-model',
      recipient: 'selected-account',
      remoteProcessing: true,
      consent: { authorize: async () => 'authorized' },
      signal: controller.signal,
      onProgress: progress => {
        if (progress.completedBatches === 1) controller.abort();
      },
    });

    expect(result.status).toBe('partial');
    expect(result.completedBatches).toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
