import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import App from '../App';
import { navigationText } from '../src/i18n/navigation';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));
jest.mock('../src/healthkit/bloodPressure/importLocal', () => ({
  importLocalBloodPressure: jest.fn(),
  listLocalBloodPressureObservations: jest.fn(),
}));
jest.mock('../src/backup/backupSupport', () => ({
  prepareBackupSupport: jest.fn(async () => 'ready'),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('uses one guarded toolbar for manual entry and blocks exit during save', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const store = createAppointmentStore();
  const create = store.repository.create.bind(store.repository);
  let finishSave!: () => void;
  const pendingSave = new Promise<void>(resolve => {
    finishSave = resolve;
  });
  store.repository.create = jest.fn(async input => {
    await pendingSave;
    return create(input);
  });
  await render(
    <App
      loadAppointments={async () => store.repository}
      loadRecordings={async () => []}
      aiFeatureServiceDependencies={{
        selectedAi: {
          selectionStore: {
            load: async () => null,
            save: async () => undefined,
            clear: async () => undefined,
          },
        },
      }}
    />,
  );
  await fireEvent.press(screen.getByTestId('navigation-tab-schedule'));
  await fireEvent.press(await screen.findByTestId('open-medical-appointments'));
  await fireEvent.press(
    await screen.findByTestId('medical-appointment-manual'),
  );
  expect(screen.getAllByTestId('navigation-action-bar-overlay')).toHaveLength(
    1,
  );
  expect(screen.queryByTestId('appointments-back')).toBeNull();
  await fireEvent.press(await screen.findByTestId('appointment-add'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    '새봄의원',
  );
  await fireEvent.press(screen.getByTestId('navigation-back'));
  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);
  expect(screen.getByTestId('appointment-clinic-input')).toHaveProp(
    'value',
    '새봄의원',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2035-06-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '09:00',
  );
  // Keep the event pending while asserting the storage operation's disabled controls.
  const save = fireEvent.press(screen.getByTestId('appointment-save'));
  await waitFor(() => expect(store.repository.create).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('navigation-back')).toBeDisabled();
  expect(screen.getByTestId('navigation-home')).toBeDisabled();
  await act(async () => {
    finishSave();
    await save;
  });
  await waitFor(() =>
    expect(screen.getByTestId('navigation-back')).toBeEnabled(),
  );
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByTestId('medical-appointment-manual')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('navigation-back'));
  expect(await screen.findByTestId('calendar-title')).toBeTruthy();
  alert.mockRestore();
});

async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}
