/* global by, device, element, expect, waitFor, describe, it */

describe('SQLCipher LangGraph checkpoint resume', () => {
  it('resumes a completed node after the app process restarts', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_E2E_PROBE: 'checkpoint' },
    });
    await element(by.id('checkpoint-start')).tap();
    await waitFor(element(by.id('checkpoint-saved')))
      .toBeVisible()
      .withTimeout(30000);

    await device.terminateApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_E2E_PROBE: 'checkpoint' },
    });
    await element(by.id('checkpoint-resume')).tap();
    await waitFor(element(by.id('checkpoint-complete')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('checkpoint-result')))
      .toHaveText('value=8; nodes=increment,double; note=환자 기록: café 🌱🩺');
  });
});
