import { providerFailure, providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelMessage,
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { CalendarBridge, CalendarEvent } from '../../calendar/types';
import { classifyCalendarEvents } from '../classificationWorkflow';

function event(index: number): CalendarEvent {
  return {
    calendarEventIdentifier: `private-calendar-id-${index}`,
    effectiveAt: `2035-06-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
    endsAt: `2035-06-${String(index + 1).padStart(2, '0')}T10:00:00.000Z`,
    calendarEventSnapshot: {
      title: index % 2 === 0 ? '치과 진료' : '점심 약속',
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function workflowResponse(request: LanguageModelRequest) {
  const candidateMessage = stringContent(request.messages[1]);
  const citationMessage = stringContent(request.messages[2]);
  if (!candidateMessage || !citationMessage) {
    throw new Error('Expected the responder candidate and citation messages.');
  }
  const payload = JSON.parse(candidateMessage) as {
    candidates: readonly { candidateId: string }[];
  };
  const references = JSON.parse(
    citationMessage.slice(citationMessage.indexOf('\n') + 1),
  );
  return providerSuccess({
    text: JSON.stringify({
      type: 'result',
      value: {
        classifications: payload.candidates.map(candidate => ({
          candidateId: candidate.candidateId,
          classification: candidate.candidateId.endsWith('-1')
            ? 'medical'
            : 'uncertain',
          reason: '제목에 진료 목적이 나타납니다.',
          uncertainty: 'medium',
        })),
      },
      citations: references,
    }),
    toolCalls: [],
    finishReason: 'complete' as const,
  });
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

function makeProvider(
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

function makeBridge(events: readonly CalendarEvent[]): CalendarBridge {
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

function input(
  events: readonly CalendarEvent[],
  overrides: Partial<Parameters<typeof classifyCalendarEvents>[0]> = {},
) {
  return {
    bridge: makeBridge(events),
    events,
    provider: makeProvider(
      jest.fn(async (request: LanguageModelRequest) =>
        workflowResponse(request),
      ),
    ),
    modelId: 'selected-model',
    recipient: 'selected-account',
    remoteProcessing: true,
    consent: { authorize: jest.fn(async () => 'authorized' as const) },
    signal: new AbortController().signal,
    createOperationRunId: jest
      .fn()
      .mockImplementationOnce(() => 'run-1')
      .mockReturnValue('run-next'),
    ...overrides,
  };
}

describe('bounded Calendar classification workflow', () => {
  it('sends at most eight items per runtime call, binds remote consent, and preserves every class', async () => {
    const events = Array.from({ length: 9 }, (_, index) => event(index));
    const trace: string[] = [];
    const generate = jest.fn(async (request: LanguageModelRequest) => {
      trace.push('provider');
      return workflowResponse(request);
    });
    const authorize = jest.fn(async () => {
      trace.push('consent');
      return 'authorized' as const;
    });
    const progress: number[] = [];
    const options = input(events, {
      provider: makeProvider(generate),
      consent: { authorize },
      onProgress: value => progress.push(value.completedBatches),
    });
    jest
      .spyOn(options.bridge, 'findEvent')
      .mockImplementation(async identifier => {
        trace.push(`lookup:${identifier}`);
        return {
          access: 'fullAccess' as const,
          event:
            events.find(
              value => value.calendarEventIdentifier === identifier,
            ) ?? null,
        };
      });

    const result = await classifyCalendarEvents(options);

    expect(result.status).toBe('complete');
    expect(result.candidates).toHaveLength(9);
    expect(result.candidates[0]?.classification).toBe('medical');
    expect(result.candidates[1]?.classification).toBe('uncertain');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenCalledTimes(2);
    const checksForBatch = (batch: readonly CalendarEvent[]) => [
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
      'consent',
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
      'provider',
      ...batch.map(value => `lookup:${value.calendarEventIdentifier}`),
    ];
    expect(trace).toEqual([
      ...checksForBatch(events.slice(0, 8)),
      ...checksForBatch(events.slice(8)),
    ]);
    expect(progress).toEqual([1, 2]);
    for (const [request] of generate.mock.calls) {
      expect(request.messages).toHaveLength(3);
      const candidates = JSON.parse(
        stringContent(request.messages[1]) ?? '',
      ).candidates;
      expect(candidates.length).toBeLessThanOrEqual(8);
      expect(JSON.stringify(request.messages)).not.toContain(
        'private-calendar-id',
      );
    }
  });

  it('leaves every candidate manually reviewable when remote consent is declined', async () => {
    const events = [event(0)];
    const generate = jest.fn(async (request: LanguageModelRequest) =>
      workflowResponse(request),
    );
    const result = await classifyCalendarEvents(
      input(events, {
        provider: makeProvider(generate),
        consent: {
          authorize: jest.fn(async () => 'renewal_required' as const),
        },
      }),
    );

    expect(result.status).toBe('unavailable');
    expect(result.candidates[0]).toMatchObject({ status: 'unclassified' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('stops after a failed batch and leaves the failed overflow unclassified', async () => {
    const events = Array.from({ length: 9 }, (_, index) => event(index));
    const generate = jest
      .fn()
      .mockImplementationOnce(async (request: LanguageModelRequest) =>
        workflowResponse(request),
      )
      .mockImplementationOnce(async () =>
        providerFailure({
          code: 'provider_unavailable',
          message: 'Provider unavailable.',
          retryable: true,
        }),
      );
    const result = await classifyCalendarEvents(
      input(events, { provider: makeProvider(generate) }),
    );

    expect(result.status).toBe('partial');
    expect(result.completedBatches).toBe(1);
    expect(
      result.candidates.slice(0, 8).every(item => item.status === 'classified'),
    ).toBe(true);
    expect(result.candidates[8]).toMatchObject({ status: 'unclassified' });
    expect(generate).toHaveBeenCalledTimes(2);
  });
});
