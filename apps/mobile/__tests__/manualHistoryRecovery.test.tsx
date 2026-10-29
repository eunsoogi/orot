import { fireEvent, render, within } from '@testing-library/react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

test('exposes date, kind, and user provenance independently from the expansion button', async () => {
  const repository = createManualHistoryTestRepository();
  const entry = await repository.create({
    kind: 'procedure',
    title: 'Synthetic accessible record',
    details: 'Synthetic user-entered details.',
    effectiveDate: { status: 'known', date: '2024-05-10' },
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  const expand = await view.findByTestId('manual-history-details-' + entry.id);
  // Pressable groups descendants into its accessible name on iOS, so metadata must stay outside.
  expect(
    within(expand).queryByTestId('manual-history-date-' + entry.id),
  ).toBeNull();
  const card = within(view.getByTestId('manual-history-entry-' + entry.id));
  expect(card.getByText('기준일: 2024-05-10')).toBeTruthy();
  expect(card.getByText('시술 또는 수술')).toBeTruthy();
  expect(card.getByText('직접 입력 · 미확인')).toBeTruthy();
  expect(within(expand).queryByText('직접 입력 · 미확인')).toBeNull();
  expect(expand.props.accessibilityState.expanded).toBe(false);
});

test('keeps a successful correction selected if the following list refresh fails', async () => {
  const repository = createManualHistoryTestRepository();
  const original = await repository.create({
    kind: 'diagnosis_history',
    title: 'Synthetic original record',
    details: 'Synthetic original details.',
    effectiveDate: { status: 'unknown' },
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  await fireEvent.press(
    await view.findByTestId('manual-history-details-' + original.id),
  );
  await fireEvent.press(view.getByTestId('manual-history-correct'));
  await fireEvent.changeText(
    view.getByTestId('manual-history-title-input'),
    'Synthetic saved correction',
  );
  jest
    .spyOn(repository, 'list')
    .mockRejectedValueOnce(new Error('Synthetic list refresh failure'));
  await fireEvent.press(view.getByTestId('manual-history-save'));
  const saved = (await repository.list())[0];
  expect(saved.id).not.toBe(original.id);
  expect(view.getByTestId('manual-history-entry-' + saved.id)).toBeTruthy();
  expect(view.queryByTestId('manual-history-entry-' + original.id)).toBeNull();
  expect(view.getByTestId('manual-history-detail')).toBeTruthy();
  expect(
    view.getByTestId('manual-history-version-' + original.id),
  ).toBeTruthy();
  expect(view.getByTestId('manual-history-version-' + saved.id)).toBeTruthy();
  expect(view.getByTestId('manual-history-error')).toHaveTextContent(
    '건강 기록을 불러오지 못했어요. 다시 시도해 주세요.',
  );
  expect(
    view.getByText('수정 내용을 저장했어요. 이전 내용도 보존했어요.'),
  ).toBeTruthy();
  expect(view.queryByTestId('manual-history-form')).toBeNull();
});
