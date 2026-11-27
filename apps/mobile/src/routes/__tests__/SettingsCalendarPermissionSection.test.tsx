import { fireEvent, render, screen } from '@testing-library/react-native';
import { emptyCalendarAutoSyncState } from '../../calendar/calendarAutoSync';
import { SettingsCalendarSyncSection } from '../SettingsCalendarSyncSection';

test('keeps permission explanation and request separate from calendar refresh', async () => {
  const requestAccess = jest.fn(async () => 'fullAccess' as const);
  const refresh = jest.fn(async () => {});
  await render(
    <SettingsCalendarSyncSection
      mode="permission"
      sync={{
        ...emptyCalendarAutoSyncState,
        access: 'notDetermined',
        requestAccess,
        refresh,
      }}
    />,
  );
  expect(screen.getByTestId('settings-calendar-permission-note')).toBeVisible();
  expect(screen.queryByTestId('settings-calendar-refresh')).toBeNull();
  await fireEvent.press(screen.getByTestId('settings-calendar-request-access'));
  expect(requestAccess).toHaveBeenCalledTimes(1);
  expect(refresh).not.toHaveBeenCalled();
});
