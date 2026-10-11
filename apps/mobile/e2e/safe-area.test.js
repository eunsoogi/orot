/* global afterEach, by, device, element, expect, waitFor */

// Detox reserves global expect() for UI elements, so frame numbers use Jest's matcher.
const { expect: jestExpect } = require('@jest/globals');
const {
  expectElementAboveBottomInset,
  expectElementBelowTopInset,
  expectKeyboardOccludesScroll,
  expectFloatingViewport,
  expectRouteScrollTopInset,
  expectScrollInsideRootFrame,
  frameFor,
} = require('./safeAreaHelpers');
const { openRootTab, tapNativeNavigationAction } = require('./smokeHelpers');

describe('safe area routes on iOS Simulator', () => {
  beforeEach(async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
    // Detox applies orientation through the active app session, so launch first.
    await device.setOrientation('portrait');
  });

  afterEach(async () => {
    await device.setOrientation('portrait');
  });

  it('keeps Home and Records within the system insets and reaches Health imports', async () => {
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await expectElementBelowTopInset(
      'welcome-title',
      'navigation-keyboard-avoiding-root',
    );
    await device.takeScreenshot('home-top-safe-area');
    await expectRouteScrollTopInset(
      'navigation-route-scroll',
      'navigation-keyboard-avoiding-root',
    );

    await openRootTab('records', 'records-title');
    await expectElementBelowTopInset(
      'records-title',
      'navigation-keyboard-avoiding-root',
    );
    await device.takeScreenshot('records-top-safe-area');
    const recordsScroll = element(by.id('navigation-route-scroll'));
    await recordsScroll.scrollTo('bottom', 0.5, 0.5);
    const commonObservationsAction = element(
      by.id('records-open-common-observations'),
    );
    await expect(commonObservationsAction).toBeVisible();
    await expectElementAboveBottomInset(
      'records-open-common-observations',
      'navigation-keyboard-avoiding-root',
    );
    await commonObservationsAction.tap();
    await waitFor(element(by.id('common-observations-import')))
      .toBeVisible()
      .withTimeout(30000);
    // Select a category so the trailing import action is enabled during the inset check.
    await element(by.id('common-observations-toggle-heartRate')).tap();
    await expectRouteScrollTopInset(
      'navigation-route-scroll',
      'navigation-keyboard-avoiding-root',
    );
    const commonObservationsScroll = element(by.id('navigation-route-scroll'));
    await commonObservationsScroll.scrollTo('bottom', 0.5, 0.5);
    const importAction = element(by.id('common-observations-import'));
    await expect(importAction).toBeVisible();
    const importAttributes = await importAction.getAttributes();
    jestExpect(importAttributes.enabled).toBe(true);
    await expectElementAboveBottomInset(
      'common-observations-import',
      'navigation-keyboard-avoiding-root',
    );
  });

  it('preserves the recording screen inset root and existing inner scrolling', async () => {
    await openRootTab('records', 'records-title');
    await expect(element(by.id('records-new-recording'))).toBeVisible();
    await element(by.id('records-new-recording')).tap();
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);
    await expectElementBelowTopInset(
      'recording-title',
      'navigation-keyboard-avoiding-root',
    );
    await device.takeScreenshot('recording-top-safe-area');

    await expect(element(by.id('navigation-route-scroll'))).not.toExist();
    await expect(element(by.id('recording-start'))).toBeVisible();
    await expectRouteScrollTopInset(
      'recording-controls-scroll',
      'navigation-keyboard-avoiding-root',
    );
    await expectFloatingViewport(
      'recording-controls-scroll',
      'recording-start',
    );
  });

  it('keeps the blood-pressure list inside the safe area and reaches its import action', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_E2E_PROBE: 'safe-area-blood-pressure' },
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });

    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await openRootTab('records', 'records-title');
    await element(by.id('navigation-route-scroll')).scrollTo(
      'bottom',
      0.5,
      0.5,
    );
    await element(by.id('records-open-blood-pressure')).tap();
    await waitFor(element(by.id('blood-pressure-title')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('blood-pressure-open-library')).tap();
    await waitFor(element(by.id('health-records-title')))
      .toBeVisible()
      .withTimeout(30000);
    const lastReading = element(by.id('health-record-row-23'));
    await waitFor(lastReading).toExist().withTimeout(30000);

    await expect(element(by.id('navigation-route-scroll'))).not.toExist();
    await expectScrollInsideRootFrame(
      'health-records-scroll',
      'navigation-keyboard-avoiding-root',
    );

    const recordsScroll = element(by.id('health-records-scroll'));
    await recordsScroll.scrollTo('bottom', 0.5, 0.5);
    await expect(lastReading).toBeVisible();
    await expectElementAboveBottomInset(
      'health-record-row-23',
      'navigation-keyboard-avoiding-root',
    );
    await recordsScroll.scrollTo('top');
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('blood-pressure-title')))
      .toBeVisible()
      .withTimeout(30000);

    const importAction = element(by.id('blood-pressure-import'));
    await expect(importAction).toBeVisible();
    await expectElementAboveBottomInset(
      'blood-pressure-import',
      'navigation-keyboard-avoiding-root',
    );
    // Detox exposes enabled through attributes; keep this check before tapping.
    jestExpect((await importAction.getAttributes()).enabled).toBe(true);
    await importAction.tap();
    await waitFor(element(by.id('blood-pressure-status')))
      .toHaveText('새로 반영된 기록이 없어요')
      .withTimeout(30000);
  });

  it('keeps a primary action reachable with large text and the keyboard open', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        OROT_E2E_PROBE: 'safe-area',
        UIPreferredContentSizeCategoryName:
          'UICTContentSizeCategoryAccessibilityXXXL',
      },
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });

    await waitFor(element(by.id('safe-area-large-text-state')))
      .toHaveLabel('큰 글자 사용 중')
      .withTimeout(30000);
    await expectScrollInsideRootFrame('safe-area-scroll', 'safe-area-root');

    const input = element(by.id('safe-area-keyboard-input'));
    await input.tap();
    await expect(input).toBeFocused();
    await waitFor(element(by.id('safe-area-keyboard-visible')))
      .toExist()
      .withTimeout(30000);

    const scrollFrame = await frameFor('safe-area-scroll');
    await expectKeyboardOccludesScroll(scrollFrame);

    const keyboardAction = element(by.id('safe-area-keyboard-action'));
    await expect(keyboardAction).not.toBeVisible();
    await element(by.id('safe-area-scroll')).scrollTo('bottom');
    await expect(keyboardAction).toBeVisible();
    await expectKeyboardOccludesScroll(scrollFrame);
    await keyboardAction.tap();
    await expect(
      element(by.id('safe-area-keyboard-action-done')),
    ).toBeVisible();
    await expectKeyboardOccludesScroll(scrollFrame);
  });
});
