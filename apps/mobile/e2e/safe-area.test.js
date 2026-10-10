/* global afterEach, by, device, element, expect, waitFor */

// Detox reserves global expect() for UI elements, so frame numbers use Jest's matcher.
const { expect: jestExpect } = require('@jest/globals');

// The default Detox simulator has a notch and Home indicator; measurements are points.
const MINIMUM_TOP_SAFE_AREA_POINTS = 44;
const MINIMUM_BOTTOM_SAFE_AREA_POINTS = 20;

async function frameOf(target, description) {
  const attributes = await target.getAttributes();
  if (!attributes.frame) {
    throw new Error(`Detox did not return a frame for ${description}.`);
  }
  return attributes.frame;
}

async function frameFor(testID) {
  return frameOf(element(by.id(testID)), testID);
}

async function expectScrollInsideRootFrame(
  scrollTestID = 'safe-area-scroll',
  rootTestID = 'safe-area-root',
) {
  const root = await frameFor(rootTestID);
  const scroll = await frameFor(scrollTestID);

  // Require meaningful edge clearance so a 1-point padding regression fails.
  jestExpect(scroll.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
  jestExpect(
    root.y + root.height - scroll.y - scroll.height,
  ).toBeGreaterThanOrEqual(MINIMUM_BOTTOM_SAFE_AREA_POINTS);
}

async function expectRouteScrollTopInset(scrollTestID, rootTestID) {
  const root = await frameFor(rootTestID);
  const scroll = await frameFor(scrollTestID);

  jestExpect(scroll.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
}

async function expectElementBelowTopInset(elementTestID, rootTestID) {
  const root = await frameFor(rootTestID);
  const target = await frameFor(elementTestID);

  jestExpect(target.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
}

async function expectElementAboveBottomInset(elementTestID, rootTestID) {
  const root = await frameFor(rootTestID);
  const target = await frameFor(elementTestID);

  jestExpect(
    root.y + root.height - target.y - target.height,
  ).toBeGreaterThanOrEqual(MINIMUM_BOTTOM_SAFE_AREA_POINTS);
}

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

  it('keeps home content within the system insets and reaches trailing actions', async () => {
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

    const scroll = element(by.id('navigation-route-scroll'));
    await scroll.scrollTo('bottom', 0.5, 0.5);
    await expect(element(by.id('open-recording'))).toBeVisible();
    // AI cards and the existing app routes share this scroll; its tail holds the trailing actions.
    await expectElementAboveBottomInset(
      'open-recording',
      'navigation-keyboard-avoiding-root',
    );
    await element(by.id('open-common-observations')).tap();
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
    await element(by.id('navigation-route-scroll')).scrollTo(
      'bottom',
      0.5,
      0.5,
    );
    await waitFor(element(by.id('open-recording')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('open-recording')).tap();
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
    await expectScrollInsideRootFrame(
      'recording-controls-scroll',
      'navigation-keyboard-avoiding-root',
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
    await element(by.id('navigation-route-scroll')).scrollTo(
      'bottom',
      0.5,
      0.5,
    );
    await element(by.id('open-blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-title')))
      .toBeVisible()
      .withTimeout(30000);
    const lastReading = element(
      by.id('blood-pressure-reading-diastolic-11-card'),
    );
    await waitFor(lastReading).toExist().withTimeout(30000);

    await expect(element(by.id('navigation-route-scroll'))).not.toExist();
    await expectScrollInsideRootFrame(
      'blood-pressure-scroll',
      'navigation-keyboard-avoiding-root',
    );

    const bloodPressureScroll = element(by.id('blood-pressure-scroll'));
    // Start inside the scroll view so the overlaid recording action is not hit.
    await bloodPressureScroll.scrollTo('bottom', 0.5, 0.5);
    await expect(lastReading).toBeVisible();
    await expectElementAboveBottomInset(
      'blood-pressure-reading-diastolic-11-card',
      'navigation-keyboard-avoiding-root',
    );
    await bloodPressureScroll.scrollTo('top');

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
      .toHaveText('새로운 혈압 기록 변경이 없어요.')
      .withTimeout(30000);
  });
});
