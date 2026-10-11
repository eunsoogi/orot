/* global by, describe, device, element, expect, it, waitFor */

const { expectContentAboveFloatingBar } = require('./safeAreaHelpers');
const { openRootTab, tapNativeNavigationAction } = require('./smokeHelpers');

describe('Settings navigation', () => {
  it('keeps provider, account, privacy, and backup details under the Settings tab', async () => {
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await openRootTab('settings', 'settings-title');
    await expect(element(by.id('settings-open-provider'))).toBeVisible();
    await expect(element(by.id('settings-open-accounts'))).toBeVisible();
    await expect(element(by.id('settings-open-privacy'))).toBeVisible();
    await expect(element(by.id('settings-open-backup'))).toBeVisible();
    await device.takeScreenshot('settings-root-light');

    await element(by.id('settings-open-accounts')).tap();
    // Account management is a distinct settings route from provider/model selection.
    await waitFor(element(by.id('settings-accounts-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('연결된 계정'))).toExist();
    await expect(element(by.id('chatgpt-account-setup'))).toExist();
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('settings-title')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('settings-open-backup')).tap();
    await waitFor(element(by.id('settings-backup-title')))
      .toBeVisible()
      .withTimeout(30000);
    // Assert the actual status and controls, rather than opacity of a structural container.
    await expect(element(by.id('backup-status-message'))).toBeVisible();
    await expect(element(by.id('backup-prepare'))).toBeVisible();
    await waitFor(element(by.id('backup-open-system-settings')))
      .toBeVisible()
      .whileElement(by.id('settings-backup-scroll'))
      .scroll(100, 'down', 0.5, 0.4);
    await expect(element(by.id('backup-open-system-settings'))).toBeVisible();
    await expectContentAboveFloatingBar(
      'settings-backup-scroll',
      'backup-open-system-settings',
    );
    await device.takeScreenshot('settings-backup-light');
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('settings-title')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('settings-open-privacy')).tap();
    await waitFor(element(by.id('settings-privacy-title')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('마이크'))).toExist();
    await expect(element(by.text('음성 인식'))).toExist();
    await expect(element(by.text('건강 앱'))).toExist();
    await expect(element(by.text('캘린더'))).toExist();
    await expectContentAboveFloatingBar(
      'settings-privacy-scroll',
      'privacy-open-system-settings',
    );
    await expect(element(by.id('privacy-open-system-settings'))).toBeVisible();
    await device.takeScreenshot('settings-privacy-light');
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('settings-title')))
      .toBeVisible()
      .withTimeout(30000);
  }, 90_000);
});
