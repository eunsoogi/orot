/* global by, describe, device, element, expect, it, waitFor */
const { execFileSync } = require('node:child_process');
const {
  openRootTab,
  expectNativeNavigationAction,
  tapNativeNavigationAction,
} = require('./smokeHelpers');
const { expectContentAboveFloatingBar } = require('./safeAreaHelpers');

describe('unified import through Records', () => {
  it('selects providers in the real shell without requesting device records before import', async () => {
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await openRootTab('records', 'records-title');
    await element(by.id('records-health-import')).tap();
    await waitFor(element(by.id('unified-import-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('건강 기록 가져오기'))).toBeVisible();
    await expectNativeNavigationAction('unified-import-start');
    await expect(element(by.id('unified-import-start'))).toBeDisabled();
    await element(by.id('unified-import-toggle-healthKit')).tap();
    await expect(element(by.id('unified-import-start'))).toBeEnabled();
    await device.takeScreenshot('unified-import-light');
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'dark']);
    await expect(
      element(by.id('unified-import-toggle-eventKit')),
    ).toBeVisible();
    await device.takeScreenshot('unified-import-dark');
    await expectContentAboveFloatingBar(
      'unified-import-scroll',
      'unified-import-status',
    );
    // Selection does not invoke providers; starting a real import is outside this visual route test.
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('records-title')))
      .toBeVisible()
      .withTimeout(30000);
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
  });
});
