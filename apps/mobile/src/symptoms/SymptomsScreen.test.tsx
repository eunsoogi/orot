import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SymptomEntrySchema } from '@orot/storage';
import type { ComponentProps } from 'react';
import SymptomsScreen from './SymptomsScreen';
import { toSymptomTimestamp } from './dateTime';

const recordedAt = '2026-05-01T12:00:00Z';

function sampleSymptom() {
  return SymptomEntrySchema.parse({
    id: 'synthetic-symptom-1',
    effectiveAt: '2026-04-20T08:30:00Z',
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'Synthetic hand tingling',
    bodySite: 'left hand',
    severity: 5,
    status: 'active',
  });
}

function renderScreen(overrides: Partial<ComponentProps<typeof SymptomsScreen>> = {}) {
  return render(
    <SymptomsScreen
      entries={[]}
      onBack={jest.fn()}
      onRetry={jest.fn()}
      onFilterChange={jest.fn()}
      onCreate={jest.fn()}
      onUpdate={jest.fn()}
      onResolve={jest.fn()}
      {...overrides}
    />,
  );
}

describe('SymptomsScreen', () => {
  it('requires an explicit status and submits a user-entered onset and selected severity', async () => {
    const onCreate = jest.fn();
    await renderScreen({ onCreate });
    await fireEvent.press(screen.getByTestId('symptom-add'));

    expect(screen.getByTestId('symptom-save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('symptom-description'), '  Synthetic brief tingling  ');
    await fireEvent.changeText(screen.getByTestId('symptom-onset-date'), '2026-04-20');
    await fireEvent.changeText(screen.getByTestId('symptom-onset-time'), '08:30');
    await fireEvent.changeText(screen.getByTestId('symptom-severity'), '6');
    await fireEvent.press(screen.getByTestId('symptom-status-active'));
    await fireEvent.press(screen.getByTestId('symptom-save'));

    await waitFor(() => expect(onCreate).toHaveBeenCalledWith({
      onsetAt: toSymptomTimestamp('2026-04-20', '08:30'),
      description: 'Synthetic brief tingling',
      severity: 6,
      status: 'active',
    }));
  });

  it('keeps user provenance visible and calls edit and resolution actions', async () => {
    const entry = sampleSymptom();
    const onUpdate = jest.fn();
    const onResolve = jest.fn();
    await renderScreen({ entries: [entry], onUpdate, onResolve });

    expect(screen.getByText('User-entered · not clinician-confirmed')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('symptom-edit-' + entry.id));
    await fireEvent.changeText(screen.getByTestId('symptom-description'), 'Synthetic tingling after exercise');
    await fireEvent.press(screen.getByTestId('symptom-save'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith(entry.id, {
      description: 'Synthetic tingling after exercise',
      bodySite: 'left hand',
      severity: 5,
    }));

    await fireEvent.press(screen.getByTestId('symptom-resolve-' + entry.id));
    await waitFor(() => expect(onResolve).toHaveBeenCalledWith(entry.id));
  });

  it('filters by status and an inclusive local onset range', async () => {
    const onFilterChange = jest.fn();
    await renderScreen({ onFilterChange });
    await fireEvent.press(screen.getByTestId('symptom-filter-active'));
    await fireEvent.changeText(screen.getByTestId('symptom-filter-from-date'), '2026-04-20');
    await fireEvent.changeText(screen.getByTestId('symptom-filter-from-time'), '08:30');
    await fireEvent.changeText(screen.getByTestId('symptom-filter-through-date'), '2026-04-21');
    await fireEvent.changeText(screen.getByTestId('symptom-filter-through-time'), '08:30');
    await fireEvent.press(screen.getByTestId('symptom-filter-apply'));

    await waitFor(() => expect(onFilterChange).toHaveBeenLastCalledWith({
      status: 'active',
      fromOnsetAt: toSymptomTimestamp('2026-04-20', '08:30'),
      throughOnsetAt: toSymptomTimestamp('2026-04-21', '08:30'),
    }));
  });

  it('rejects an invalid onset date without creating an entry', async () => {
    const onCreate = jest.fn();
    await renderScreen({ onCreate });
    await fireEvent.press(screen.getByTestId('symptom-add'));
    await fireEvent.changeText(screen.getByTestId('symptom-description'), 'Synthetic test entry');
    await fireEvent.changeText(screen.getByTestId('symptom-onset-date'), '2026-02-30');
    await fireEvent.changeText(screen.getByTestId('symptom-onset-time'), '09:00');
    await fireEvent.press(screen.getByTestId('symptom-status-active'));
    await fireEvent.press(screen.getByTestId('symptom-save'));

    expect(await screen.findByText('Enter a valid local onset date and time.')).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
  });
});
