/* global by, device, element, waitFor */

async function expectVisible(id) {
  await waitFor(element(by.id(id))).toBeVisible().withTimeout(30000);
}

async function expectTextVisible(text) {
  await waitFor(element(by.text(text))).toBeVisible().withTimeout(30000);
}

async function expectAppointmentsOpen() {
  await expectVisible('appointments-probe-ready');
  await expectVisible('appointment-add');
  await expect(element(by.id('appointments-title'))).toHaveText('예약');
}

async function fillAppointment(clinic, date, time, note) {
  await element(by.id('appointment-clinic-input')).replaceText(clinic);
  await element(by.id('appointment-date-input')).replaceText(date);
  await element(by.id('appointment-time-input')).replaceText(time);
  if (note) await element(by.id('appointment-note-input')).replaceText(note);
  await element(
    by.id(note ? 'appointment-note-input' : 'appointment-time-input'),
  ).tapReturnKey();
  await element(by.id('appointment-save')).tap();
}

describe('manual appointments', () => {
  it('creates, edits, and cancels an appointment that survives process restarts', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: { OROT_E2E_PROBE: 'appointments' },
    });
    await expectAppointmentsOpen();
    await expect(element(by.id('appointments-empty'))).toHaveText(
      '등록된 예약이 없어요.',
    );

    await element(by.id('appointment-add')).tap();
    await fillAppointment(
      'Cardiology clinic',
      '2027-06-02',
      '09:45',
      'Bring the test results.',
    );
    await expectTextVisible('Cardiology clinic');
    await expectTextVisible('2027년 6월 2일 09:45 · 현지 시간');
    await expect(element(by.text('Bring the test results.'))).toBeVisible();
    await expectTextVisible('예정');
    await expect(
      element(by.label('Cardiology clinic 예약 취소')),
    ).toBeVisible();

    await device.terminateApp();
    await device.launchApp({
      newInstance: false,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: { OROT_E2E_PROBE: 'appointments' },
    });
    await expectAppointmentsOpen();
    await expectTextVisible('Cardiology clinic');
    await expect(element(by.text('Cardiology clinic'))).toBeVisible();
    await expectTextVisible('2027년 6월 2일 09:45 · 현지 시간');
    await expect(element(by.text('Bring the test results.'))).toBeVisible();

    await element(by.text('수정')).tap();
    await fillAppointment('Neurology clinic', '2027-06-03', '10:15', '');
    await expectTextVisible('Neurology clinic');
    await expectTextVisible('2027년 6월 3일 10:15 · 현지 시간');
    await expectTextVisible('일정 변경');

    await element(by.label('Neurology clinic 예약 취소')).tap();
    await expectTextVisible('취소됨');
    await expect(element(by.text('예약 취소'))).not.toExist();

    await device.terminateApp();
    await device.launchApp({
      newInstance: false,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: { OROT_E2E_PROBE: 'appointments' },
    });
    await expectAppointmentsOpen();
    await expectTextVisible('Neurology clinic');
    await expect(element(by.text('Neurology clinic'))).toBeVisible();
    await expectTextVisible('2027년 6월 3일 10:15 · 현지 시간');
    await expectTextVisible('취소됨');
  });
});
