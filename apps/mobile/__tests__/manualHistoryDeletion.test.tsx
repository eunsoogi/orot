import { fireEvent, render, waitFor } from '@testing-library/react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

test('requires explicit confirmation before deleting the full correction lineage', async () => {
  const repository = createManualHistoryTestRepository();
  const original = await repository.create({
    kind: 'note',
    title: 'Synthetic history to delete',
    details: 'Synthetic original details.',
    effectiveDate: { status: 'unknown' },
  });
  const corrected = await repository.correct(original.id, {
    kind: 'note',
    title: 'Synthetic corrected history to delete',
    details: 'Synthetic corrected details.',
    effectiveDate: { status: 'unknown' },
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );
  await view.findByTestId('manual-history-entry-' + corrected.id);
  await fireEvent.press(
    view.getByTestId('manual-history-details-' + corrected.id),
  );
  await view.findByTestId('manual-history-detail');
  await fireEvent.press(view.getByTestId('manual-history-delete'));
  expect(view.getByTestId('manual-history-delete-confirmation')).toBeTruthy();
  expect(view.getByTestId('manual-history-entry-' + corrected.id)).toBeTruthy();
  await fireEvent.press(view.getByTestId('manual-history-confirm-delete'));

  await waitFor(() =>
    expect(
      view.queryByTestId('manual-history-entry-' + corrected.id),
    ).toBeNull(),
  );
  expect(view.getByText('기록과 수정 이력을 삭제했어요.')).toBeTruthy();
  expect(view.queryByTestId('manual-history-entry-' + original.id)).toBeNull();
});
