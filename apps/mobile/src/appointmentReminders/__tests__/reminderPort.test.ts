import { createAppointmentReminderPort } from '../reminderPort';
import type { AppointmentReminderNativeModule } from '../reminderPort';
import { createAppointmentReminderDelivery } from '../reminderCoordinator';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import type { Appointment } from '@orot/storage';

function setup() {
  const native = {
    readSelection: jest.fn(async (): Promise<unknown> => null),
    writeSelection: jest.fn(async () => undefined),
    authorizationStatus: jest.fn(async (): Promise<unknown> => 'authorized'),
    requestAuthorization: jest.fn(async (): Promise<unknown> => 'denied'),
    replace: jest.fn(async () => undefined),
    consumeTarget: jest.fn(async () => null),
  } satisfies AppointmentReminderNativeModule;
  return { native, port: createAppointmentReminderPort(() => native) };
}

it('restores only the opaque identity and supported duration from a saved selection', async () => {
  const { native, port } = setup();
  native.readSelection.mockResolvedValueOnce({
    appointmentId: 'synthetic-visit',
    leadMinutes: 1440,
    unexpected: 'discard',
  });
  await expect(port.readSelection()).resolves.toEqual({
    appointmentId: 'synthetic-visit',
    leadMinutes: 1440,
  });
  expect(native.requestAuthorization).not.toHaveBeenCalled();
});

it.each([undefined, 'visit', {}, { appointmentId: 'visit', leadMinutes: -1 }])(
  'rejects an invalid saved preference %p',
  async value => {
    const { native, port } = setup();
    native.readSelection.mockResolvedValueOnce(value);
    await expect(port.readSelection()).rejects.toThrow(
      'The saved reminder preference is invalid.',
    );
  },
);

it('distinguishes passive authorization reads from an explicit request', async () => {
  const { native, port } = setup();
  await expect(port.authorizationStatus()).resolves.toBe('authorized');
  expect(native.requestAuthorization).not.toHaveBeenCalled();
  await expect(port.requestAuthorization()).resolves.toBe('denied');
  expect(native.requestAuthorization).toHaveBeenCalledTimes(1);
});

it('does not interpret a missing native authorization response as permission', async () => {
  const { native, port } = setup();
  native.authorizationStatus.mockResolvedValueOnce(undefined);
  await expect(port.authorizationStatus()).rejects.toThrow(
    'Notification authorization is unavailable.',
  );
});

it('preserves native failure rather than pretending a local alert was scheduled', async () => {
  const { native, port } = setup();
  native.replace.mockRejectedValueOnce(
    new Error('Synthetic scheduling failure'),
  );
  await expect(port.replace(null)).rejects.toThrow(
    'Synthetic scheduling failure',
  );
});

function deliverySetup() {
  const target = {
    appointmentId: appointment.id,
    timeKey: `instant:${Date.parse(appointment.effectiveAt)}`,
  };
  const port = {
    consumeTarget: jest.fn(async (): Promise<unknown> => null),
    loadAppointments: jest.fn(async (): Promise<readonly Appointment[]> => [
      appointment,
    ]),
    confirmNavigation: jest.fn(
      async (): Promise<'approved' | 'declined' | 'busy'> => 'approved',
    ),
    openVisitPreparation: jest.fn(() => true),
    onUnavailable: jest.fn(),
  };
  port.consumeTarget.mockResolvedValueOnce(target);
  return {
    port,
    deliver: createAppointmentReminderDelivery(port, () =>
      Date.parse('2035-06-01T00:00:00Z'),
    ),
  };
}

it('opens a consumed target once when two delivery wake signals overlap', async () => {
  const { port, deliver } = deliverySetup();
  await expect(Promise.all([deliver(), deliver()])).resolves.toEqual([
    'opened',
    'empty',
  ]);
  expect(port.openVisitPreparation).toHaveBeenCalledTimes(1);
  expect(port.openVisitPreparation).toHaveBeenCalledWith(appointment);
});

it('does not open a visit cancelled while the existing navigation guard is awaiting approval', async () => {
  const { port, deliver } = deliverySetup();
  port.confirmNavigation.mockImplementationOnce(async () => {
    port.loadAppointments.mockResolvedValue([
      { ...appointment, status: 'cancelled' },
    ]);
    return 'approved';
  });
  await expect(deliver()).resolves.toBe('stale');
  expect(port.openVisitPreparation).not.toHaveBeenCalled();
  expect(port.onUnavailable).toHaveBeenCalledWith('stale');
});

it('does not navigate or retry unsolicited after the user declines to leave active work', async () => {
  const { port, deliver } = deliverySetup();
  port.confirmNavigation.mockResolvedValueOnce('declined');
  await expect(deliver()).resolves.toBe('declined');
  await expect(deliver()).resolves.toBe('empty');
  expect(port.openVisitPreparation).not.toHaveBeenCalled();
});

it('retains the exact consumed target after a storage failure for an explicit later retry', async () => {
  const { port, deliver } = deliverySetup();
  port.loadAppointments.mockRejectedValueOnce(
    new Error('Synthetic storage unavailable'),
  );
  await expect(deliver()).resolves.toBe('error');
  expect(port.openVisitPreparation).not.toHaveBeenCalled();
  await expect(deliver()).resolves.toBe('opened');
  expect(port.openVisitPreparation).toHaveBeenCalledWith(appointment);
});

it('does not fall back to another appointment when the named visit is missing', async () => {
  const { port, deliver } = deliverySetup();
  port.loadAppointments.mockResolvedValue([
    { ...appointment, id: 'another-visit' },
  ]);
  await expect(deliver()).resolves.toBe('stale');
  expect(port.confirmNavigation).not.toHaveBeenCalled();
  expect(port.openVisitPreparation).not.toHaveBeenCalled();
});

it('rejects an unexpected undefined inbox response instead of opening a retained target', async () => {
  const { port, deliver } = deliverySetup();
  port.loadAppointments.mockRejectedValueOnce(
    new Error('Synthetic storage unavailable'),
  );
  await expect(deliver()).resolves.toBe('error');
  port.consumeTarget.mockResolvedValueOnce(undefined);
  await expect(deliver()).resolves.toBe('stale');
  expect(port.openVisitPreparation).not.toHaveBeenCalled();
});
