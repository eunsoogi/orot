import { Text } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';
import CalendarLinkingScreen from '../CalendarLinkingScreen';
import {
  bridge,
  repository,
  syncedCalendar,
} from '../calendarLinkingTestFixtures';

// The route header must belong to the calendar's single scroll owner, never a fixed sibling.
test('includes the supplied hub header in calendar scroll content', async () => {
  await render(
    <CalendarLinkingScreen
      repository={repository(async () => [])}
      bridge={bridge()}
      calendarSync={syncedCalendar([])}
      scrollHeader={<Text testID="scroll-banner">Banner</Text>}
    />,
  );
  expect(
    within(screen.getByTestId('calendar-screen')).getByTestId('scroll-banner'),
  ).toBeVisible();
});
