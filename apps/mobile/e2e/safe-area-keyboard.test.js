/* global afterEach, by, device, element, expect, it, waitFor */

// Detox reserves global expect() for UI elements, so frame numbers use Jest's matcher.
const { expect: jestExpect } = require('@jest/globals');

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

  // Keyboard and Detox frames use screen points; reread after scrolling and tapping.
  jestExpect(height).toBeGreaterThan(0);
  jestExpect(visibleScrollHeight).toBeGreaterThan(0);
  jestExpect(occludedScrollHeight).toBeGreaterThanOrEqual(
    scrollFrame.height * MINIMUM_KEYBOARD_OCCLUSION_RATIO,
  );
}

async function expectScrollInsideRootFrame() {
  const root = await frameFor('safe-area-root');
  const scroll = await frameFor('safe-area-scroll');

  jestExpect(scroll.y - root.y).toBeGreaterThanOrEqual(
    MINIMUM_TOP_SAFE_AREA_POINTS,
  );
  jestExpect(
    root.y + root.height - scroll.y - scroll.height,
  ).toBeGreaterThanOrEqual(MINIMUM_BOTTOM_SAFE_AREA_POINTS);
}

describe('large text and keyboard safe area on iOS Simulator', () => {
  afterEach(async () => {
    await device.setOrientation('portrait');
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
    // Detox applies orientation through the active app session, so launch first.
    await device.setOrientation('portrait');

    await waitFor(element(by.id('safe-area-large-text-state')))
      .toHaveLabel('큰 글자 사용 중')
      .withTimeout(30000);
    await expectScrollInsideRootFrame();

    const input = element(by.id('safe-area-keyboard-input'));
    await expect(input).toHaveLabel('메모 입력');
    await input.tap();
    await expect(input).toBeFocused();
    await waitFor(element(by.id('safe-area-keyboard-visible')))
      .toExist()
      .withTimeout(30000);

    const scrollFrame = await frameFor('safe-area-scroll');
    await expectKeyboardOccludesScroll(scrollFrame);

    const keyboardAction = element(by.id('safe-area-keyboard-action'));
    await expect(keyboardAction).toHaveLabel('계속');
    await expect(element(by.text('Continue'))).not.toExist();
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
