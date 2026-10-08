import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarBridge, CalendarEvent } from '../../calendar/types';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import * as classificationWorkflow from '../classificationWorkflow';
import MedicalAppointmentClassificationScreen from '../MedicalAppointmentClassificationScreen';

function event(identifier: string, title: string, date: string): CalendarEvent {
  return {
    calendarEventIdentifier: identifier,
    effectiveAt: `${date}T00:00:00.000Z`,
    endsAt: `${date}T01:00:00.000Z`,
    calendarEventSnapshot: {
      title,
      timeZoneIdentifier: 'Asia/Seoul',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
}

function repository(
  confirmCalendarEvent: (event: CalendarEvent) => Promise<unknown> = async () =>
    undefined,
): AppointmentRepository {
  return {
    list: jest.fn(async () => []),
    create: jest.fn(),
    confirmCalendarEvent: jest.fn(confirmCalendarEvent),
    reconfirmCalendarEvent: jest.fn(),
    update: jest.fn(),
    cancel: jest.fn(),
  } as unknown as AppointmentRepository;
}

function selectedProvider(): ProviderSelectionOption {
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'selected-provider',
    displayName: 'Selected provider',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: jest.fn(async () =>
      providerFailure({
        code: 'provider_unavailable',
        message: 'Provider unavailable.',
        retryable: true,
      }),
    ),
  };
  return {
    provider,
    modelId: 'selected-model',
    displayName: 'Selected AI',
    privacyBoundary: 'on-device',
    availability: { status: 'available' },
  };
}

interface ScreenOverrides {
  readonly selectedProvider?: ProviderSelectionOption | null;
  readonly recipient?: string | null;
}

async function renderScreen(
  queries: readonly (readonly CalendarEvent[])[],
  appointments: AppointmentRepository,
  overrides: ScreenOverrides = {},
) {
  const allEvents = queries.flat();
  const byId = new Map(
    allEvents.map(candidate => [candidate.calendarEventIdentifier, candidate]),
  );
  let queryIndex = 0;
  const bridge: CalendarBridge = {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [...queries[Math.min(queryIndex++, queries.length - 1)]!],
    })),
    findEvent: jest.fn(async identifier => ({
      access: 'fullAccess' as const,
      event: byId.get(identifier) ?? null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
  await render(
    <MedicalAppointmentClassificationScreen
      bridge={bridge}
      repository={appointments}
      selectedProvider={overrides.selectedProvider ?? null}
      recipient={overrides.recipient ?? null}
      onOpenManual={jest.fn()}
    />,
  );
  return bridge;
}

describe('medical appointment candidate selection regressions', () => {
  afterEach(() => jest.restoreAllMocks());

  it('distinguishes same-title occurrences and saves the selected one', async () => {
    const first = event('private-event-1', '치과 진료', '2035-06-02');
    const second = event('private-event-2', '치과 진료', '2035-06-03');
    const appointments = repository();
    const bridge = await renderScreen([[first, second]], appointments);

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));

    expect(await screen.findAllByText('치과 진료')).toHaveLength(2);
    expect(
      screen.getByText('2035년 6월 2일 09:00–10:00 · Asia/Seoul'),
    ).toBeTruthy();
    expect(
      screen.getByText('2035년 6월 3일 09:00–10:00 · Asia/Seoul'),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByTestId('medical-appointment-save-calendar-candidate-2'),
    );

    await waitFor(() =>
      expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(second),
    );
    expect(appointments.confirmCalendarEvent).not.toHaveBeenCalledWith(first);
    expect(bridge.findEvent).toHaveBeenCalledWith(
      'private-event-2',
      null,
      null,
    );
  });

  it('keeps the displayed occurrence stable while its save is pending', async () => {
    const first = event('private-event-a', 'A 진료', '2035-06-02');
    const next = event('private-event-b', 'B 진료', '2035-06-03');
    let finishSave!: () => void;
    const delayedSave = new Promise<void>(resolve => {
      finishSave = resolve;
    });
    const appointments = repository(() => delayedSave);
    const bridge = await renderScreen([[first], [next]], appointments);

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));
    expect(await screen.findByText('A 진료')).toBeTruthy();
    fireEvent.press(
      screen.getByTestId('medical-appointment-save-calendar-candidate-1'),
    );
    await waitFor(() =>
      expect(appointments.confirmCalendarEvent).toHaveBeenCalledWith(first),
    );

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));

    expect(bridge.requestAccessAndListUpcomingEvents).toHaveBeenCalledTimes(1);
    expect(screen.getByText('A 진료')).toBeTruthy();
    expect(screen.queryByText('B 진료')).toBeNull();

    finishSave();
    expect(await screen.findAllByText('일정을 저장했습니다.')).toHaveLength(2);
    expect(
      screen.getByTestId('medical-appointment-save-calendar-candidate-1').props
        .accessibilityState.disabled,
    ).toBe(true);
  });

  it('resets batch progress when reloading a new candidate set', async () => {
    const first = event('private-event-old', '기존 진료', '2035-06-02');
    const next = event('private-event-new', '새 진료', '2035-06-03');
    const appointments = repository();
    await renderScreen([[first], [next]], appointments, {
      selectedProvider: selectedProvider(),
      recipient: 'selected-account',
    });
    jest
      .spyOn(classificationWorkflow, 'classifyCalendarEvents')
      .mockResolvedValue({
        status: 'complete',
        candidates: [
          {
            candidateId: 'calendar-candidate-1',
            event: first,
            status: 'classified',
            classification: 'medical',
            reason: '제목에 진료 목적이 있습니다.',
            uncertainty: 'low',
          },
        ],
        completedBatches: 1,
        totalBatches: 1,
      });

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));
    expect(await screen.findByText('기존 진료')).toBeTruthy();
    await fireEvent.press(screen.getByText('선택한 AI로 분류'));
    expect(await screen.findByText(/1\/1/)).toBeTruthy();

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));
    expect(await screen.findByText('새 진료')).toBeTruthy();
    expect(screen.getByText(/0\/0/)).toBeTruthy();
  });
});
