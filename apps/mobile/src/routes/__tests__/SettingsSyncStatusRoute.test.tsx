import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { SettingsSyncStatusRoute } from '../SettingsSyncStatusRoute';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import type { HealthKitAutoSyncFeature } from '../../healthkit/autoSyncCheckpoint';

jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../navigation/useNavigationContentInset', () => ({
  useNavigationContentInset: () => [],
}));
jest.mock('../../layout/AdaptiveColumns', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AdaptiveColumns: ({
      primary,
      secondary,
      testID,
    }: {
      readonly primary: ReactNode;
      readonly secondary?: ReactNode;
      readonly testID: string;
    }) => React.createElement(View, { testID }, primary, secondary),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

test('shows saved sync state and refreshes it after an explicit retry', async () => {
  const loadSelection = jest.fn(async () => ['sleep'] as const);
  const loadStatus = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'retryable' as const,
      updatedAt: '2026-10-18T12:00:00.000Z',
    })
    .mockResolvedValueOnce({
      status: 'complete' as const,
      updatedAt: '2026-10-18T12:05:00.000Z',
    });
  const retrySync = jest.fn(async () => ({
    status: 'complete' as const,
    attemptedFeatures: ['sleep'] as const,
  }));
  const requestAccess = jest.fn(async () => 'fullAccess' as const);
  const refresh = jest.fn(async () => undefined);
  const calendarSync = {
    ...emptyCalendarAutoSyncState,
    requestAccess,
    refresh,
  };
  await render(
    <SettingsSyncStatusRoute
      loadSelection={loadSelection}
      loadStatus={loadStatus}
      retrySync={retrySync}
      calendarSync={calendarSync}
    />,
  );

  expect(
    await screen.findByTestId('settings-sync-selected-features'),
  ).toHaveTextContent('수면');
  expect(screen.getByTestId('settings-sync-status-message')).toHaveTextContent(
    '마지막 동기화 중 문제가 있었어요. 권한과 저장소 상태를 확인한 뒤 다시 시도해 주세요.',
  );
  expect(
    screen.getByTestId('settings-calendar-permission-note'),
  ).toHaveTextContent(/캘린더를 수정하거나 삭제하지 않아요\./u);
  expect(requestAccess).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('settings-calendar-request-access'));
  expect(requestAccess).toHaveBeenCalledTimes(1);
  await fireEvent.press(screen.getByTestId('settings-sync-retry'));

  expect(retrySync).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByTestId('settings-sync-status-message'),
  ).toHaveTextContent('마지막 동기화에서 선택한 기록을 확인했어요.');
  expect(
    screen.getByTestId('settings-sync-attempted-features'),
  ).toHaveTextContent('이번 시도에서 확인한 항목: 수면');
});

test('keeps retry disabled while saved selection is loading and when it is empty', async () => {
  let resolveSelection!: (
    selection: readonly HealthKitAutoSyncFeature[],
  ) => void;
  const selection = new Promise<readonly HealthKitAutoSyncFeature[]>(
    resolve => {
      resolveSelection = resolve;
    },
  );
  const retrySync = jest.fn();

  await render(
    <SettingsSyncStatusRoute
      loadSelection={() => selection}
      loadStatus={async () => null}
      retrySync={retrySync}
      calendarSync={{
        ...emptyCalendarAutoSyncState,
        requestAccess: jest.fn(async () => 'notDetermined' as const),
        refresh: jest.fn(async () => undefined),
      }}
    />,
  );

  expect(screen.getByTestId('settings-sync-status-message')).toHaveTextContent(
    '저장한 동기화 설정을 불러오는 중…',
  );
  expect(
    screen.getByTestId('settings-sync-retry').props.accessibilityState.disabled,
  ).toBe(true);

  await act(async () => {
    resolveSelection([]);
    await selection;
  });

  expect(
    await screen.findByTestId('settings-sync-status-message'),
  ).toHaveTextContent('자동 동기화할 건강 기록이 선택되지 않았어요.');
  expect(
    screen.getByTestId('settings-sync-retry').props.accessibilityState.disabled,
  ).toBe(true);
  expect(retrySync).not.toHaveBeenCalled();
});

