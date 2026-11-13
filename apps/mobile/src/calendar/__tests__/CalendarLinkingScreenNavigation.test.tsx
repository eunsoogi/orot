import { fireEvent, render, screen } from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import { navigationText } from '../../i18n/navigation';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import type { CalendarBridge } from '../types';

// Empty fixtures keep this regression focused on the shared navigation controls.
const repository = {
  list: jest.fn(async () => []),
  create: jest.fn(),
  confirmCalendarEvent: jest.fn(),
  reconfirmCalendarEvent: jest.fn(),
  update: jest.fn(),
  cancel: jest.fn(),
} as unknown as AppointmentRepository;

const bridge: CalendarBridge = {
  requestAccessAndListUpcomingEvents: jest.fn(async () => ({
    access: 'fullAccess' as const,
    events: [],
  })),
  findEvent: jest.fn(async () => ({
    access: 'fullAccess' as const,
    event: null,
  })),
  addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
};

test('places Back and recording actions in the bottom menu', async () => {
  const onBack = jest.fn();
  const onOpenRecording = jest.fn();
  await render(
    <CalendarLinkingScreen
      repository={repository}
      bridge={bridge}
      onBack={onBack}

      onOpenRecording={onOpenRecording}
    />,
  );

  await fireEvent(screen.getByTestId('bottom-navigation-menu-host'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 430, height: 60 } },
  });
  expect(screen.getByTestId('navigation-bar-native-surface')).toBeVisible();
  await fireEvent.press(
    screen.getByRole('button', {
      name: navigationText.back.accessibilityLabel,
    }),
  );
  expect(screen.queryByTestId('navigation-home')).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', {
      name: navigationText.recording.accessibilityLabel,
    }),
  );

  expect(onBack).toHaveBeenCalledTimes(1);
  expect(onOpenRecording).toHaveBeenCalledTimes(1);
});
