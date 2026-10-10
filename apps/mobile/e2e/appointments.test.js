/* global by, device, element, waitFor */

const { expect: jestExpect } = require('@jest/globals');

async function expectVisible(id) {
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .withTimeout(30000);
}

async function expectTextVisible(text) {
  await waitFor(element(by.text(text)))
    .toBeVisible()
    .withTimeout(30000);
}

async function expectSafeAreaAndBottomBack() {
  const root = await element(by.id('safe-area-root')).getAttributes();
  const scroll = await element(by.id('appointments-scroll')).getAttributes();
  const title = await element(by.id('appointments-title')).getAttributes();
  const toolbar = await element(
    by.id('navigation-native-toolbar'),
  ).getAttributes();
  const back = await element(by.id('appointments-back')).getAttributes();

  for (const [description, attributes] of [
    ['safe-area root', root],
    ['appointment scroll', scroll],
    ['appointment title', title],
    ['native toolbar', toolbar],
    ['bottom back action', back],
  ]) {
    if (!attributes.frame) {
      throw new Error(`Detox did not return a frame for ${description}.`);
    }
  }

  jestExpect(scroll.frame.y - root.frame.y).toBeGreaterThanOrEqual(44);
  jestExpect(title.frame.y - root.frame.y).toBeGreaterThanOrEqual(44);
  jestExpect(back.frame.width).toBeGreaterThanOrEqual(44);
  jestExpect(back.frame.height).toBeGreaterThanOrEqual(44);
  jestExpect(back.frame.y).toBeGreaterThanOrEqual(toolbar.frame.y);
  jestExpect(back.frame.y + back.frame.height).toBeLessThanOrEqual(
    toolbar.frame.y + toolbar.frame.height,
  );
  await expect(element(by.id('appointments-top-back'))).not.toExist();
  await device.takeScreenshot('manual-appointments-bottom-back-safe-area');
}

async function tapAppointmentsBack() {
  const toolbar = await element(
    by.id('navigation-native-toolbar'),
  ).getAttributes();
  const back = await element(by.id('appointments-back')).getAttributes();

  await element(by.id('navigation-native-toolbar')).tap({
    x: back.frame.x + back.frame.width / 2 - toolbar.frame.x,
    y: back.frame.y + back.frame.height / 2 - toolbar.frame.y,
  });
}

async function expectAppointmentsOpen() {
  await waitFor(element(by.id('appointments-title')))
    .toHaveText('예약')
    .withTimeout(30000);
  await expectVisible('appointment-add');
}

async function expectEmptyAppointments() {
  await waitFor(element(by.id('appointments-empty')))
    .toHaveText('등록된 예약이 없어요.')
    .withTimeout(30000);
}

async function fillAppointment(clinic, date, time, note) {
  // Follow the visible form as a user would while the keyboard reduces its viewport.
  for (const [field, value] of [
    ['clinic', clinic],
    ['date', date],
    ['time', time],
    ['note', note],
  ]) {
    const input = element(by.id(`appointment-${field}-input`));
    await waitFor(input)
      .toBeVisible()
      .whileElement(by.id('appointments-scroll'))
      .scroll(100, 'down', 0.5, 0.4);
    await input.replaceText(value);
  }
  await device.takeScreenshot('appointment-editor-keyboard');
  await element(by.id('appointment-note-input')).tapReturnKey();
  await waitFor(element(by.id('appointment-save')))
    .toBeVisible()
    .whileElement(by.id('appointments-scroll'))
    .scroll(100, 'down', 0.5, 0.4);
  await element(by.id('appointment-save')).tap();
}

describe('manual appointments', () => {
  // A fresh CI simulator pays for one cold launch and two restarts; the full flow took about 151 seconds.
  // Keep a 180-second budget local to this persistence scenario instead of widening the whole suite.
  it('creates, edits, and cancels an appointment that survives process restarts', async () => {
    await device.launchApp({
      // The runner installs a fresh app before this scenario; the explicit terminations below cover actual restarts.
      newInstance: false,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: { OROT_E2E_PROBE: 'appointments' },
    });
    await expectAppointmentsOpen();
    await expectSafeAreaAndBottomBack();
    await expectEmptyAppointments();

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
    await expectSafeAreaAndBottomBack();
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
    await expectSafeAreaAndBottomBack();
    await expectTextVisible('Neurology clinic');
    await expect(element(by.text('Neurology clinic'))).toBeVisible();
    await expectTextVisible('2027년 6월 3일 10:15 · 현지 시간');
    await expectTextVisible('취소됨');
    await tapAppointmentsBack();
    await expectVisible('welcome-title');
  }, 180_000);
});
