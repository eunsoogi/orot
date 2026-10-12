/* global by, device, element, expect, waitFor */
const { expect: jestExpect } = require('@jest/globals');
const {
  expectNativeNavigationAction,
  openRootTab,
  tapNativeNavigationAction,
} = require('./smokeHelpers');

/** The persistent indicator must finish centered on the actual selected native target. Video proves its path. */
async function expectRootIndicatorAt(testID) {
  const { frame } = await expectNativeNavigationAction(testID);
  const attributes = await element(
    by.id('navigation-root-selection-indicator'),
  ).getAttributes();
  const candidates = attributes.elements ?? [attributes];
  const indicator = candidates.find(
    item =>
      item.visible &&
      item.frame &&
      Math.abs(
        item.frame.x + item.frame.width / 2 - frame.x - frame.width / 2,
      ) < 1 &&
      Math.abs(
        item.frame.y + item.frame.height / 2 - frame.y - frame.height / 2,
      ) < 1,
  );
  if (!indicator) {
    throw new Error(
      `Root indicator must align with ${testID}: ${JSON.stringify({ frame, attributes })}`,
    );
  }
  jestExpect(indicator?.frame.width).toBeGreaterThan(40);
  jestExpect(indicator?.frame.height).toBeGreaterThanOrEqual(48);
}

/** Exercises the shipping conversation composer without sending any health text or provider request. */
async function exerciseKeyboardNavigation() {
  await openRootTab('ai', 'ai-features-screen');
  const feature = element(by.id('ai-feature-rag-conversation'));
  await element(by.id('ai-features-screen')).scrollTo('top');
  await waitFor(feature)
    .toBeVisible()
    .whileElement(by.id('navigation-route-scroll'))
    .scroll(100, 'down', 0.5, 0.35);
  await feature.tap();
  const input = element(by.id('rag-conversation-input'));
  await waitFor(input).toBeVisible().withTimeout(30000);
  await input.tap();
  await input.typeText('Navigation keyboard check');
  // iOS 27 renders keyboard keys in a remote view, while earlier runtimes expose the local layout.
  const hierarchy = await device.generateViewHierarchyXml(true);
  const keyboardType = hierarchy.includes('class="UIKeyboardItemContainerView"')
    ? 'UIKeyboardItemContainerView'
    : 'UIKeyboardLayoutStar';
  const keyboardElement = element(by.type(keyboardType));
  await expect(keyboardElement).toBeVisible();
  const keyboard = await keyboardElement.getAttributes();
  jestExpect(keyboard.frame?.height).toBeGreaterThan(100);
  for (const testID of ['navigation-back', 'navigation-home']) {
    const { frame } = await expectNativeNavigationAction(testID);
    jestExpect(frame.y + frame.height).toBeLessThanOrEqual(
      keyboard.frame.y + 1,
    );
  }
  await device.takeScreenshot('conversation-keyboard-native-navigation');
  await input.clearText();
  await tapNativeNavigationAction('navigation-home');
  await waitFor(element(by.id('welcome-title')))
    .toBeVisible()
    .withTimeout(30000);
  await expect(keyboardElement).not.toBeVisible();
  await expectRootIndicatorAt('navigation-tab-home');
  await device.takeScreenshot('home-after-keyboard-navigation');
}

module.exports = { expectRootIndicatorAt, exerciseKeyboardNavigation };
