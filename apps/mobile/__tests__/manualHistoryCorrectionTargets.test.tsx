import { fireEvent, render } from '@testing-library/react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

test('switching correction targets loads the selected entry values', async () => {
  const repository = createManualHistoryTestRepository();
  const first = await repository.create({
    kind: 'note',
    title: 'Synthetic history A',
    details: 'Synthetic details A.',
    effectiveDate: { status: 'unknown' },
  });
  const second = await repository.create({
    kind: 'procedure',
    title: 'Synthetic history B',
    details: 'Synthetic details B.',
    effectiveDate: { status: 'unknown' },
  });
  const view = await render(
    <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
  );

  await view.findByTestId('manual-history-entry-' + first.id);
  await fireEvent.press(view.getByTestId('manual-history-details-' + first.id));
  await view.findByTestId('manual-history-detail');
  await fireEvent.press(view.getByTestId('manual-history-correct'));
  await fireEvent.changeText(
    view.getByTestId('manual-history-title-input'),
    'Unsaved correction for A',
  );
  await fireEvent.changeText(
    view.getByTestId('manual-history-details-input'),
    'Unsaved details for A.',
  );

  await fireEvent.press(
    view.getByTestId('manual-history-details-' + second.id),
  );
  await fireEvent.press(view.getByTestId('manual-history-correct'));

  expect(view.getByTestId('manual-history-title-input').props.value).toBe(
    'Synthetic history B',
  );
  expect(view.getByTestId('manual-history-details-input').props.value).toBe(
    'Synthetic details B.',
  );
  await fireEvent.press(view.getByTestId('manual-history-save'));

  const secondHistory = await repository.history(second.id);
  expect(secondHistory.at(-1)).toMatchObject({
    title: 'Synthetic history B',
    details: 'Synthetic details B.',
    kind: 'procedure',
  });
});
