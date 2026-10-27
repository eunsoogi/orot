import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import AppointmentsScreen from '../AppointmentsScreen';
import { appContentLayoutOwner } from '../../navigation/appContentLayoutPolicy';
import type { NavigationRoute } from '../../navigation/navigationController';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';

const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};
const windowBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();

beforeEach(() => windowBounds.clear());

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = windowBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 600);
  });

function axis(testID: string): string | undefined {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style)
    ?.flexDirection;
}

function setWindowBounds(testID: string, x: number, width: number) {
  windowBounds.set(testID, { x, width });
}

test('keeps the selected appointment details through measured column changes', async () => {
  const store = createAppointmentStore();
  await store.create({
    clinicLabel: 'Cardiology clinic',
    effectiveAt: '2035-06-02T09:30:00.000Z',
  });
  await store.create({
    clinicLabel: 'Neurology clinic',
    effectiveAt: '2035-06-03T10:15:00.000Z',
  });
  let parentWidth = 1440;
  let measuredContentWidth = 1400;
  const tree = () => (
    <View style={{ width: parentWidth }}>
      <AppointmentsScreen repository={store.repository} />
    </View>
  );
  const rendered = await render(tree());

  const selection = await screen.findByTestId('appointment-select-manual-2');
  await fireEvent.press(selection);
  expect(selection.props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('appointment-manual-2')).toBeTruthy();
  expect(screen.getByTestId('appointment-clinic-manual-2')).toHaveTextContent(
    'Neurology clinic',
  );

  expect(axis('appointments-columns')).toBe('column');
  setWindowBounds('appointments-columns-host', 0, measuredContentWidth);
  await fireEvent(screen.getByTestId('appointments-columns-host'), 'layout', {
    nativeEvent: {
      layout: { width: measuredContentWidth, height: 600, x: 0, y: 0 },
    },
  });
  expect(axis('appointments-columns')).toBe('row');
  expect(
    screen.getByTestId('appointment-select-manual-2').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(screen.getByTestId('appointment-clinic-manual-2')).toHaveTextContent(
    'Neurology clinic',
  );

  parentWidth = 640;
  measuredContentWidth = 600;
  setWindowBounds('appointments-columns-host', 0, measuredContentWidth);
  await rendered.rerender(tree());
  await fireEvent(screen.getByTestId('appointments-columns-host'), 'layout', {
    nativeEvent: {
      layout: { width: measuredContentWidth, height: 600, x: 0, y: 0 },
    },
  });
  expect(axis('appointments-columns')).toBe('column');
  expect(
    screen.getByTestId('appointment-select-manual-2').props.accessibilityState,
  ).toEqual({ selected: true });
});

test('keeps the appointment form readable and intact when its measured parent narrows', async () => {
  const store = createAppointmentStore();
  let parentWidth = 940;
  let measuredContentWidth = 900;
  const tree = () => (
    <View style={{ width: parentWidth }}>
      <AppointmentsScreen repository={store.repository} />
    </View>
  );
  const rendered = await render(tree());

  await screen.findByTestId('appointments-empty');
  await fireEvent.press(screen.getByTestId('appointment-add'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'Cardiology clinic draft',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2035-06-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '09:30',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-note-input'),
    'Bring the test results.',
  );

  // Match the ScrollView's 20-point horizontal padding within its wider parent.
  setWindowBounds('appointments-columns-host', 0, measuredContentWidth);
  await fireEvent(screen.getByTestId('appointments-columns-host'), 'layout', {
    nativeEvent: {
      layout: { width: measuredContentWidth, height: 600, x: 0, y: 0 },
    },
  });
  const formStyle = () =>
    StyleSheet.flatten(screen.getByTestId('appointment-form').props.style);
  expect(formStyle()).toMatchObject({
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
  });
  expect(screen.getByTestId('appointment-form-explanation')).toHaveTextContent(
    '진료 예약 정보를 이 기기에 저장해요.',
  );
  expect(
    StyleSheet.flatten(screen.getByTestId('appointments-columns').props.style)
      ?.width,
  ).toBeLessThanOrEqual(measuredContentWidth);

  parentWidth = 360;
  measuredContentWidth = 320;
  setWindowBounds('appointments-columns-host', 0, measuredContentWidth);
  await rendered.rerender(tree());
  await fireEvent(screen.getByTestId('appointments-columns-host'), 'layout', {
    nativeEvent: {
      layout: { width: measuredContentWidth, height: 600, x: 0, y: 0 },
    },
  });

  expect(screen.getByTestId('appointment-clinic-input')).toHaveDisplayValue(
    'Cardiology clinic draft',
  );
  expect(screen.getByTestId('appointment-date-input')).toHaveDisplayValue(
    '2035-06-02',
  );
  expect(screen.getByTestId('appointment-time-input')).toHaveDisplayValue(
    '09:30',
  );
  expect(screen.getByTestId('appointment-note-input')).toHaveDisplayValue(
    'Bring the test results.',
  );
  expect(screen.getByTestId('appointment-save')).toBeTruthy();
  expect(screen.getByTestId('appointment-form-cancel')).toBeTruthy();
  expect(screen.getByTestId('appointments-scroll').props).toMatchObject({
    keyboardDismissMode: 'interactive',
    keyboardShouldPersistTaps: 'handled',
  });
  expect(
    StyleSheet.flatten(screen.getByTestId('appointments-columns').props.style)
      ?.width,
  ).toBeLessThanOrEqual(measuredContentWidth);
});

test('selects a newly saved appointment in the detail panel', async () => {
  const store = createAppointmentStore();
  await render(<AppointmentsScreen repository={store.repository} />);

  await screen.findByTestId('appointments-empty');
  await fireEvent.press(screen.getByTestId('appointment-add'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'New clinic',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2035-06-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '09:30',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));

  const selection = await screen.findByTestId('appointment-select-manual-1');
  expect(selection.props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByTestId('appointment-clinic-manual-1')).toHaveTextContent(
    'New clinic',
  );
});

test('keeps appointment and classification routes screen-owned', () => {
  const appointmentRoute: NavigationRoute<string> = {
    key: 'appointment-route',
    name: 'appointments',
  };
  const manualRoute: NavigationRoute<string> = {
    key: 'manual-appointment-route',
    name: 'medical-manual',
  };
  const medicalRoute: NavigationRoute<string> = {
    key: 'medical-route',
    name: 'medical',
  };

  if (typeof appContentLayoutOwner !== 'function') {
    throw new Error('The application route layout policy must be a resolver');
  }
  expect(appContentLayoutOwner(appointmentRoute)).toBe('screen');
  expect(appContentLayoutOwner(manualRoute)).toBe('screen');
  expect(appContentLayoutOwner(medicalRoute)).toBe('screen');
});
