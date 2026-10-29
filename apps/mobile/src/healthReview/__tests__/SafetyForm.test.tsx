import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafetyForm } from '../SafetyForm';
import { emptyHealthReviewSafety } from '../safetyInput';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker', {
  virtual: true,
});

function Form() {
  const [draft, setDraft] = useState(emptyHealthReviewSafety);
  return <SafetyForm draft={draft} onChange={setDraft} disabled={false} />;
}

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
