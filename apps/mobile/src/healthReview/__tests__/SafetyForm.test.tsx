import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { SafetyForm } from '../SafetyForm';
import { emptyHealthReviewSafety } from '../safetyInput';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker', {
  virtual: true,
});

function Form() {
  const [draft, setDraft] = useState(emptyHealthReviewSafety);
  return <SafetyForm draft={draft} onChange={setDraft} disabled={false} />;
}

it('uses the measured form width for wide rows and stacks them for large text', async () => {
  const original = Dimensions.get('window');
  Dimensions.set({ window: { ...original, fontScale: 1 } });
  await render(<Form />);
  await fireEvent(screen.getByTestId('health-review-form'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 1000, height: 700 } },
  });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-review-population-choices').props.style,
    ).flexDirection,
  ).toBe('row');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-review-measurement-row-0').props.style,
    ).flexDirection,
  ).toBe('row');
  await act(() => Dimensions.set({ window: { ...original, fontScale: 2 } }));
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-review-population-choices').props.style,
    ).flexDirection,
  ).not.toBe('row');
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-review-measurement-row-0').props.style,
    ).flexDirection,
  ).not.toBe('row');
  await act(() => Dimensions.set({ window: original }));
});

it('keeps unknown explicit, reveals all seven signs, and caps readings at two', async () => {
  await render(<Form />);
  expect(
    screen.getByRole('radio', {
      name: '현재 증상 확인: 알 수 없음',
      checked: true,
    }),
  ).toBeOnTheScreen();
  await fireEvent.press(
    screen.getByRole('radio', { name: '현재 증상 확인: 아래 증상이 있음' }),
  );
  for (const sign of [
    '가슴 통증',
    '숨참',
    '등 통증',
    '감각 저하',
    '힘이 빠짐',
    '시야 변화',
    '말하기 어려움',
  ]) {
    expect(screen.getByRole('button', { name: sign })).toBeOnTheScreen();
  }
  await fireEvent.press(screen.getByRole('button', { name: '반복 측정 추가' }));
  expect(screen.getByTestId('health-review-systolic-1')).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: '반복 측정 추가' })).toBeNull();
});
