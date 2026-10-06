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
    by.id('safe-area-keyboard-state'),
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

  it('keeps the welcome viewport inside the system insets and reaches trailing actions', async () => {
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await expectScrollInsideSafeRoot();

    const scroll = element(by.id('safe-area-scroll'));
    await scroll.scrollTo('bottom');
    await expect(element(by.id('open-recording'))).toBeVisible();
    await scroll.scrollTo('top');

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
    await expectScrollInsideSafeRoot();

    const input = element(by.id('safe-area-keyboard-input'));
    await input.tap();
    await expect(input).toBeFocused();
    await waitFor(element(by.label(/^keyboard-visible:/u)))
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
