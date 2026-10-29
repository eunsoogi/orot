import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { SymptomEntrySchema } from '@orot/storage';
import SymptomForm from './SymptomForm';
import { toLocalSymptomDateTime } from './dateTime';

async function open(onCreate = jest.fn()) {
  await render(
    <SymptomForm
      mode="create"
      onCreate={onCreate}
      onUpdate={jest.fn()}
      onCancel={jest.fn()}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-description'),
    '합성 증상',
  );
  await fireEvent.press(screen.getByTestId('symptom-status-active'));
  return onCreate;
}

test.each([
  ['', undefined],
  ['0', 0],
  ['10', 10],
] as const)(
  'saves severity %s without inventing optional data',
  async (text, severity) => {
    const before = Date.now();
    const onCreate = await open();
    if (text)
      await fireEvent.changeText(screen.getByTestId('symptom-severity'), text);
    await fireEvent.press(screen.getByTestId('symptom-save'));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const saved = onCreate.mock.calls[0][0];
    expect(saved.description).toBe('합성 증상');
    expect(new Date(saved.onsetAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(saved.onsetAt).getTime()).toBeLessThanOrEqual(Date.now());
    expect(saved).not.toHaveProperty('bodySite');
    if (severity === undefined) expect(saved).not.toHaveProperty('severity');
    else expect(saved.severity).toBe(severity);
  },
);

test('clearing an explicit zero returns severity to missing', async () => {
  const onCreate = await open();
  await fireEvent.changeText(screen.getByTestId('symptom-severity'), '0');
  await fireEvent.press(screen.getByTestId('symptom-severity-clear'));
  expect(screen.getByTestId('symptom-severity-selection')).toHaveTextContent(
    '입력 안 함',
  );
  await fireEvent.press(screen.getByTestId('symptom-save'));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  expect(onCreate.mock.calls[0][0]).not.toHaveProperty('severity');
});

test('a selected past native instant and all draft data survive a failed save and retry', async () => {
  const onCreate = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic storage failure'))
    .mockResolvedValueOnce(undefined);
  await open(onCreate);
  const past = new Date('2025-11-02T06:30:00.000Z');
  await fireEvent.press(screen.getByTestId('symptom-onset-choose-date'));
  await fireEvent(screen.getByTestId('symptom-onset-picker'), 'change', {
    nativeEvent: { timestamp: past.getTime(), utcOffset: 0 },
  });
  await fireEvent.press(screen.getByTestId('symptom-onset-picker-done'));
  await fireEvent.changeText(
    screen.getByTestId('symptom-body-site'),
    '왼쪽 손',
  );
  await fireEvent.changeText(screen.getByTestId('symptom-severity'), '0');
  await fireEvent.press(screen.getByTestId('symptom-save'));
  expect(await screen.findByTestId('symptom-form-error')).toHaveTextContent(
    /저장하지 못했어요/,
  );
  expect(screen.getByTestId('symptom-description')).toHaveProp(
    'value',
    '합성 증상',
  );
  expect(screen.getByTestId('symptom-body-site')).toHaveProp(
    'value',
    '왼쪽 손',
  );
  expect(screen.getByTestId('symptom-severity')).toHaveProp('value', '0');
  await fireEvent.press(screen.getByTestId('symptom-save'));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(2));
  expect(onCreate.mock.calls[0][0]).toEqual(onCreate.mock.calls[1][0]);
  expect(onCreate.mock.calls[1][0]).toMatchObject({
    onsetAt: past.toISOString(),
    bodySite: '왼쪽 손',
    severity: 0,
  });
});

test('canceling a native picker preserves the prior local onset', async () => {
  const onCreate = await open();
  const initial = toLocalSymptomDateTime(new Date().toISOString());
  await fireEvent.press(screen.getByTestId('symptom-onset-choose-date'));
  await fireEvent(screen.getByTestId('symptom-onset-picker'), 'change', {
    nativeEvent: { timestamp: 1735689600000, utcOffset: 0 },
  });
  await fireEvent.press(screen.getByTestId('symptom-onset-picker-cancel'));
  expect(
    screen.getByTestId('symptom-onset-choose-date').props.accessibilityLabel,
  ).toContain(initial.date);
  expect(
    screen.getByTestId('symptom-onset-choose-time').props.accessibilityLabel,
  ).toContain(initial.time);
  await fireEvent.press(screen.getByTestId('symptom-save'));
  await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
  expect(toLocalSymptomDateTime(onCreate.mock.calls[0][0].onsetAt).date).toBe(
    toLocalSymptomDateTime(new Date().toISOString()).date,
  );
});

test('failed correction keeps the populated form and retries only editable details', async () => {
  const stamp = '2026-05-01T12:00:00Z';
  const entry = SymptomEntrySchema.parse({
    id: 'synthetic-correction',
    effectiveAt: stamp,
    recordedAt: stamp,
    ingestedAt: stamp,
    description: '처음 증상',
    bodySite: '머리',
    severity: 0,
    status: 'resolved',
    resolvedAt: '2026-05-01T13:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
  const onUpdate = jest
    .fn()
    .mockRejectedValueOnce(new Error('synthetic correction failure'))
    .mockResolvedValueOnce(undefined);
  const onCancel = jest.fn();
  await render(
    <SymptomForm
      mode="edit"
      entry={entry}
      onCreate={jest.fn()}
      onUpdate={onUpdate}
      onCancel={onCancel}
    />,
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-description'),
    '수정한 증상',
  );
  await fireEvent.changeText(screen.getByTestId('symptom-body-site'), '');
  await fireEvent.press(screen.getByTestId('symptom-severity-clear'));
  await fireEvent.press(screen.getByTestId('symptom-save'));
  expect(await screen.findByTestId('symptom-form-error')).toHaveTextContent(
    /수정하지 못했어요/,
  );
  expect(onCancel).not.toHaveBeenCalled();
  expect(screen.getByTestId('symptom-description')).toHaveProp(
    'value',
    '수정한 증상',
  );
  expect(screen.getByTestId('symptom-edit-context')).toHaveTextContent(
    /나아진 시각/,
  );
  await fireEvent.press(screen.getByTestId('symptom-save'));
  await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  expect(onUpdate.mock.calls).toEqual([
    [entry.id, { description: '수정한 증상', bodySite: null, severity: null }],
    [entry.id, { description: '수정한 증상', bodySite: null, severity: null }],
  ]);
});
