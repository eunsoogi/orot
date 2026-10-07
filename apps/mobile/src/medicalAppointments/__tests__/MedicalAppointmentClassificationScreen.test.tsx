import { fireEvent, render, screen } from '@testing-library/react-native';
import { providerFailure } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { AppointmentRepository } from '@orot/storage';
import type { CalendarBridge, CalendarEvent } from '../../calendar/types';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import MedicalAppointmentClassificationScreen from '../MedicalAppointmentClassificationScreen';

function event(): CalendarEvent {
  return {
    calendarEventIdentifier: 'private-calendar-id',
    effectiveAt: '2035-06-02T00:00:00.000Z',
    endsAt: '2035-06-02T01:00:00.000Z',
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

function provider(): LanguageModelProvider {
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
    generate: jest.fn(async () =>
      providerFailure({
        code: 'provider_unavailable',
        message: 'Provider unavailable.',
        retryable: true,
      }),
    ),
  };
}

function selectedProvider(): ProviderSelectionOption {
  return {
    provider: provider(),
    modelId: 'selected-model',
    displayName: 'Selected AI',
    privacyBoundary: 'selected-context-remote',
    availability: { status: 'available' },
  };
}

describe('medical appointment review fallback', () => {
  it('keeps manual candidate selection available after provider failure', async () => {
    const selected = event();
    const requestAccessAndListUpcomingEvents = jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [selected],
    }));
    const findEvent = jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: selected,
    }));
    const bridge: CalendarBridge = {
      requestAccessAndListUpcomingEvents,
      findEvent,
      addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    };
    const repository = {
      list: jest.fn(async () => []),
      create: jest.fn(),
      confirmCalendarEvent: jest.fn(),
      reconfirmCalendarEvent: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    } as unknown as AppointmentRepository;
    const onOpenManual = jest.fn();

    await render(
      <MedicalAppointmentClassificationScreen
        bridge={bridge}
        repository={repository}
        selectedProvider={selectedProvider()}
        recipient="selected-account"
        consent={{ authorize: async () => 'authorized' }}
        onOpenManual={onOpenManual}
      />,
    );

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));
    expect(await screen.findByText('치과 진료')).toBeTruthy();
    await fireEvent.press(screen.getByText('선택한 AI로 분류'));
    expect(
      await screen.findByText(
        'AI 결과를 사용할 수 없어 분류하지 않았습니다. 직접 확인해 주세요.',
      ),
    ).toBeTruthy();

    await fireEvent.press(
      screen.getByTestId('medical-appointment-save-calendar-candidate-1'),
    );

    expect(findEvent).toHaveBeenCalledTimes(2);
    expect(repository.confirmCalendarEvent).toHaveBeenCalledWith(selected);
    expect(
      (await screen.findAllByText('일정을 저장했습니다.')).length,
    ).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('medical-appointment-manual'));
    expect(onOpenManual).toHaveBeenCalledTimes(1);
  });

  it('keeps the separate manual entry route available when Calendar permission is denied', async () => {
    const bridge = {
      requestAccessAndListUpcomingEvents: jest.fn(async () => ({
        access: 'denied' as const,
        events: [],
      })),
      findEvent: jest.fn(),
      addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
    } as unknown as CalendarBridge;
    const repository = {
      list: jest.fn(async () => []),
      create: jest.fn(),
      confirmCalendarEvent: jest.fn(),
      reconfirmCalendarEvent: jest.fn(),
      update: jest.fn(),
      cancel: jest.fn(),
    } as unknown as AppointmentRepository;
    const onOpenManual = jest.fn();

    await render(
      <MedicalAppointmentClassificationScreen
        bridge={bridge}
        repository={repository}
        selectedProvider={null}
        recipient={null}
        consent={null}
        onOpenManual={onOpenManual}
      />,
    );

    await fireEvent.press(screen.getByText('캘린더 일정 불러오기'));
    expect(
      await screen.findByText(/캘린더 읽기 권한을 사용할 수 없습니다/u),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId('medical-appointment-manual'));

    expect(onOpenManual).toHaveBeenCalledTimes(1);
    expect(repository.create).not.toHaveBeenCalled();
  });
});
