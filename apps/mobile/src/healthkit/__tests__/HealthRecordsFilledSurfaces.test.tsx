import { fireEvent, render, screen } from '@testing-library/react-native';
import { HealthRecordsCategoryCard } from '../HealthRecordsCategoryCard';
import { HealthRecordsDetailRecordRow } from '../HealthRecordsDetailRecordRow';
import { HealthRecordsMedicationCategoryCard } from '../HealthRecordsMedicationCategoryCard';
import { HealthRecordsMedicationRecordRow } from '../HealthRecordsMedicationRecordRow';
import { appColors } from '../../layout/appColors';
import {
  healthObservation,
  importedDoseEvent,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';

it('keeps filled category groups and their detail actions without decorative outlines', async () => {
  const open = jest.fn();
  await render(
    <>
      <HealthRecordsCategoryCard
        category="other"
        loadState="ready"
        observations={[]}
        onOpenDetail={open}
      />
      <HealthRecordsMedicationCategoryCard
        summary={{
          data: { definitions: [], doseEvents: [] },
          status: 'ready',
          reload: async () => {},
        }}
        onOpenDetail={open}
      />
    </>,
  );
  for (const category of ['other', 'medications']) {
    expect(
      screen.getByTestId('health-record-category-' + category),
    ).toHaveStyle({
      backgroundColor: appColors.surface,
      borderWidth: 0,
      borderRadius: 18,
      padding: 16,
    });
    await fireEvent.press(
      screen.getByTestId('health-record-open-detail-' + category),
    );
    expect(open).toHaveBeenLastCalledWith({ category, period: 'month' });
  }
});

it('keeps exact saved values, source labels and dose status inside filled detail rows', async () => {
  const observation = healthObservation(
    'synthetic',
    'step_count',
    '2026-11-16T09:00:00Z',
  );
  const doseEvent = importedDoseEvent(
    'synthetic-dose',
    '2026-11-16T09:00:00Z',
    'not_logged',
  );
  await render(
    <>
      <HealthRecordsDetailRecordRow
        index={0}
        row={{ kind: 'observation', observation }}
      />
      <HealthRecordsMedicationRecordRow
        index={0}
        row={{ medicationName: 'Synthetic medication', doseEvent }}
      />
    </>,
  );
  for (const id of ['health-record-row-0', 'health-record-medication-row-0']) {
    expect(screen.getByTestId(id)).toHaveStyle({
      backgroundColor: appColors.surface,
      borderWidth: 0,
      borderRadius: 14,
      padding: 14,
    });
  }
  expect(screen.getByTestId('health-record-row-0-value')).toHaveTextContent(
    '72 count',
  );
  expect(
    screen.getByTestId('health-record-medication-row-0-status'),
  ).toHaveTextContent('미기록');
  expect(
    screen.getByTestId('health-record-medication-row-0-dose'),
  ).toHaveTextContent('1 tablet');
  expect(screen.queryByText('com.example.synthetic')).toBeNull();
});

it('preserves medication refresh errors and retry behavior', async () => {
  const reload = jest.fn(async () => {});
  await render(
    <HealthRecordsMedicationCategoryCard
      summary={{
        data: { definitions: [], doseEvents: [] },
        status: 'failed',
        reload,
      }}
      onOpenDetail={() => {}}
    />,
  );
  expect(
    screen.getByTestId('health-record-medications-summary').props
      .accessibilityRole,
  ).toBe('alert');
  await fireEvent.press(screen.getByTestId('health-record-medications-retry'));
  expect(reload).toHaveBeenCalledTimes(1);
});
