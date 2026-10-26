import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SymptomEntrySchema } from '@orot/storage';
import SymptomForm from '../SymptomForm';

function descriptionAccessoryID(): string {
  const id = screen.getByTestId('symptom-description').props
    .inputAccessoryViewID;
  expect(typeof id).toBe('string');
  let accessory = screen.getByTestId(
    'symptom-keyboard-save-description',
  ).parent;
  while (accessory && accessory.props.nativeID === undefined) {
    accessory = accessory.parent;
  }
  expect(accessory?.props.nativeID).toBe(id);
  return id;
}

describe('symptom form accessory across create and edit', () => {
  it('changes the native binding across modes while preserving text and keyboard save behavior', async () => {
    const onCreate = jest.fn();
    const onUpdate = jest.fn();
    const create = await render(
      <SymptomForm
        mode="create"
        onCancel={jest.fn()}
        onCreate={onCreate}
        onUpdate={onUpdate}
      />,
    );
    const createID = descriptionAccessoryID();
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      'Synthetic hand tingling',
    );
    await fireEvent.changeText(
      screen.getByTestId('symptom-onset-date'),
      '2025-04-02',
    );
    await fireEvent.changeText(
      screen.getByTestId('symptom-onset-time'),
      '09:30',
    );
    await fireEvent.press(screen.getByTestId('symptom-status-active'));
    await fireEvent.press(
      screen.getByTestId('symptom-keyboard-save-description'),
    );
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      description: 'Synthetic hand tingling',
      status: 'active',
    });
    await create.unmount();
    const stamp = '2026-05-01T12:00:00Z';
    const entry = SymptomEntrySchema.parse({
      id: 'synthetic-symptom',
      effectiveAt: onCreate.mock.calls[0][0].onsetAt,
      recordedAt: stamp,
      ingestedAt: stamp,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      description: 'Synthetic hand tingling',
      status: 'active',
    });
    await render(
      <SymptomForm
        mode="edit"
        entry={entry}
        onCancel={jest.fn()}
        onCreate={onCreate}
        onUpdate={onUpdate}
      />,
    );
    // Component props prove ID wiring; the native acceptance run checks UIKit attachment.
    expect(descriptionAccessoryID()).not.toBe(createID);
    expect(screen.getByTestId('symptom-description')).toHaveProp(
      'value',
      entry.description,
    );
    await fireEvent.changeText(
      screen.getByTestId('symptom-description'),
      'Synthetic edited tingling\nAfter lunch',
    );
    await fireEvent.press(
      screen.getByTestId('symptom-keyboard-save-description'),
    );
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith(entry.id, {
        description: 'Synthetic edited tingling\nAfter lunch',
        bodySite: null,
        severity: null,
      }),
    );
  });
});
