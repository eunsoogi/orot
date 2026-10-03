/* global by, device, element, waitFor */

async function expectVisible(id) {
  await waitFor(element(by.id(id))).toBeVisible().withTimeout(30000);
}

async function openAppointments() {
  await element(by.id('open-appointments')).tap();
}

async function fillAppointment(clinic, date, time, note) {
  await element(by.id('appointment-clinic-input')).replaceText(clinic);
  await element(by.id('appointment-date-input')).replaceText(date);
  await element(by.id('appointment-time-input')).replaceText(time);
  if (note) await element(by.id('appointment-note-input')).replaceText(note);
  await element(by.id(note ? 'appointment-note-input' : 'appointment-time-input')).tapReturnKey();
  await element(by.id('appointment-save')).tap();
}

describe('manual appointments', () => {
  beforeAll(async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
  });

  it('creates, edits, and cancels an appointment that survives process restarts', async () => {
    await device.launchApp();
    await expectVisible('welcome-title');
    await openAppointments();
    await expectVisible('appointments-empty');

    await element(by.id('appointment-add')).tap();
    await fillAppointment('Cardiology clinic', '2027-06-02', '09:45', 'Bring the test results.');
    await expect(element(by.text('Cardiology clinic'))).toBeVisible();
    await expect(element(by.text('2027-06-02 at 09:45 (local time)'))).toBeVisible();
    await expect(element(by.text('Bring the test results.'))).toBeVisible();
    await expect(element(by.text('Scheduled'))).toBeVisible();

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await expectVisible('welcome-title');
    await openAppointments();
    await waitFor(element(by.text('Cardiology clinic'))).toBeVisible().withTimeout(30000);
    await expect(element(by.text('Cardiology clinic'))).toBeVisible();
    await expect(element(by.text('2027-06-02 at 09:45 (local time)'))).toBeVisible();
    await expect(element(by.text('Bring the test results.'))).toBeVisible();

    await element(by.text('Edit')).tap();
    await fillAppointment('Neurology clinic', '2027-06-03', '10:15', '');
    await expect(element(by.text('Neurology clinic'))).toBeVisible();
    await expect(element(by.text('2027-06-03 at 10:15 (local time)'))).toBeVisible();
    await expect(element(by.text('Rescheduled'))).toBeVisible();

    await element(by.text('Cancel appointment')).tap();
    await expect(element(by.text('Cancelled'))).toBeVisible();
    await expect(element(by.text('Cancel appointment'))).not.toExist();

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await expectVisible('welcome-title');
    await openAppointments();
    await waitFor(element(by.text('Neurology clinic'))).toBeVisible().withTimeout(30000);
    await expect(element(by.text('Neurology clinic'))).toBeVisible();
    await expect(element(by.text('2027-06-03 at 10:15 (local time)'))).toBeVisible();
    await expect(element(by.text('Cancelled'))).toBeVisible();
  });
});
