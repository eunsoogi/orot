import type { LanguageModelRequest } from '@orot/model-runtime';
import type { CalendarEvent } from '../../calendar/types';
import {
  event,
  makeBridge,
  workflowResponse,
} from '../classificationWorkflowTestFixtures';
export function key(index: number) {
  return 'v1:' + index.toString(16).padStart(64, '0');
}
export function record(index: number, revision = index) {
  return {
    ...event(index),
    classificationWitness: {
      occurrence: key(index),
      revision: key(revision),
    },
  };
}
const authorized = ['2035-06-01T00:00:00Z', '2036-06-01T00:00:00Z'] as const;
export function native(events: CalendarEvent[], authorizedRead = true) {
  return {
    ...makeBridge(events),
    findEvent: jest.fn(async (id: string, occurrence: string | null) => ({
      access: 'fullAccess' as const,
      event:
        events.find(
          e =>
            e.calendarEventIdentifier === id &&
            e.calendarEventSnapshot.occurrenceDate === occurrence,
        ) ?? null,
    })),
    listUpcomingEvents: jest.fn(async () => ({
      access: authorizedRead ? ('fullAccess' as const) : ('denied' as const),
      events: authorizedRead ? events : [],
      query: {
        fromInclusive: authorized[0],
        toExclusive: authorized[1],
        horizonYears: 1 as const,
        resultLimit: null,
        complete: true,
        omittedEventCount: 0,
      },
    })),
  };
}
export const provider = () =>
  jest.fn(async (request: LanguageModelRequest) => {
    const accepted = workflowResponse(request);
    if (accepted.ok)
      return {
        ...accepted,
        value: {
          ...accepted.value,
          text: accepted.value.text.replaceAll(
            'uncertain_medium',
            'non_medical_medium',
          ),
        },
      };
    return accepted;
  });
