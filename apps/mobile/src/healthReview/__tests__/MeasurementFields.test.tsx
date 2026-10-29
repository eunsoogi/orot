import { fireEvent, render, screen } from '@testing-library/react-native';
import { MeasurementFields, formatMeasurementTime } from '../MeasurementFields';
import { emptySafetyReading } from '../safetyInput';

jest.mock(
  '@react-native-community/datetimepicker',
  () => {
    const React = require('react');
    const { Pressable, Text: NativeText } = require('react-native');
    return ({
      mode,
      onChange,
    }: {
      mode: string;
      onChange: (event: object, date: Date) => void;
    }) =>
      React.createElement(
        Pressable,
        {
          accessibilityRole: 'button',
          accessibilityLabel: mode,
          onPress: () => onChange({}, new Date('2026-10-28T00:15:00.000Z')),
        },
        React.createElement(NativeText, null, mode),
      );
  },
  { virtual: true },
);

it('does not infer a timezone for an unknown timestamp', () => {
  expect(formatMeasurementTime('')).toBe('');
  expect(formatMeasurementTime('2026-10-28T09:00:00')).toBe('');
  expect(formatMeasurementTime('2026-10-28T00:00:00Z')).not.toBe('');
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
  await fireEvent.press(screen.getByRole('button', { name: 'date' }));
  await fireEvent.press(screen.getByRole('button', { name: '취소' }));
  expect(onChange).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('health-review-measuredAt-0'));
  await fireEvent.press(screen.getByRole('button', { name: 'time' }));
  await fireEvent.press(screen.getByRole('button', { name: '완료' }));
  expect(onChange).toHaveBeenCalledWith({
    ...row,
    measuredAt: '2026-10-28T00:15:00.000Z',
  });
});
