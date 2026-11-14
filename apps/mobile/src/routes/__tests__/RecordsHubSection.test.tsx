import { fireEvent, render, screen, act } from '@testing-library/react-native';
import { Text } from 'react-native';
import { RecordsHubSection } from '../RecordsHubSection';

test('exposes separate neutral record and schedule selections without mixing content', async () => {
  const select = jest.fn(async () => {});
  await render(
    <RecordsHubSection selected="schedule" onSelect={select}>
      <Text>Calendar content</Text>
    </RecordsHubSection>,
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
