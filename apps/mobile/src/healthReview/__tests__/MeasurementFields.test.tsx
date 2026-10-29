import { fireEvent, render, screen } from '@testing-library/react-native';
import { MeasurementFields, formatMeasurementTime } from '../MeasurementFields';
import { emptySafetyReading } from '../safetyInput';

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { Pressable, Text: NativeText } = require('react-native');
  return ({
    mode,
    onValueChange,
  }: {
    mode: string;
    onValueChange: (event: object, date: Date) => void;
  }) =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Pressable,
        {
          accessibilityRole: 'button',
          accessibilityLabel: mode,
          onPress: () => {
            const selected = new Date('2026-10-28T00:15:00.000Z');
            onValueChange(
              { nativeEvent: { timestamp: selected.getTime(), utcOffset: 0 } },
              selected,
            );
          },
        },
        React.createElement(NativeText, null, mode),
      ),
      React.createElement(Pressable, {
        accessibilityRole: 'button',
        accessibilityLabel: `${mode}-invalid`,
        onPress: () =>
          onValueChange(
            { nativeEvent: { timestamp: 0, utcOffset: 0 } },
            undefined as unknown as Date,
          ),
      }),
    );
});

it('does not infer a timezone for an unknown timestamp', () => {
  expect(formatMeasurementTime('')).toBe('');
  expect(formatMeasurementTime('2026-10-28T09:00:00')).toBe('');
  expect(formatMeasurementTime('2026-10-28T00:00:00Z')).not.toBe('');
});

it('renders the same instant in the selected display timezone without changing storage', () => {
  const stored = '2026-10-28T00:00:00.000Z';
  const seoul = formatMeasurementTime(stored, 'Asia/Seoul');
  const newYork = formatMeasurementTime(stored, 'America/New_York');
  expect(seoul).toMatch(/9:00/);
  expect(newYork).toMatch(/8:00/);
  expect(seoul).not.toEqual(newYork);
  expect(new Date(stored).toISOString()).toBe(stored);
});

it('keeps the previous instant on cancel and applies an explicit selection on done', async () => {
  const onChange = jest.fn();
  const row = {
    ...emptySafetyReading(),
    measuredAt: '2026-10-27T00:00:00.000Z',
  };
  await render(
    <MeasurementFields
      row={row}
      index={0}
      disabled={false}
      onChange={onChange}
    />,
  );
  await fireEvent.press(screen.getByTestId('health-review-measuredAt-0'));
  // The real iOS module suppresses missing timestamps; this exercises the defensive boundary.
  await fireEvent.press(screen.getByRole('button', { name: 'date-invalid' }));
  await fireEvent.press(screen.getByRole('button', { name: '완료' }));
  expect(onChange).toHaveBeenLastCalledWith(row);
  onChange.mockClear();
  await fireEvent.press(screen.getByTestId('health-review-measuredAt-0'));
  await fireEvent.press(screen.getByRole('button', { name: 'date' }));
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('health-review-measuredAt-0'));
  await fireEvent.press(screen.getByRole('button', { name: 'date' }));
  await fireEvent(
    screen.getByTestId('health-review-time-picker'),
    'requestClose',
  );
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('health-review-measuredAt-0'));
  await fireEvent.press(screen.getByRole('button', { name: 'time' }));
  await fireEvent.press(screen.getByRole('button', { name: '완료' }));
  expect(onChange).toHaveBeenCalledWith({
    ...row,
    measuredAt: '2026-10-28T00:15:00.000Z',
  });
});
