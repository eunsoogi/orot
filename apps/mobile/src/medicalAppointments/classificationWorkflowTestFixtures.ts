import { providerSuccess } from '@orot/model-runtime';
import type {
  LanguageModelMessage,
  LanguageModelProvider,
  LanguageModelRequest,
} from '@orot/model-runtime';
import type { CalendarBridge, CalendarEvent } from '../calendar/types';
import type { classifyCalendarEvents } from './classificationWorkflow';

export function event(index: number): CalendarEvent {
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

export function workflowResponse(request: LanguageModelRequest) {
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

export function stringContent(
  message: LanguageModelMessage | undefined,
): string | undefined {
  return message &&
    message.role !== 'tool' &&
    typeof message.content === 'string'
    ? message.content
    : undefined;
}

export function makeProvider(
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

export function makeBridge(events: readonly CalendarEvent[]): CalendarBridge {
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

export function input(
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
