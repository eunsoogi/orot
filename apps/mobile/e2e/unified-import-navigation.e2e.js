/* global by, describe, device, element, expect, it, waitFor */
const { execFileSync } = require('node:child_process');
const { expect: jestExpect } = require('@jest/globals');
const {
  openRootTab,
  expectNativeNavigationAction,
  tapNativeNavigationAction,
} = require('./smokeHelpers');
const { expectContentAboveFloatingBar } = require('./safeAreaHelpers');

describe('unified import through Records', () => {
  it('selects providers in the real shell without requesting device records before import', async () => {
    // Keep UIKit's disabled trait separate from Detox's enabled attribute; XCUITest observed them disagree on the same app build.
    const disabledImportAction = element(
      by.id('unified-import-start').and(by.traits(['notEnabled'])),
    );
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
    // UIKit exposes the actual enabled state through Detox element attributes.
    jestExpect(
      (await element(by.id('unified-import-start')).getAttributes()).enabled,
    ).toBe(false);
    await expect(disabledImportAction).toExist();
    // Appearance changes must not enable import while the provider selection is still empty.
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'dark']);
    await expect(
      element(by.id('unified-import-toggle-healthKit')),
    ).toBeVisible();
    jestExpect(
      (await element(by.id('unified-import-start')).getAttributes()).enabled,
    ).toBe(false);
    await expect(disabledImportAction).toExist();
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
    await expect(
      element(by.id('unified-import-toggle-healthKit')),
    ).toBeVisible();
    jestExpect(
      (await element(by.id('unified-import-start')).getAttributes()).enabled,
    ).toBe(false);
    await expect(disabledImportAction).toExist();
    await element(by.id('unified-import-toggle-healthKit')).tap();
    jestExpect(
      (await element(by.id('unified-import-start')).getAttributes()).enabled,
    ).toBe(true);
    await expect(disabledImportAction).not.toExist();
    await device.takeScreenshot('unified-import-light');
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'dark']);
    await expect(
      element(by.id('unified-import-toggle-eventKit')),
    ).toBeVisible();
    jestExpect(
      (await element(by.id('unified-import-start')).getAttributes()).enabled,
    ).toBe(true);
    await device.takeScreenshot('unified-import-dark');
    // Clearing the only provider must disable the same native action again.
    await element(by.id('unified-import-toggle-healthKit')).tap();
    jestExpect(
      (await element(by.id('unified-import-start')).getAttributes()).enabled,
    ).toBe(false);
    await expect(disabledImportAction).toExist();
    await expectContentAboveFloatingBar(
      'unified-import-scroll',
      'unified-import-status',
    );
    // Preserve the scrolled-end geometry, where root-to-detail bar offsets can cover the final status.
    await device.takeScreenshot('unified-import-content-clearance');
    // Selection does not invoke providers; starting a real import is outside this visual route test.
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('records-title')))
      .toBeVisible()
      .withTimeout(30000);
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
  });
});
