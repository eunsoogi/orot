import { fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { useNavigationRouteScrollSuspension } from '../../navigation/NavigationRouteScrollView';
import { ScheduleMonthGrid } from '../ScheduleMonthGrid';
import { event } from '../calendarTestUtils';

jest.mock('../../navigation/NavigationRouteScrollView', () => ({
  useNavigationRouteScrollSuspension: jest.fn(),
}));
const suspendScroll = jest.mocked(useNavigationRouteScrollSuspension);
const date = '2035-06-02';
const days = [{ dateKey: date, dayNumber: 2, belongsToMonth: true }];
const clinic = event('clinic', '2035-06-02T00:00:00.000Z');
const items = [
  { event: clinic, rowKey: 'clinic', canSelect: true, isNextVisit: true },
  {
    event: event('second', '2035-06-02T01:00:00.000Z'),
    rowKey: 'second',
    canSelect: true,
    isNextVisit: false,
  },
];
const point = (identifier: number, pageX: number, pageY: number) => ({
  identifier,
  pageX,
  pageY,
});
const touch = (...touches: ReturnType<typeof point>[]) => ({
  nativeEvent: { touches, changedTouches: touches },
});
function setup(largeText = false) {
  const release = jest.fn();
  const suspend = jest.fn(() => release);
  const page = jest.fn();
  const focus = jest.fn();
  const select = jest.fn();
  suspendScroll.mockReturnValue(suspend);
  const tree = (
    <ScheduleMonthGrid
      days={days}
      eventsForDay={() => items}
      focusDate={focus}
      focusedDate={date}
      todayDate="2035-06-01"
      width={393}
      largeText={largeText}
      selectedEvent={null}
      selectionDisabled={false}
      selectEvent={select}
      onSwipeMonth={page}
    />
  );
  return { tree, release, suspend, page, focus, select };
}

it('starts compact, follows vertical finger span in layout, and releases route scroll', async () => {
  const { tree, suspend, release, page, select } = setup();
  const screen = await render(tree);
  const grid = screen.getByTestId('calendar-date-grid');
  const cell = screen.getByTestId(`schedule-date-events-${date}`);
  const bar = within(cell).getByTestId(`schedule-event-bar-${date}-clinic`);
  const startCell = StyleSheet.flatten(cell.props.style).minHeight;
  const startBar = StyleSheet.flatten(bar.props.style).minHeight;
  expect(startCell).toBe(48);
  expect(startBar).toBeLessThan(44);
  expect(within(cell).getByTestId('schedule-date-event-overflow')).toBeTruthy();

  const pair = touch(point(1, 10, 50), point(2, 60, 90));
  expect(grid.props.onStartShouldSetResponderCapture(pair)).toBe(true);
  await fireEvent(grid, 'responderGrant', pair);
  expect(suspend).toHaveBeenCalledTimes(1);
  // Sideways finger motion is not calendar density.
  await fireEvent(
    grid,
    'responderMove',
    touch(point(1, 0, 50), point(2, 90, 90)),
  );
  expect(StyleSheet.flatten(cell.props.style).minHeight).toBe(startCell);

  await fireEvent(
    grid,
    'responderMove',
    touch(point(1, 0, 12), point(2, 90, 130)),
  );
  expect(StyleSheet.flatten(cell.props.style).minHeight).toBeGreaterThan(
    startCell,
  );
  expect(StyleSheet.flatten(bar.props.style).minHeight).toBeGreaterThan(
    startBar,
  );
  expect(
    within(cell).getByTestId(`schedule-event-bar-${date}-second`),
  ).toBeTruthy();
  await fireEvent(grid, 'responderRelease', touch(point(1, 10, 12)));
  expect(release).toHaveBeenCalledTimes(1);
  expect(page).not.toHaveBeenCalled();
  expect(select).not.toHaveBeenCalled();

  const closer = touch(point(1, 10, 12), point(2, 60, 150));
  expect(grid.props.onStartShouldSetResponderCapture(closer)).toBe(true);
  await fireEvent(grid, 'responderGrant', closer);
  await fireEvent(grid, 'responderMove', pair);
  expect(StyleSheet.flatten(cell.props.style).minHeight).toBe(startCell);
  expect(StyleSheet.flatten(bar.props.style).minHeight).toBe(startBar);
  await fireEvent(grid, 'responderTerminate', touch());
  expect(release).toHaveBeenCalledTimes(2);
});

it('passes ordinary taps and vertical scroll through and pages only completed horizontal swipes', async () => {
  const { tree, focus, page, suspend, release } = setup();
  const screen = await render(tree);
  const grid = screen.getByTestId('calendar-date-grid');
  const initial = touch(point(1, 100, 100));
  const horizontal = touch(point(1, 75, 104));
  expect(grid.props.onStartShouldSetResponderCapture(initial)).toBe(false);
  expect(
    grid.props.onMoveShouldSetResponderCapture(touch(point(1, 80, 165))),
  ).toBe(false);
  await fireEvent.press(screen.getByTestId(`calendar-day-${date}`));
  expect(focus).toHaveBeenCalledWith(date);
  expect(suspend).not.toHaveBeenCalled();
  // A second finger beginning outside the grid is not part of its pinch.
  expect(
    grid.props.onMoveShouldSetResponderCapture(
      touch(point(1, 100, 100), point(3, 125, 132)),
    ),
  ).toBe(false);

  expect(grid.props.onStartShouldSetResponderCapture(initial)).toBe(false);
  expect(grid.props.onMoveShouldSetResponderCapture(horizontal)).toBe(true);
  await fireEvent(grid, 'responderGrant', horizontal);
  await fireEvent(grid, 'responderRelease', touch(point(1, 67, 103)));
  expect(page).not.toHaveBeenCalled();

  grid.props.onStartShouldSetResponderCapture(initial);
  await fireEvent(grid, 'responderGrant', horizontal);
  await fireEvent(grid, 'responderRelease', touch(point(1, 20, 105)));
  expect(page).toHaveBeenLastCalledWith(1);

  const right = touch(point(1, 120, 102));
  grid.props.onStartShouldSetResponderCapture(initial);
  await fireEvent(grid, 'responderGrant', right);
  await fireEvent(grid, 'responderRelease', touch(point(1, 175, 100)));
  expect(page).toHaveBeenLastCalledWith(-1);
  expect(release).toHaveBeenCalledTimes(3);
});

it('keeps large-text event targets full-height even at minimum density', async () => {
  const { tree } = setup(true);
  const screen = await render(tree);
  const bar = screen.getByTestId(`schedule-event-bar-${date}-clinic`);
  expect(StyleSheet.flatten(bar.props.style).minHeight).toBeGreaterThanOrEqual(
    44,
  );
  expect(screen.getByText('clinic').props.numberOfLines).toBeUndefined();
});
