import { fireEvent, screen } from '@testing-library/react-native';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { createHealthEvidenceTestDatabase } from '../../healthEvidence/localEvidenceTestSupport';
import { loadOverviewMetricSelection } from '../overview/metricSelection';

const initial = ['sleep', 'heartRate'];
const added = ['workouts', 'steps', 'bodyMass'];
const choice = (metric: string) =>
  screen.getByTestId('overview-metric-selection-' + metric);
const save = () => screen.getByTestId('overview-metric-selection-save');
const cancel = () => screen.getByTestId('overview-metric-selection-cancel');
const selectedMetricOrder = () =>
  screen
    .getAllByTestId(
      /^overview-metric-reorder-(sleep|heartRate|workouts|steps|bodyMass)$/,
    )
    .map(node => node.props.testID.replace('overview-metric-reorder-', ''));
const pointer = (pageY: number, touching = true) => ({
  nativeEvent: { pageY, identifier: 1, touches: touching ? [{ pageY }] : [] },
});

/** Exercises the real route/checkpoint while keeping pointer and layout receipts synthetic. */
export async function verifyMeasuredMetricDrop(
  mountOverview: (
    repository: ReturnType<typeof createRecordRepository>,
  ) => Promise<{
    mounted: { unmount: () => Promise<unknown> };
    openEditor: () => Promise<void>;
  }>,
) {
  const f = createHealthEvidenceTestDatabase();
  await runMigrations(f.database);
  const records = createRecordRepository(f.database);
  const { mounted, openEditor } = await mountOverview(records);
  try {
    await openEditor();
    await fireEvent.press(choice('steps'));
    const measureRows = async (
      rows: readonly (readonly [string, number, number])[],
      width: number,
    ) => {
      for (const [metric, y, height] of rows) {
        await fireEvent(
          screen.getByTestId('overview-metric-choice-' + metric),
          'layout',
          { nativeEvent: { layout: { x: 0, y, height, width } } },
        );
      }
    };
    await measureRows(
      [
        ['sleep', 0, 80],
        ['heartRate', 80, 110],
        ['steps', 190, 70],
      ],
      280,
    );
    const handle = screen.getByTestId('overview-metric-reorder-sleep');
    const scroll = () => screen.getByTestId('navigation-route-scroll');
    expect(scroll().props.scrollEnabled).toBe(true);
    await fireEvent(handle, 'responderGrant', pointer(90));
    expect(scroll().props.scrollEnabled).toBe(false);
    await fireEvent(handle, 'responderMove', pointer(285));
    expect(screen.getByTestId('overview-metric-reorder-target')).toBeTruthy();
    await fireEvent(handle, 'responderTerminate', pointer(285, false));
    expect(scroll().props.scrollEnabled).toBe(true);
    await fireEvent(handle, 'responderRelease', pointer(285, false));
    expect(selectedMetricOrder()).toEqual(['sleep', 'heartRate', 'steps']);

    await fireEvent(handle, 'responderGrant', pointer(90));
    await fireEvent(handle, 'responderMove', pointer(285));
    await fireEvent(handle, 'responderRelease', pointer(285, false));
    expect(scroll().props.scrollEnabled).toBe(true);
    expect(selectedMetricOrder()).toEqual(['heartRate', 'steps', 'sleep']);
    await fireEvent.press(cancel());
    await screen.findByTestId('overview-metric-grid');
    expect(await loadOverviewMetricSelection(records)).toEqual(initial);

    await openEditor();
    await measureRows(
      [
        ['sleep', 0, 68],
        ['heartRate', 68, 68],
      ],
      460,
    );
    const first = screen.getByTestId('overview-metric-reorder-sleep');
    await fireEvent(first, 'responderGrant', pointer(120));
    expect(scroll().props.scrollEnabled).toBe(false);
    await measureRows(
      [
        ['sleep', 0, 82],
        ['heartRate', 82, 68],
      ],
      280,
    );
    expect(scroll().props.scrollEnabled).toBe(true);
    await fireEvent(first, 'responderRelease', pointer(230, false));
    expect(selectedMetricOrder()).toEqual(initial);

    await fireEvent(first, 'responderGrant', pointer(120));
    await fireEvent(first, 'responderMove', pointer(220));
    await fireEvent(first, 'responderRelease', pointer(220, false));
    expect(selectedMetricOrder()).toEqual(['heartRate', 'sleep']);
    for (const metric of added) await fireEvent.press(choice(metric));
    await fireEvent.press(choice('workouts'));
    await fireEvent.press(choice('workouts'));
    const order = ['heartRate', 'sleep', 'steps', 'bodyMass', 'workouts'];
    expect(selectedMetricOrder()).toEqual(order);
    await fireEvent.press(save());
    await screen.findByTestId('overview-metric-workouts');
    const cardOrder = () =>
      screen
        .getAllByTestId(
          /^overview-metric-(sleep|heartRate|workouts|steps|bodyMass)$/,
        )
        .map(node => node.props.testID.replace('overview-metric-', ''));
    expect(cardOrder()).toEqual(order);
    expect(await loadOverviewMetricSelection(records)).toEqual(order);
    await mounted.unmount();
    const restarted = await mountOverview(createRecordRepository(f.database));
    try {
      await screen.findByTestId('overview-metric-workouts');
      expect(cardOrder()).toEqual(order);
      await restarted.openEditor();
      expect(selectedMetricOrder()).toEqual(order);
    } finally {
      await restarted.mounted.unmount();
    }
  } finally {
    await mounted.unmount();
    f.close();
  }
}
