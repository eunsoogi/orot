/* global beforeEach, jest */

const { NativeModules } = require('react-native');

/** App navigation tests model an installed module with no opt-in and no tap.
 * NSNull crosses the native bridge as null; undefined would be malformed input.
 * Scheduling and permission tests supply their own explicit fixtures instead.
 * This adapter does not prove OS authorization, delivery, or persistence.
 */
beforeEach(() => {
  NativeModules.AppointmentReminderModule = {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
    readSelection: jest.fn(async () => null),
    writeSelection: jest.fn(async () => undefined),
    authorizationStatus: jest.fn(async () => 'notDetermined'),
    requestAuthorization: jest.fn(async () => 'denied'),
    replace: jest.fn(async () => undefined),
    consumeTarget: jest.fn(async () => null),
  };
});