// The synthetic retry result and persisted checkpoint are separate proof sources.
test('preserves the retry result when saved status cannot be reread during progress', async () => {
  let resolveRetry!: (result: {
    readonly status: 'complete';
    readonly attemptedFeatures: readonly HealthKitAutoSyncFeature[];
  }) => void;
  const pendingRetry = new Promise<{
    readonly status: 'complete';
    readonly attemptedFeatures: readonly HealthKitAutoSyncFeature[];
  }>(resolve => {
    resolveRetry = resolve;
  });
  const retrySync = jest.fn(() => pendingRetry);
  const loadStatus = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'retryable' as const,
      updatedAt: '2026-10-18T12:00:00.000Z',
    })
    .mockRejectedValueOnce(new Error('status checkpoint unavailable'));

  await render(
    <SettingsSyncStatusRoute
      loadSelection={async () => ['sleep']}
      loadStatus={loadStatus}
      retrySync={retrySync}
      calendarSync={{
        ...emptyCalendarAutoSyncState,
        requestAccess: jest.fn(async () => 'denied' as const),
        refresh: jest.fn(async () => undefined),
      }}
    />,
  );
  await screen.findByTestId('settings-sync-selected-features');

  const retryButton = screen.getByTestId('settings-sync-retry');
  await act(async () => {
    fireEvent.press(retryButton);
  });
  expect(retrySync).toHaveBeenCalledTimes(1);
  expect(retryButton.props.accessibilityState).toMatchObject({
    disabled: true,
    busy: true,
  });
  expect(
    jest.mocked(useNavigationLeaveStateRegistration),
  ).toHaveBeenLastCalledWith(
    expect.objectContaining({ canLeave: false, hasOngoingOperation: true }),
  );

  await act(async () => {
    resolveRetry({ status: 'complete', attemptedFeatures: ['sleep'] });
    await pendingRetry;
  });

  expect(
    await screen.findByTestId('settings-sync-status-message'),
  ).toHaveTextContent('마지막 동기화에서 선택한 기록을 확인했어요.');
  expect(
    screen.getByTestId('settings-sync-status-readback-error'),
  ).toHaveTextContent(
    '시도 결과는 확인했지만 저장된 상태를 다시 읽지 못했어요.',
  );
  expect(screen.queryByTestId('settings-sync-status-updated-at')).toBeNull();
  expect(retryButton.props.accessibilityState).toMatchObject({
    disabled: false,
    busy: false,
  });
  expect(
    jest.mocked(useNavigationLeaveStateRegistration),
  ).toHaveBeenLastCalledWith(
    expect.objectContaining({ canLeave: true, hasOngoingOperation: false }),
  );
});

test('reports a local settings load failure instead of claiming that no health records are selected', async () => {
  await render(
    <SettingsSyncStatusRoute
      loadSelection={async () => {
        throw new Error('local selection unavailable');
      }}
      loadStatus={async () => null}
      retrySync={jest.fn()}
      calendarSync={{
        ...emptyCalendarAutoSyncState,
        requestAccess: jest.fn(async () => 'notDetermined' as const),
        refresh: jest.fn(async () => undefined),
      }}
    />,
  );

  const status = await screen.findByTestId('settings-sync-status-message');
  expect(status).toHaveTextContent('동기화 상태를 불러오지 못했어요.');
  expect(status.props.accessibilityRole).toBe('alert');
  expect(status).not.toHaveTextContent(
    '자동 동기화할 건강 기록이 선택되지 않았어요.',
  );
  expect(
    screen.getByTestId('settings-sync-retry').props.accessibilityState.disabled,
  ).toBe(true);
});
