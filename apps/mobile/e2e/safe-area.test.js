/* global afterEach, by, device, element, expect, waitFor */

// Detox reserves global expect() for UI elements, so frame numbers use Jest's matcher.
const { expect: jestExpect } = require('@jest/globals');

// The default Detox simulator has a notch and Home indicator; measurements are points.
const MINIMUM_TOP_SAFE_AREA_POINTS = 44;
const MINIMUM_BOTTOM_SAFE_AREA_POINTS = 20;
const MINIMUM_KEYBOARD_OCCLUSION_RATIO = 0.25;

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

function keyboardFrameFrom(attributes) {
  const label = attributes.label || attributes.text || '';
  const match = /^keyboard-visible:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(
    label,
  );
  if (!match) {
    throw new Error(
      `The native keyboard is not visible: ${label || 'no frame'}.`,
    );
  }

  return { screenY: Number(match[1]), height: Number(match[2]) };
}

async function expectKeyboardOccludesScroll(scrollFrame) {
  const attributes = await element(
    by.id('safe-area-keyboard-visible'),
  ).getAttributes();
  const { screenY, height } = keyboardFrameFrom(attributes);
  const scrollBottom = scrollFrame.y + scrollFrame.height;
  const keyboardBottom = screenY + height;
  const visibleScrollHeight = Math.max(
    0,
    Math.min(scrollBottom, screenY) - scrollFrame.y,
  );
  const occludedScrollHeight = Math.max(
    0,
    Math.min(scrollBottom, keyboardBottom) - Math.max(scrollFrame.y, screenY),
  );

  // Keyboard and Detox frames are both in screen points; read after each scroll/tap to catch dismissal.
  jestExpect(height).toBeGreaterThan(0);
  jestExpect(visibleScrollHeight).toBeGreaterThan(0);
  jestExpect(occludedScrollHeight).toBeGreaterThanOrEqual(
    scrollFrame.height * MINIMUM_KEYBOARD_OCCLUSION_RATIO,
  );
}

async function expectScrollInsideSafeRoot(
  scrollTestID = 'safe-area-scroll',
  rootTestID = 'navigation-keyboard-avoiding-root',
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
    await expectRouteScrollTopInset(
      'navigation-route-scroll',
      'navigation-keyboard-avoiding-root',
    );

    const scroll = element(by.id('navigation-route-scroll'));
    await scroll.scrollTo('bottom');
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
    await commonObservationsScroll.scrollTo('bottom');
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
    await element(by.id('navigation-route-scroll')).scrollTo('bottom');
    await waitFor(element(by.id('open-recording')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('open-recording')).tap();
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);

    await expect(element(by.id('navigation-route-scroll'))).not.toExist();
    await expect(element(by.id('recording-start'))).toBeVisible();
    await expectScrollInsideSafeRoot(
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
    await element(by.id('navigation-route-scroll')).scrollTo('bottom');
    await element(by.id('open-blood-pressure-import')).tap();
    await waitFor(element(by.id('blood-pressure-title')))
      .toBeVisible()
      .withTimeout(30000);
    await waitFor(element(by.id('blood-pressure-reading-systolic-11-card')))
      .toExist()
      .withTimeout(30000);

    await expect(element(by.id('navigation-route-scroll'))).not.toExist();
    await expectScrollInsideSafeRoot('blood-pressure-scroll');

    const bloodPressureScroll = element(by.id('blood-pressure-scroll'));
    await bloodPressureScroll.scrollTo('bottom');
    await expect(
      element(by.id('blood-pressure-reading-systolic-11-card')),
    ).toBeVisible();
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
    await expectScrollInsideSafeRoot('safe-area-scroll', 'safe-area-root');

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
