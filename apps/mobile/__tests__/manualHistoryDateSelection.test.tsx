import { act, fireEvent, render } from '@testing-library/react-native';
import ManualHistoryForm from '../src/manualHistory/ManualHistoryForm';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import {
  ManualHistoryDatePicker,
  manualHistoryDateValue,
} from '../src/manualHistory/ManualHistoryDatePicker';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

// Observe the form callback while rendering the real fields, so rapid saves reach the screen's guard.
jest.mock('../src/manualHistory/ManualHistoryForm', () => {
  const Actual = jest.requireActual(
    '../src/manualHistory/ManualHistoryForm',
  ).default;
  return {
    __esModule: true,
    default: jest.fn((props: React.ComponentProps<typeof Actual>) => (
      <Actual {...props} />
    )),
  };
});

test('calendar browsing does not infer a date and explicit leap-day selection preserves date-only storage', async () => {
  const view = await render(
    <ManualHistoryScreen
      onBack={jest.fn()}
      repository={createManualHistoryTestRepository()}
    />,
  );
  await fireEvent.press(await view.findByTestId('manual-history-add'));
  await fireEvent.press(view.getByTestId('manual-history-open-date-picker'));
  await fireEvent.press(view.getByTestId('manual-history-previous-month'));
  expect(
    view.getByTestId('manual-history-effective-date-input').props.value,
  ).toBe('');
  await fireEvent.press(view.getByTestId('manual-history-open-date-picker'));
  await fireEvent.changeText(
    view.getByTestId('manual-history-effective-date-input'),
    '2024-02-09',
  );
  await fireEvent.press(view.getByTestId('manual-history-open-date-picker'));
  expect(view.queryByTestId('manual-history-calendar-day-30')).toBeNull();
  await fireEvent.press(view.getByTestId('manual-history-calendar-day-29'));
  expect(
    view.getByTestId('manual-history-effective-date-input').props.value,
  ).toBe('2024-02-29');
  await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
  expect(view.queryByTestId('manual-history-effective-date-input')).toBeNull();
  expect(view.queryByTestId('manual-history-date-picker')).toBeNull();
  await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
  expect(
    view.getByTestId('manual-history-effective-date-input').props.value,
  ).toBe('');
});

test('calendar arithmetic preserves early years and Gregorian leap-year boundaries', async () => {
  expect(manualHistoryDateValue(1, 0, 1)).toBe('0001-01-01');
  const onChange = jest.fn();
  const view = await render(
    <ManualHistoryDatePicker
      value="0004-02-01"
      disabled={false}
      onChange={onChange}
    />,
  );
  await fireEvent.press(view.getByTestId('manual-history-calendar-day-29'));
  expect(onChange).toHaveBeenLastCalledWith('0004-02-29');
  await fireEvent.press(view.getByTestId('manual-history-previous-month'));
  await fireEvent.press(view.getByTestId('manual-history-calendar-day-31'));
  expect(onChange).toHaveBeenLastCalledWith('0004-01-31');
  await view.unmount();
  const century = await render(
    <ManualHistoryDatePicker
      value="1900-02-01"
      disabled={false}
      onChange={onChange}
    />,
  );
  expect(century.queryByTestId('manual-history-calendar-day-29')).toBeNull();
});

// Calling the form callback twice covers the same-event interval before disabled props publish.
test('locks duplicate save and cancellation until failure, then retains the complete input for retry', async () => {
  const repository = createManualHistoryTestRepository();
  let rejectSave: (reason: Error) => void = () => undefined;
  const create = jest.spyOn(repository, 'create').mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectSave = reject;
      }),
  );
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  await fireEvent.press(await view.findByTestId('manual-history-add'));
  await fireEvent.changeText(
    view.getByTestId('manual-history-title-input'),
    'Synthetic pending record',
  );
  await fireEvent.changeText(
    view.getByTestId('manual-history-details-input'),
    'Synthetic pending details.',
  );
  await fireEvent.press(view.getByTestId('manual-history-kind-procedure'));
  await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
  const save = jest.mocked(ManualHistoryForm).mock.calls.at(-1)![0].onSave;
  const input = {
    kind: 'procedure' as const,
    title: 'Synthetic pending record',
    details: 'Synthetic pending details.',
    effectiveDate: { status: 'unknown' as const },
  };
  const pending: Promise<void>[] = [];
  await act(() => {
    pending.push(save(input), save(input));
  });
  expect(create).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('manual-history-form-close')).toBeDisabled();
  expect(view.getByTestId('manual-history-save')).toBeDisabled();
  await fireEvent.press(view.getByTestId('manual-history-form-close'));
  expect(view.getByTestId('manual-history-form')).toBeTruthy();
  await act(async () => {
    rejectSave(new Error('Synthetic failed save'));
    await Promise.all(pending);
  });
  expect(view.getByTestId('manual-history-title-input').props.value).toBe(
    'Synthetic pending record',
  );
  expect(view.getByTestId('manual-history-details-input').props.value).toBe(
    'Synthetic pending details.',
  );
  expect(
    view.getByTestId('manual-history-kind-procedure').props.accessibilityState
      .selected,
  ).toBe(true);
  expect(view.getByTestId('manual-history-date-unknown-selected')).toBeTruthy();
  expect(view.getByTestId('manual-history-save')).toBeEnabled();
  await fireEvent.press(view.getByTestId('manual-history-save'));
  expect(await repository.list()).toMatchObject([
    {
      title: 'Synthetic pending record',
      kind: 'procedure',
      effectiveDate: { status: 'unknown' },
    },
  ]);
});

test('cancelling an edit preserves the original known date and selected detail', async () => {
  const repository = createManualHistoryTestRepository();
  const entry = await repository.create({
    kind: 'note',
    title: 'Synthetic original',
    details: 'Synthetic original details.',
    effectiveDate: { status: 'known', date: '2024-05-10' },
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  await fireEvent.press(
    await view.findByTestId('manual-history-details-' + entry.id),
  );
  await fireEvent.press(view.getByTestId('manual-history-correct'));
  await fireEvent.changeText(
    view.getByTestId('manual-history-title-input'),
    'Synthetic unsaved edit',
  );
  await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
  await fireEvent.press(view.getByTestId('manual-history-form-close'));
  expect(await repository.list()).toMatchObject([
    {
      title: 'Synthetic original',
      effectiveDate: { status: 'known', date: '2024-05-10' },
    },
  ]);
  expect(view.getByTestId('manual-history-date-detail')).toHaveTextContent(
    '기준일: 2024-05-10',
  );
  expect(
    view.getByTestId('manual-history-details-' + entry.id).props
      .accessibilityState.expanded,
  ).toBe(true);
});
