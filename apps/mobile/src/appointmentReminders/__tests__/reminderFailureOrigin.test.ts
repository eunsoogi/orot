import {
  captureReminderFailureOrigin,
  enableReminderFailureOrigins,
  preserveReminderFailureOrigin,
  observeReminderRejection,
  reminderFailureOrigin,
} from '../reminderFailureOrigin';
import { createAppointmentReminderPort } from '../reminderPort';

const runID = 'c5555555-1111-2222-3333-444444444444';
const payload = (operationSequence: unknown, run = runID) =>
  Object.assign(new Error('Normalized'), {
    userInfo: {
      orotReminderOrigin: {
        runID: run,
        operationSequence,
        privateText: 'discard',
      },
    },
  });

it('does not retain a carrier without test-entry opt-in', () => {
  const error = payload(1);
  captureReminderFailureOrigin(error);
  expect(reminderFailureOrigin(error)).toBeUndefined();
});

it.each([
  0,
  -1,
  1.5,
  '2',
  NaN,
  Infinity,
  Number.MAX_SAFE_INTEGER + 1,
  undefined,
])('leaves malformed origin %p unknown', value => {
  const stop = enableReminderFailureOrigins(runID);
  try {
    const error = payload(value);
    captureReminderFailureOrigin(error);
    expect(reminderFailureOrigin(error)).toBeUndefined();
  } finally {
    stop();
  }
});

it('keeps missing and foreign-run origins unknown, never inferring from another error', () => {
  const stop = enableReminderFailureOrigins(runID);
  try {
    const a = payload(1);
    captureReminderFailureOrigin(a);
    const b = payload(2, 'd5555555-1111-2222-3333-444444444444');
    captureReminderFailureOrigin(b);
    expect(reminderFailureOrigin(b)).toBeUndefined();
    expect(reminderFailureOrigin(new Error('missing'))).toBeUndefined();
    expect(
      reminderFailureOrigin(
        preserveReminderFailureOrigin(a, new Error('Generic')),
      ),
    ).toEqual({ runID, operationSequence: 1 });
  } finally {
    stop();
  }
});

it('the port preserves the actual rejected object and normalized public error', async () => {
  const stop = enableReminderFailureOrigins(runID);
  const a = payload(19);
  const port = createAppointmentReminderPort(() => ({
    readSelection: async () => null,
    writeSelection: async () => undefined,
    authorizationStatus: async () => 'authorized',
    requestAuthorization: async () => 'authorized',
    consumeTarget: async () => null,
    replace: async () => {
      throw a;
    },
  }));
  try {
    await expect(port.replace(null)).rejects.toBe(a);
    expect(a.message).toBe('Normalized');
    expect(reminderFailureOrigin(a)).toEqual({ runID, operationSequence: 19 });
    expect(Object.keys(reminderFailureOrigin(a)!)).toEqual([
      'runID',
      'operationSequence',
    ]);
  } finally {
    stop();
  }
  expect(reminderFailureOrigin(a)).toBeUndefined();
});

it('the ungated port keeps its existing promise and synchronous throw identity', async () => {
  const promise = Promise.resolve();
  expect(observeReminderRejection(() => promise)).toBe(promise);
  const error = new Error('Original');
  expect(() =>
    observeReminderRejection(() => {
      throw error;
    }),
  ).toThrow(error);
  await expect(
    observeReminderRejection(() => Promise.reject(error)),
  ).rejects.toBe(error);
});
