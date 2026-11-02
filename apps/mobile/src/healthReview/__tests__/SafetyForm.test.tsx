import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { SafetyForm } from '../SafetyForm';
import { emptyHealthReviewSafety } from '../safetyInput';

jest.mock('@react-native-community/datetimepicker', () => 'DateTimePicker');

function Form({ disabled = false }: { disabled?: boolean }) {
  const [draft, setDraft] = useState(emptyHealthReviewSafety);
  return <SafetyForm draft={draft} onChange={setDraft} disabled={disabled} />;
}

it('uses the measured form width for choice rows and stacks them for large text', async () => {
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
      screen.getByTestId('health-review-visit-choices').props.style,
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
      screen.getByTestId('health-review-visit-choices').props.style,
    ).flexDirection,
  ).not.toBe('row');
  await act(() => Dimensions.set({ window: original }));
});

it('marks symptom checkboxes and the Other input disabled during a run', async () => {
  const draft = {
    ...emptyHealthReviewSafety(),
    symptoms: 'warning_signs' as const,
    otherSelected: true,
  };
  const onChange = jest.fn();
  await render(<SafetyForm draft={draft} onChange={onChange} disabled />);
  const other = screen.getByRole('checkbox', {
    name: '기타',
    disabled: true,
    checked: true,
  });
  await fireEvent.press(other);
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText('기타 증상')).toHaveProp('editable', false);
});

it('keeps unknown symptoms explicit and retains general safety inputs without manual blood-pressure fields', async () => {
  await render(<Form />);
  expect(
    screen.getByRole('radio', {
      name: '대상 정보: 알 수 없음',
      checked: true,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('radio', {
      name: '현재 증상 확인: 알 수 없음',
      checked: true,
    }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('radio', {
      name: '예정된 진료: 알 수 없음',
      checked: true,
    }),
  ).toBeOnTheScreen();
  for (const id of [
    'health-review-systolic-0',
    'health-review-diastolic-0',
    'health-review-measuredAt-0',
    'health-review-source-0',
  ])
    expect(screen.queryByTestId(id)).toBeNull();
  for (const label of ['혈압 측정 상황', '혈압 입력 (선택)', '반복 측정 추가'])
    expect(screen.queryByText(label)).toBeNull();
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
    expect(screen.getByRole('checkbox', { name: sign })).toBeOnTheScreen();
  }
  await fireEvent.press(
    screen.getByRole('radio', { name: '예정된 진료: 예정된 진료가 있음' }),
  );
  expect(
    screen.getByRole('radio', {
      name: '예정된 진료: 예정된 진료가 있음',
      checked: true,
    }),
  ).toBeOnTheScreen();
});

it('exposes multiple checked symptoms and restores an unchecked Other draft', async () => {
  await render(<Form />);
  await fireEvent.press(
    screen.getByRole('radio', { name: '현재 증상 확인: 아래 증상이 있음' }),
  );
  await fireEvent.press(screen.getByRole('checkbox', { name: '가슴 통증' }));
  await fireEvent.press(screen.getByRole('checkbox', { name: '숨참' }));
  expect(
    screen.getByRole('checkbox', { name: '가슴 통증', checked: true }),
  ).toBeOnTheScreen();
  expect(
    screen.getByRole('checkbox', { name: '숨참', checked: true }),
  ).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', { name: '기타' }));
  await fireEvent.changeText(screen.getByLabelText('기타 증상'), '어지러움');
  await fireEvent.press(screen.getByRole('checkbox', { name: '기타' }));
  expect(screen.queryByLabelText('기타 증상')).toBeNull();
  await fireEvent.press(screen.getByRole('checkbox', { name: '기타' }));
  expect(screen.getByLabelText('기타 증상')).toHaveProp('value', '어지러움');
  await fireEvent.press(
    screen.getByRole('radio', { name: '현재 증상 확인: 알 수 없음' }),
  );
  expect(screen.queryByLabelText('기타 증상')).toBeNull();
  await fireEvent.press(
    screen.getByRole('radio', { name: '현재 증상 확인: 아래 증상이 있음' }),
  );
  expect(
    screen.getByRole('checkbox', { name: '가슴 통증', checked: true }),
  ).toBeOnTheScreen();
  expect(screen.getByLabelText('기타 증상')).toHaveProp('value', '어지러움');
});
