import { act } from '@testing-library/react-native';
import { providerFailure } from '@orot/model-runtime';
import {
  renderWithRootSafeArea,
  withRootSafeArea,
} from '../../test-support/safeAreaTestProviders';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarAutoSyncState } from '../calendar/calendarAutoSync';
import type { CalendarBridge, CalendarEvent } from '../calendar/types';
import type { ProviderSelectionOption } from '../providers/selection/types';
import type {
  CandidateReview,
  ClassificationRunResult,
} from './classificationWorkflow';
import MedicalAppointmentClassificationScreen from './MedicalAppointmentClassificationScreen';

/** Synthetic occurrences share no real EventKit identity or health data. */
export function event(
  identifier: string,
  title: string,
  date: string,
): CalendarEvent {
  return {
    calendarEventIdentifier: identifier,
    effectiveAt: `${date}T00:00:00.000Z`,
    endsAt: `${date}T01:00:00.000Z`,
    calendarEventSnapshot: {
      title,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: `${date}T00:00:00.000Z`,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

export function repository(
  confirm: (event: CalendarEvent) => Promise<unknown> = async () => undefined,
): AppointmentRepository {
  return {
    list: jest.fn(async () => []),
    create: jest.fn(),
    confirmCalendarEvent: jest.fn(confirm),
    reconfirmCalendarEvent: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
  } as unknown as AppointmentRepository;
}

export function selectedProvider(): ProviderSelectionOption {
  return {
    provider: {
      kind: 'language-model',
      id: 'selected-provider',
      displayName: 'Synthetic AI',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate: jest.fn(async () =>
        providerFailure({
          code: 'provider_unavailable',
          message: 'Synthetic failure',
          retryable: true,
        }),
      ),
    },
    modelId: 'selected-model',
    displayName: 'Synthetic AI',
    privacyBoundary: 'on-device',
    availability: { status: 'available' },
  };
}

export function result(
  events: readonly CalendarEvent[],
  classifications: readonly CandidateReview['classification'][] = events.map(
    () => 'medical',
  ),
): ClassificationRunResult {
  return {
    status: 'complete',
    completedBatches: 1,
    totalBatches: 1,
    candidates: events.map((value, index) => ({
      candidateId: `calendar-candidate-${index + 1}`,
      event: value,
      status: classifications[index] ? 'classified' : 'unclassified',
      classification: classifications[index],
      reason: 'Synthetic classification',
      uncertainty: 'low',
    })),
  };
}

export function calendarSyncState(
  events: readonly CalendarEvent[],
  access: CalendarAutoSyncState['access'] = 'fullAccess',
): CalendarAutoSyncState {
  return {
    access,
    events,
    query:
      access === 'fullAccess'
        ? {
            fromInclusive: '2035-01-01T00:00:00.000Z',
            toExclusive: '2036-01-01T00:00:00.000Z',
            horizonYears: 1,
            resultLimit: null,
            complete: true,
            omittedEventCount: 0,
          }
        : null,
    loading: false,
    error: false,
    updatedAt: '2035-01-01T00:00:00.000Z',
  };
}

export async function renderScreen(
  queries: readonly (readonly CalendarEvent[])[],
  appointments: AppointmentRepository,
  provider: ProviderSelectionOption | null = selectedProvider(),
  calendarSync = calendarSyncState(queries[0] ?? []),
) {
  const allEvents = queries.flat();
  let index = 0;
  const bridge: CalendarBridge = {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [...queries[Math.min(index++, queries.length - 1)]!],
      query: {
        fromInclusive: '2035-01-01T00:00:00.000Z',
        toExclusive: '2036-01-01T00:00:00.000Z',
        horizonYears: 1 as const,
        resultLimit: null,
        complete: true,
        omittedEventCount: 0,
      },
    })),
    findEvent: jest.fn(async (identifier, occurrenceDate) => ({
      access: 'fullAccess' as const,
      event:
        allEvents.find(
          value =>
            value.calendarEventIdentifier === identifier &&
            value.calendarEventSnapshot.occurrenceDate === occurrenceDate,
        ) ?? null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  const onOpenManual = jest.fn();
  const onOpenCalendarSettings = jest.fn();
  const onOpenProviderSelection = jest.fn();
  const screenProps = {
    bridge,
    repository: appointments,
    selectedProvider: provider,
    recipient: provider ? 'selected-account' : null,
    onOpenManual,
    onOpenCalendarSettings,
    onOpenProviderSelection,
  };
  const view = await renderWithRootSafeArea(
    <MedicalAppointmentClassificationScreen
      {...screenProps}
      calendarSync={calendarSync}
    />,
  );
  return {
    bridge,
    onOpenManual,
    onOpenCalendarSettings,
    onOpenProviderSelection,
    updateCalendarSync: async (next: CalendarAutoSyncState) => {
      await act(async () => {
        view.rerender(
          withRootSafeArea(
            <MedicalAppointmentClassificationScreen
              {...screenProps}
              calendarSync={next}
            />,
          ),
        );
      });
    },
    view,
  };
}
