import { fireEvent, render, screen } from '@testing-library/react-native';
import { SettingsSyncStatusRoute } from '../SettingsSyncStatusRoute';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';

jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../navigation/useNavigationContentInset', () => ({
  useNavigationContentInset: () => [],
}));

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
});
