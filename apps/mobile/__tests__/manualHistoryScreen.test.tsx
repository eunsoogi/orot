import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import type {
  ManualHistoryScreenDraft,
  ManualHistoryScreenRecord,
  ManualHistoryScreenRepository,
} from '../src/manualHistory/types';

function createRepository(): ManualHistoryScreenRepository {
  let nextId = 1;
  const entries: ManualHistoryScreenRecord[] = [];

  function activeEntries() {
    return entries.filter(entry => !entries.some(candidate => candidate.supersedesId === entry.id));
  }

  function createRecord(input: ManualHistoryScreenDraft, supersedesId?: string) {
    const sequence = nextId++;
    const entry: ManualHistoryScreenRecord = {
      id: 'synthetic-entry-' + sequence,
      ...input,
      recordedAt: sequence === 1 ? '2026-09-15T10:20:00Z' : '2026-09-16T11:20:00Z',
      provenance: { origin: 'user_reported' },
      reviewState: { status: 'unreviewed' },
      ...(supersedesId ? { supersedesId } : {}),
    };
    entries.push(entry);
    return entry;
  }

  function lineage(id: string): ManualHistoryScreenRecord[] {
    let current = entries.find(entry => entry.id === id);
    if (!current) return [];
    while (current?.supersedesId) {
      current = entries.find(entry => entry.id === current?.supersedesId);
    }
    const result: ManualHistoryScreenRecord[] = [];
    while (current) {
      result.push(current);
      current = entries.find(entry => entry.supersedesId === current?.id);
    }
    return result;
  }

  return {
    async list() {
      return activeEntries();
    },
    async create(input) {
      return createRecord(input);
    },
    async correct(id, input) {
      return createRecord(input, id);
    },
    async history(id) {
      return lineage(id);
    },
  };
}

describe('ManualHistoryScreen', () => {
  it.each([
    ['diagnosis_history', 'Diagnosis or history'],
    ['procedure', 'Procedure'],
    ['medication_context', 'Medication context'],
    ['note', 'Free-form note'],
  ] as const)('offers the %s manual entry type', async (kind, label) => {
    const view = await render(
      <ManualHistoryScreen onBack={jest.fn()} repository={createRepository()} />,
    );
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.press(view.getByTestId('manual-history-kind-' + kind));

    expect(view.getByText('Selected: ' + label)).toBeTruthy();
  });

  it('accepts and displays an explicitly known effective date', async () => {
    const view = await render(
      <ManualHistoryScreen onBack={jest.fn()} repository={createRepository()} />,
    );
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(view.getByTestId('manual-history-title-input'), 'Synthetic dated history');
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic details for the known-date component test.',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));
    expect(await view.findByText('Enter a valid effective date or mark the date unknown.'))
      .toBeTruthy();

    await fireEvent.changeText(
      view.getByTestId('manual-history-effective-date-input'),
      '2024-02-09',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(await view.findByText('Synthetic dated history')).toBeTruthy();
    expect(view.getByText('Effective date: 2024-02-09')).toBeTruthy();
    expect(view.getByText('User entered · Unreviewed')).toBeTruthy();
  });

  it('requires explicit date knowledge and presents corrected history', async () => {
    const repository = createRepository();
    const view = await render(<ManualHistoryScreen onBack={jest.fn()} repository={repository} />);
    await view.findByTestId('manual-history-empty');

    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(view.getByTestId('manual-history-title-input'), 'Synthetic test history');
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic details for component coverage.',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));
    expect(await view.findByText('Enter a valid effective date or mark the date unknown.'))
      .toBeTruthy();

    await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
    await fireEvent.press(view.getByTestId('manual-history-save'));
    expect(await view.findByTestId('manual-history-entry-synthetic-entry-1')).toBeTruthy();
    expect(view.getByText('Effective date unknown')).toBeTruthy();
    expect(view.getByText('User entered · Unreviewed')).toBeTruthy();

    await fireEvent.press(view.getByTestId('manual-history-details-synthetic-entry-1'));
    await waitFor(() => expect(view.getByTestId('manual-history-detail')).toBeTruthy());
    await fireEvent.press(view.getByTestId('manual-history-correct'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Corrected synthetic test history',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Corrected synthetic details for component coverage.',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-correction-note-input'),
      'Corrected wording only.',
    );
    await fireEvent.press(view.getByTestId('manual-history-kind-procedure'));
    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(await view.findByTestId('manual-history-correction-history')).toBeTruthy();
    expect(view.getByText('Earlier version')).toBeTruthy();
    expect(view.getByText('Current version')).toBeTruthy();
    expect(view.getByTestId('manual-history-version-synthetic-entry-1')).toBeTruthy();
    expect(view.getByTestId('manual-history-version-synthetic-entry-2')).toBeTruthy();
    expect(view.getByTestId('manual-history-entry-synthetic-entry-2')).toBeTruthy();
    expect(view.queryByTestId('manual-history-entry-synthetic-entry-1')).toBeNull();
    expect(
      within(view.getByTestId('manual-history-version-synthetic-entry-1')).getByText(
        'Diagnosis or history',
      ),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('manual-history-version-synthetic-entry-1')).getByText(
        'User entered · Unreviewed',
      ),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('manual-history-version-synthetic-entry-1')).getByText(
        'Recorded: ' + new Date('2026-09-15T10:20:00Z').toLocaleString(),
      ),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('manual-history-version-synthetic-entry-2')).getByText('Procedure'),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('manual-history-version-synthetic-entry-2')).getByText(
        'User entered · Unreviewed',
      ),
    ).toBeTruthy();
    expect(
      within(view.getByTestId('manual-history-version-synthetic-entry-2')).getByText(
        'Recorded: ' + new Date('2026-09-16T11:20:00Z').toLocaleString(),
      ),
    ).toBeTruthy();
    expect(view.getByText('Correction note: Corrected wording only.')).toBeTruthy();
  });

  it('keeps a saved correction visible if refreshing its history fails', async () => {
    const repository = createRepository();
    const original = await repository.create({
      kind: 'note',
      title: 'Synthetic history before correction',
      details: 'Synthetic original details.',
      effectiveDate: { status: 'unknown' },
    });
    const view = await render(<ManualHistoryScreen onBack={jest.fn()} repository={repository} />);
    await view.findByTestId('manual-history-entry-' + original.id);
    await fireEvent.press(view.getByTestId('manual-history-details-' + original.id));
    await view.findByTestId('manual-history-detail');
    await fireEvent.press(view.getByTestId('manual-history-correct'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic corrected history',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic corrected details.',
    );
    jest.spyOn(repository, 'history').mockRejectedValueOnce(new Error('Synthetic read failure.'));

    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(await view.findByText('Correction saved. Earlier versions are preserved.')).toBeTruthy();
    expect(
      await view.findByText(
        'Correction saved, but correction history could not be loaded. Reopen the entry to retry.',
      ),
    ).toBeTruthy();
    expect(view.getByTestId('manual-history-entry-synthetic-entry-2')).toBeTruthy();
    expect(view.queryByText('Medical history could not be saved. Try again.')).toBeNull();
  });
});
