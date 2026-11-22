import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { useState } from 'react';
import { Animated, Text, ScrollView } from 'react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { RecordsHubSection } from '../RecordsHubSection';

function ScheduleContent() {
  return (
    <ScrollView testID="schedule-scroll">
      <Text>Calendar content</Text>
    </ScrollView>
  );
}

test('exposes separate neutral record and schedule selections without mixing content', async () => {
  const select = jest.fn(async () => {});
  await render(
    <RecordsHubSection selected="schedule" onSelect={select}>
      <ScheduleContent />
    </RecordsHubSection>,
  );
  expect(screen.getByTestId('records-hub-header')).toBeVisible();
  expect(screen.getByTestId('schedule-scroll')).not.toContainElement(
    screen.getByTestId('records-hub-header'),
  );
  expect(
    screen.getByTestId('records-section-schedule').props.accessibilityState
      .selected,
  ).toBe(true);
  expect(
    screen.getByTestId('records-section-records').props.accessibilityState
      .selected,
  ).toBe(false);
  await fireEvent.press(screen.getByTestId('records-section-schedule'));
  expect(select).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('records-section-records'));
  expect(select).toHaveBeenCalledWith('records');
  expect(screen.getByText('Calendar content')).toBeVisible();
});

test('waits for guarded navigation and does not locally discard current content', async () => {
  let release!: () => void;
  const select = jest.fn(
    () =>
      new Promise<void>(resolve => {
        release = resolve;
      }),
  );
  await render(
    <RecordsHubSection selected="records" onSelect={select}>
      <Text>Staged document</Text>
    </RecordsHubSection>,
  );
  await fireEvent.press(screen.getByTestId('records-section-schedule'));
  expect(
    screen.getByTestId('records-section-records').props.accessibilityState
      .selected,
  ).toBe(true);
  expect(screen.getByText('Staged document')).toBeVisible();
  expect(
    screen.getByTestId('records-section-schedule').props.accessibilityState
      .disabled,
  ).toBe(true);
  await act(async () => release());
  expect(
    screen.getByTestId('records-section-schedule').props.accessibilityState
      .disabled,
  ).toBe(false);
});

test('keeps the same hub header while only the current body moves left or right', async () => {
  function Tabs() {
    const [selected, setSelected] = useState<'records' | 'schedule'>('records');
    return (
      <RecordsHubSection
        selected={selected}
        onSelect={async next => setSelected(next)}
      >
        {selected === 'records' ? (
          <Text>Record content</Text>
        ) : (
          <ScheduleContent />
        )}
      </RecordsHubSection>
    );
  }
  const stop = jest.fn();
  const timing = jest.spyOn(Animated, 'timing').mockReturnValue({
    stop,
    start: jest.fn(),
    reset: jest.fn(),
  });
  const host = (reduced: boolean) => (
    <NavigationMotionContext.Provider value={reduced}>
      <Tabs />
    </NavigationMotionContext.Provider>
  );
  try {
    const view = await render(host(false));
    const header = screen.getByTestId('records-hub-header');
    const tabs = screen.getByTestId('records-section-tabs');
    const body = screen.getByTestId('navigation-inline-transition');
    expect(body).toHaveStyle({ transform: [{ translateX: 0 }] });
    expect(body).not.toContainElement(header);
    await fireEvent(body, 'layout', {
      nativeEvent: { layout: { width: 420, height: 550, x: 0, y: 0 } },
    });
    await fireEvent.press(screen.getByTestId('records-section-schedule'));
    expect(screen.getByTestId('records-hub-header')).toBe(header);
    expect(screen.getByTestId('records-section-tabs')).toBe(tabs);
    expect(body).toHaveStyle({ transform: [{ translateX: 420 }] });
    expect(body).toContainElement(screen.getByTestId('schedule-scroll'));
    expect(screen.queryByText('Record content')).toBeNull();
    expect(screen.queryByTestId('navigation-route-scroll')).toBeNull();
    await fireEvent.press(screen.getByTestId('records-section-records'));
    expect(stop).toHaveBeenCalled();
    expect(body).toHaveStyle({ transform: [{ translateX: -420 }] });
    expect(screen.queryByTestId('schedule-scroll')).toBeNull();
    expect(screen.getAllByTestId('navigation-route-scroll')).toHaveLength(1);
    await view.rerender(host(true));
    await fireEvent.press(screen.getByTestId('records-section-schedule'));
    expect(body).toHaveStyle({ transform: [{ translateX: 0 }] });
    expect(timing).toHaveBeenCalledTimes(2);
  } finally {
    timing.mockRestore();
  }
});
