import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import { HealthRecordsLibraryScreen } from '../HealthRecordsLibraryScreen';
import { HealthRecordsMedicationDetailScreen } from '../HealthRecordsMedicationDetailScreen';
import { HealthRecordsCategoryHeading } from '../HealthRecordsCategoryHeading';
import {
  healthObservation,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';

const base = {
  onBack: jest.fn(),
  onOpenHealthImport: jest.fn(),
  onOpenDetail: jest.fn(),
};

test('one library list owns import, horizontal filters and results; Other filters the dataset', async () => {
  await render(
    <HealthRecordsLibraryScreen
      {...base}
      loadObservations={async () => ({ records: [], nextCursor: null })}
    />,
  );
  const page = within(screen.getByTestId('health-records-scroll'));
  expect(page.getByTestId('health-records-title')).toBeTruthy();
  expect(page.getByTestId('health-records-open-health-import')).toBeTruthy();
  expect(page.getByTestId('health-record-category-filter')).toBeTruthy();
  expect(
    screen.container.queryAll(
      node => node.type === 'RCTScrollView' && !node.props.horizontal,
    ),
  ).toHaveLength(1);
  await fireEvent.press(screen.getByTestId('health-record-filter-other'));
  expect(page.getByTestId('health-record-category-other')).toBeTruthy();
  expect(
    page.queryByTestId('health-record-category-blood_pressure'),
  ).toBeNull();
  expect(
    page.getByTestId('health-record-category-empty-other'),
  ).toHaveTextContent(/기타/u);
});

test('medication summary is cached across filtering and refreshed without losing selection', async () => {
  const loadMedicationData = jest.fn(async () => ({
    definitions: [medicationDefinition('one', new Date().toISOString())],
    doseEvents: [],
  }));
  const props = {
    ...base,
    loadMedicationData,
    loadObservations: jest.fn(async () => ({ records: [], nextCursor: null })),
  };
  const view = await render(<HealthRecordsLibraryScreen {...props} />);
  await fireEvent.press(screen.getByTestId('health-record-filter-medications'));
  expect(
    await screen.findByTestId('health-record-medications-count'),
  ).toHaveTextContent(/1개 약/u);
  await fireEvent.press(screen.getByTestId('health-record-filter-other'));
  await fireEvent.press(screen.getByTestId('health-record-filter-medications'));
  expect(loadMedicationData).toHaveBeenCalledTimes(1);
  await view.rerender(
    <HealthRecordsLibraryScreen {...props} refreshRevision={1} />,
  );
  expect(loadMedicationData).toHaveBeenCalledTimes(2);
  expect(
    screen.getByTestId('health-record-filter-medications').props
      .accessibilityState.selected,
  ).toBe(true);
});

test('a failed import refresh retains the selected values and retries the first page', async () => {
  const record = healthObservation(
    'retained',
    'heart_rate',
    new Date().toISOString(),
  );
  const cursor = { id: record.id, effectiveAt: record.effectiveAt };
  let fail = false;
  const load = jest.fn(async (_after, filter) => {
    if (filter.category !== 'heart_rate')
      return { records: [], nextCursor: null };
    if (fail) throw new Error('read failed');
    return { records: [record], nextCursor: cursor };
  });
  const props = { ...base, loadObservations: load };
  const view = await render(<HealthRecordsLibraryScreen {...props} />);
  await fireEvent.press(screen.getByTestId('health-record-filter-heart_rate'));
  expect(screen.getByTestId('health-record-chart-heart_rate')).toBeTruthy();
  fail = true;
  await view.rerender(
    <HealthRecordsLibraryScreen {...props} refreshRevision={1} />,
  );
  expect(await screen.findByTestId('health-records-error')).toBeTruthy();
  expect(screen.getByTestId('health-record-chart-heart_rate')).toBeTruthy();
  expect(screen.queryByTestId('health-records-empty')).toBeNull();
  fail = false;
  await fireEvent.press(screen.getByTestId('health-records-retry'));
  expect(load).toHaveBeenLastCalledWith(
    null,
    expect.objectContaining({ category: 'heart_rate' }),
  );
  expect(
    screen.getByTestId('health-record-filter-heart_rate').props
      .accessibilityState.selected,
  ).toBe(true);
});

test('medication options and history share one virtualized SectionList', async () => {
  await render(
    <HealthRecordsMedicationDetailScreen
      onBack={jest.fn()}
      onSelectionChange={jest.fn()}
      selection={{ category: 'medications', period: 'month' }}
    />,
  );
  expect(
    screen.container.queryAll(
      node => node.type === 'RCTScrollView' && !node.props.horizontal,
    ),
  ).toHaveLength(1);
  const page = within(screen.getByTestId('health-records-detail-scroll'));
  expect(page.getByTestId('health-records-detail-title')).toBeTruthy();
  expect(page.getByTestId('health-record-period-year')).toBeTruthy();
  expect(page.getByTestId('health-records-detail-empty')).toBeTruthy();
});

test('the detail action reflows from its measured card width instead of window width', async () => {
  const original = Dimensions.get('window');
  Dimensions.set({ window: { ...original, fontScale: 1 } });
  const view = await render(
    <HealthRecordsCategoryHeading icon={null} action={null}>
      {null}
    </HealthRecordsCategoryHeading>,
  );
  const heading = screen.getByTestId('health-record-category-heading');
  await act(async () =>
    fireEvent(heading, 'layout', { nativeEvent: { layout: { width: 308 } } }),
  );
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-record-category-heading').props.style,
    ).flexDirection,
  ).toBeUndefined();
  await act(async () =>
    fireEvent(heading, 'layout', { nativeEvent: { layout: { width: 700 } } }),
  );
  expect(
    StyleSheet.flatten(
      screen.getByTestId('health-record-category-heading').props.style,
    ).flexDirection,
  ).toBe('row');
  await view.unmount();
  Dimensions.set({ window: original });
});

test('different stored units are shown on independent chart axes with saved values', async () => {
  const first = healthObservation(
    'kilograms',
    'body_mass',
    new Date().toISOString(),
  );
  const second = {
    ...first,
    id: 'pounds',
    value: { kind: 'quantity' as const, amount: 160, unit: 'lb' },
  };
  const kilogram = {
    ...first,
    value: { kind: 'quantity' as const, amount: 72, unit: 'kg' },
  };
  await render(
    <HealthRecordsLibraryScreen
      {...base}
      loadObservations={async () => ({
        records: [kilogram, second],
        nextCursor: null,
      })}
    />,
  );
  await fireEvent.press(screen.getByTestId('health-record-filter-body_mass'));
  const charts = screen.getAllByTestId('health-record-chart-body_mass');
  expect(charts).toHaveLength(2);
  expect(charts[0].props.accessibilityLabel).toContain('72 kg');
  expect(charts[0].props.accessibilityLabel).not.toContain('160 lb');
  expect(charts[1].props.accessibilityLabel).toContain('160 lb');
});
