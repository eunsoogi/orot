import { fireEvent, render, screen } from '@testing-library/react-native';
import type { NavigationRouteActions } from '../../navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { HealthRecordsRoute } from '../HealthRecordsRoute';

function actions(
  route: AppNavigationRoute,
): NavigationRouteActions<AppNavigationRoute> {
  return {
    route: { key: route, name: route },
    onBack: async () => true,
    onHome: async () => true,
    push: name => ({ key: name, name }),
    replace: name => ({ key: name, name }),
    registerLeaveState: () => () => {},
  };
}

test('routes the medication summary action to its separate dose-event detail list', async () => {
  const timestamp = new Date().toISOString();
  const medication = medicationDefinition('medication-1', timestamp);
  const dose = importedDoseEvent('dose-1', timestamp, 'taken');
  const onSelectionChange = jest.fn();
  const navigation = actions('health-records');
  const push = jest.spyOn(navigation, 'push');

  await render(
    <HealthRecordsRoute
      actions={navigation}
      loadMedicationData={async () => ({
        definitions: [medication],
        doseEvents: [dose],
      })}
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onSelectionChange={onSelectionChange}
      route="health-records"
      selection={null}
    />,
  );

  await screen.findByTestId('health-record-medications-count');
  await fireEvent.press(
    screen.getByTestId('health-record-open-detail-medications'),
  );
  expect(onSelectionChange).toHaveBeenCalledWith({
    category: 'medications',
    period: 'month',
  });
  expect(push).toHaveBeenCalledWith('health-records-detail');

  await render(
    <HealthRecordsRoute
      actions={actions('health-records-detail')}
      loadMedicationData={async () => ({
        definitions: [medication],
        doseEvents: [dose],
      })}
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onSelectionChange={onSelectionChange}
      route="health-records-detail"
      selection={{ category: 'medications', period: 'month' }}
    />,
  );
  expect(
    await screen.findByTestId('health-records-medication-selected'),
  ).toHaveTextContent(/Synthetic medication/u);
});

test('opens the existing unified import route from the health records library', async () => {
  const navigation = actions('health-records');
  const push = jest.spyOn(navigation, 'push');
  await render(
    <HealthRecordsRoute
      actions={navigation}
      loadMedicationData={async () => ({ definitions: [], doseEvents: [] })}
      loadObservations={async () => ({ records: [], nextCursor: null })}
      onSelectionChange={jest.fn()}
      route="health-records"
      selection={null}
    />,
  );

  await fireEvent.press(
    await screen.findByTestId('health-records-open-health-import'),
  );
  expect(push).toHaveBeenCalledWith('unified-import');
});
