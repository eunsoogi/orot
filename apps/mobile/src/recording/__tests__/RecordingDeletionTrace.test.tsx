import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRecordingDeletionProbe } from '../../../e2e/transcription/useRecordingDeletionProbe';
import RecordingDeletionConfirmation from '../RecordingDeletionConfirmation';
import { RecordingDeletionTimingContext } from '../recordingDeletionTiming';
import { RecordingDeletionTimingProbe } from '../recordingDeletionTimingProbe';
import {
  RecordingDeletionTrace,
  type RecordingDeletionTraceEntry,
} from '../recordingDeletionTrace';

test('fixture logs the revision that React actually commits independently of publication requests', async () => {
  const log = jest.spyOn(console, 'info').mockImplementation(() => {});
  let current: ReturnType<typeof useRecordingDeletionProbe> | undefined;
  function Fixture() {
    current = useRecordingDeletionProbe(true);
    return null;
  }
  try {
    await render(<Fixture />);
    await act(() => {
      current?.probe?.mark('confirmation-tap');
      current?.probe?.mark('list-refresh');
      current?.probe?.mark('progress-presented');
    });
    const entries = log.mock.calls.map(
      ([line]) =>
        JSON.parse(
          String(line).slice('OROT_RECORDING_DELETION_TRACE '.length),
        ) as RecordingDeletionTraceEntry,
    );
    expect(
      entries.filter(entry => entry.event === 'fixture-publication-request'),
    ).toHaveLength(2);
    const commits = entries.filter(
      entry => entry.event === 'fixture-publication-commit',
    );
    expect(commits.at(-1)?.details.committedRevision).toBe(2);
    expect(current?.report?.complete).toBe(false);
    expect(new Set(entries.map(entry => entry.sampleId)).size).toBe(1);
  } finally {
    log.mockRestore();
  }
});

test('distinguishes a UI latch consumed before start from probe deduplication', async () => {
  const entries: RecordingDeletionTraceEntry[] = [];
  let now = 0;
  const trace = new RecordingDeletionTrace(
    'sample',
    entry => entries.push(entry),
    () => ++now,
  );
  const probe = new RecordingDeletionTimingProbe(() => now, undefined, trace);
  const view = (busy: boolean) => (
    <RecordingDeletionTimingContext.Provider value={probe}>
      <RecordingDeletionConfirmation
        target={null}
        busy={busy}
        onCancel={() => {}}
        onConfirm={() => {}}
        onProgressPresented={() => probe.mark('progress-presented')}
      />
    </RecordingDeletionTimingContext.Provider>
  );
  await render(view(true));
  const layout = {
    nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 30 } },
  };
  await fireEvent(
    screen.getByTestId('recording-delete-progress'),
    'layout',
    layout,
  );
  probe.mark('confirmation-tap');
  await fireEvent(
    screen.getByTestId('recording-delete-progress'),
    'layout',
    layout,
  );
  expect(
    entries
      .filter(entry => entry.event === 'layout-entry')
      .map(entry => entry.details.latched),
  ).toEqual([false, true]);
  expect(entries.some(entry => entry.event === 'mark-not-started')).toBe(true);
  expect(entries.some(entry => entry.event === 'mark-duplicate')).toBe(false);
  expect(probe.snapshot().durationsMs.confirmationToProgress).toBeNull();
  // A real committed idle boundary resets the UI latch without manufacturing a timing mark.
  await screen.rerender(view(false));
  await screen.rerender(view(true));
  await fireEvent(
    screen.getByTestId('recording-delete-progress'),
    'layout',
    layout,
  );
  expect(probe.snapshot().durationsMs.confirmationToProgress).not.toBeNull();
  expect(
    entries
      .filter(entry => entry.event === 'busy-commit')
      .map(entry => entry.details.busy),
  ).toEqual([true, false, true]);
  await screen.unmount();
  expect(entries.at(-1)?.event).toBe('component-unmount');
  expect(entries.map(entry => entry.sequence)).toEqual(
    entries.map((_, index) => index + 1),
  );
});

test('traces late acceptance and republication without declaring ordered completion', () => {
  const entries: RecordingDeletionTraceEntry[] = [];
  const trace = new RecordingDeletionTrace(
    'late',
    entry => entries.push(entry),
    () => 10,
  );
  const reports = jest.fn();
  const probe = new RecordingDeletionTimingProbe(() => 10, reports, trace);
  probe.mark('progress-presented');
  probe.mark('confirmation-tap');
  probe.mark('list-refresh');
  probe.mark('progress-presented');
  probe.mark('progress-presented');
  expect(reports).toHaveBeenCalledTimes(2);
  expect(probe.snapshot().complete).toBe(false);
  expect(
    entries
      .filter(entry => entry.event === 'report-call')
      .map(entry => entry.reportRevision),
  ).toEqual([1, 2]);
  expect(
    entries.filter(
      entry =>
        entry.event === 'mark-accepted' &&
        entry.details.stage === 'progress-presented',
    ),
  ).toHaveLength(1);
  expect(entries.some(entry => entry.event === 'mark-duplicate')).toBe(true);
});

test('trace sink and report delivery exceptions cannot escape deletion observation', () => {
  const entries: RecordingDeletionTraceEntry[] = [];
  const trace = new RecordingDeletionTrace('failure', entry =>
    entries.push(entry),
  );
  const probe = new RecordingDeletionTimingProbe(
    () => 1,
    () => {
      throw new Error('delivery');
    },
    trace,
  );
  probe.mark('confirmation-tap');
  expect(() => probe.mark('list-refresh')).not.toThrow();
  expect(entries.at(-1)?.event).toBe('report-exception');
  const broken = new RecordingDeletionTrace('broken', () => {
    throw new Error('sink');
  });
  expect(() => broken.record('busy-commit', { busy: true })).not.toThrow();
});
