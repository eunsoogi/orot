import { render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { AppointmentReminderDeliveryHost } from '../../appointmentReminders/AppointmentReminderDeliveryHost';
import { ReminderGate } from '../GatedReminderDeliveryHost';

jest.mock('../../appointmentReminders/AppointmentReminderDeliveryHost', () => ({
  AppointmentReminderDeliveryHost: jest.fn(() => null),
}));
jest.mock('../../appEntry/RootURLDeliveryHost', () => ({
  RootURLDeliveryHost: () => null,
}));

test('preserves an explicit decline when the gate closes while confirmation is open', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  const controller = createNavigationController<AppNavigationRoute>('root');
  let release!: (value: boolean) => void;
  let decline: (() => void) | undefined;
  const guard = new Promise<boolean>(resolve => {
    release = resolve;
  });
  const confirm = jest.fn((_transition: unknown, cancel?: () => void) => {
    decline = cancel;
    return guard;
  });
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    confirm,
  );
  const selectTab = jest.fn();
  const view = await render(
    <ReminderGate controller={controller} ready selectTab={selectTab} />,
  );
  const host = jest.mocked(AppointmentReminderDeliveryHost);
  const props = host.mock.calls.at(-1)![0];
  let outcome: string | undefined;
  const operation = props.executeReminderEntry!(async () => {
    outcome = await props.controller.requestTabSwitchDecision();
  });
  await waitFor(() => expect(confirm).toHaveBeenCalled());
  await view.rerender(
    <ReminderGate
      controller={controller}
      ready={false}
      selectTab={selectTab}
    />,
  );
  decline?.();
  release(false);
  await operation;
  expect(outcome).toBe('declined');
});

test('only the current approved owner can return to the existing root and select Conversation', async () => {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const root = controller.getSnapshot().currentRoute;
  const child = controller.push('health-records')!;
  controller.registerLeaveGuard(child.key, async () => true);
  const selectTab = jest.fn();
  const view = await render(
    <ReminderGate controller={controller} ready selectTab={selectTab} />,
  );
  const props = jest
    .mocked(AppointmentReminderDeliveryHost)
    .mock.calls.at(-1)![0];
  expect(props.openConversationRoot!(child.key)).toBe(false);
  await props.executeReminderEntry!(async () => {
    expect(await props.controller.requestTabSwitchDecision()).toBe('approved');
    expect(props.openConversationRoot!(child.key)).toBe(true);
  });
  expect(controller.getSnapshot().routes).toEqual([root]);
  expect(selectTab).toHaveBeenCalledTimes(1);
  expect(selectTab).toHaveBeenCalledWith('conversation');
  await view.unmount();
});

test('synchronous root publication that closes the gate cannot select a tab', async () => {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const child = controller.push('health-records')!;
  controller.registerLeaveGuard(child.key, async () => true);
  let allowed = true;
  controller.subscribe(() => {
    if (controller.getSnapshot().routes.length === 1) allowed = false;
  });
  const selectTab = jest.fn();
  const view = await render(
    <ReminderGate
      controller={controller}
      ready
      canEnter={() => allowed}
      selectTab={selectTab}
    />,
  );
  const props = jest
    .mocked(AppointmentReminderDeliveryHost)
    .mock.calls.at(-1)![0];
  await props.executeReminderEntry!(async () => {
    expect(await props.controller.requestTabSwitchDecision()).toBe('approved');
    expect(props.openConversationRoot!(child.key)).toBe(false);
  });
  expect(selectTab).not.toHaveBeenCalled();
  await view.unmount();
});
