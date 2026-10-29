import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { NavigationContext } from '@react-navigation/native';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
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

  await fireEvent.press(screen.getByTestId('health-record-filter-medications'));
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

test('import return refreshes stored results without remounting the library or changing its filter', async () => {
  let onFocus = () => {};
  // Model the native retained scene's focus event; the import continues to own its writes.
  const focusNavigation = {
    addListener: (_event: string, listener: () => void) => {
      onFocus = listener;
      return () => {};
    },
  };
  let imported = false;
  const record = healthObservation(
    'new-import',
    'heart_rate',
    new Date().toISOString(),
  );
  const loadObservations = jest.fn(async () => ({
    records: imported ? [record] : [],
    nextCursor: null,
  }));
  await render(
    <NavigationContext.Provider value={focusNavigation as never}>
      <HealthRecordsRoute
        actions={actions('health-records')}
        route="health-records"
        selection={null}
        loadObservations={loadObservations}
        loadMedicationData={async () => ({ definitions: [], doseEvents: [] })}
        onSelectionChange={jest.fn()}
      />
    </NavigationContext.Provider>,
  );
  await fireEvent.press(screen.getByTestId('health-record-filter-heart_rate'));
  const page = screen.getByTestId('health-records-scroll');
  await fireEvent.press(
    screen.getByTestId('health-records-open-health-import'),
  );
  imported = true;
  await act(async () => onFocus());
  expect(screen.getByTestId('health-records-scroll')).toBe(page);
  expect(
    screen.getByTestId('health-record-filter-heart_rate').props
      .accessibilityState.selected,
  ).toBe(true);
  expect(
    await screen.findByTestId('health-record-chart-heart_rate'),
  ).toBeTruthy();
  expect(loadObservations).toHaveBeenCalledTimes(12);
  await act(async () => onFocus());
  expect(loadObservations).toHaveBeenCalledTimes(12);
});
