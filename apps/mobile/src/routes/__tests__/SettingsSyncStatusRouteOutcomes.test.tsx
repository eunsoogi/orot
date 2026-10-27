import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import type { HealthKitAutoSyncFeature } from '../../healthkit/autoSyncCheckpoint';
import { SettingsSyncStatusRoute } from '../SettingsSyncStatusRoute';

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

test.each([
  {
    status: 'retryable',
    attemptedFeatures: ['sleep'] as const,
    message: '마지막 동기화 중 문제가 있었어요.',
    attemptedText: '이번 시도에서 확인한 항목: 수면',
  },
  {
    status: 'skipped',
    attemptedFeatures: [] as const,
    message: '이번 시도에서는 선택한 기록을 확인하지 않았어요. 선택 상태를 확인해 주세요.',
    attemptedText: null,
  },
])('shows the returned $status retry outcome and attempted categories', async ({
  status,
  attemptedFeatures,
  message,
  attemptedText,
}) => {
  const retrySync = jest.fn(async () => ({ status, attemptedFeatures }));
  await render(
    <SettingsSyncStatusRoute
      loadSelection={async () => ['sleep'] as readonly HealthKitAutoSyncFeature[]}
      loadStatus={async () => null}
      retrySync={retrySync}
      calendarSync={{
        ...emptyCalendarAutoSyncState,
        requestAccess: jest.fn(async () => 'notDetermined' as const),
        refresh: jest.fn(async () => undefined),
      }}
    />,
  );

  await screen.findByTestId('settings-sync-selected-features');
  await act(async () => {
    fireEvent.press(screen.getByTestId('settings-sync-retry'));
  });

  expect(retrySync).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('settings-sync-status-message')).toHaveTextContent(
    message,
  );
  if (attemptedText) {
    expect(screen.getByTestId('settings-sync-attempted-features')).toHaveTextContent(
      attemptedText,
    );
  } else {
    expect(screen.queryByTestId('settings-sync-attempted-features')).toBeNull();
  }
});
