/* global afterEach, by, device, element, expect, waitFor */

// Detox reserves global expect() for UI elements, so frame numbers use Jest's matcher.
const { expect: jestExpect } = require('@jest/globals');

// The default Detox simulator has a notch and Home indicator; measurements are points.
const MINIMUM_TOP_SAFE_AREA_POINTS = 44;
const MINIMUM_BOTTOM_SAFE_AREA_POINTS = 20;

async function frameFor(testID) {
  const attributes = await element(by.id(testID)).getAttributes();
  if (!attributes.frame) {
    throw new Error(`Detox did not return a frame for ${testID}.`);
  }
  return attributes.frame;
}

async function expectScrollInsideSafeRoot() {
  const root = await frameFor('safe-area-root');
  const scroll = await frameFor('safe-area-scroll');

  // Require meaningful edge clearance so a 1-point padding regression fails.
  jestExpect(scroll.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
  jestExpect(
    root.y + root.height - scroll.y - scroll.height,
  ).toBeGreaterThanOrEqual(MINIMUM_BOTTOM_SAFE_AREA_POINTS);
}

describe('safe area routes on iOS Simulator', () => {
  beforeEach(async () => {
    await device.setOrientation('portrait');
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  afterEach(async () => {
    await device.setOrientation('portrait');
  });

  it('keeps the welcome viewport inside the system insets and reaches trailing actions', async () => {
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await expectScrollInsideSafeRoot();

    const scroll = element(by.id('safe-area-scroll'));
    await scroll.scrollTo('bottom');
    await expect(element(by.id('open-recording'))).toBeVisible();
    await scroll.scrollTo('top');

    // Landscape reduces the available height while retaining this route's overflow.
    await device.setOrientation('landscape');
    await element(by.id('safe-area-scroll')).scrollTo('bottom');
    await expect(element(by.id('open-recording'))).toBeVisible();
    await device.setOrientation('portrait');

    await element(by.id('open-common-observations')).tap();
    await waitFor(element(by.id('common-observations-import')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('safe-area-scroll')).scrollTo('bottom');
    await expect(element(by.id('common-observations-import'))).toBeVisible();
  });

  it('preserves the recording screen inset root and existing inner scrolling', async () => {
    await waitFor(element(by.id('open-recording')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('open-recording')).tap();
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);

    await expect(element(by.id('safe-area-root'))).toBeVisible();
    await expect(element(by.id('safe-area-scroll'))).not.toExist();
    await expect(element(by.id('recording-start'))).toBeVisible();
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
      .toHaveLabel('large-text-enabled')
      .withTimeout(30000);
    await device.setOrientation('landscape');

    const input = element(by.id('safe-area-keyboard-input'));
    await input.tap();
    await expect(input).toBeFocused();
    await element(by.id('safe-area-scroll')).scrollTo('bottom');
    await expect(element(by.id('safe-area-keyboard-action'))).toBeVisible();
    await element(by.id('safe-area-keyboard-action')).tap();
    await expect(
      element(by.id('safe-area-keyboard-action-done')),
    ).toBeVisible();
  });
});
