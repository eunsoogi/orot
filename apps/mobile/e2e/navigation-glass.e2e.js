/* global by, describe, device, element, expect, it, waitFor */

const { expect: jestExpect } = require('@jest/globals');
const { openRootTab } = require('./smokeHelpers');

async function scrollRouteToBottom() {
  // Scroll the route viewport independently of its fixed bottom action bar.
  await element(by.id('navigation-route-scroll')).scrollTo('bottom', 0.5, 0.5);
}

async function tapNativeNavigationAction(testID) {
  const action = element(by.id(testID));
  const toolbar = element(by.id('navigation-native-toolbar'));
  const attributes = await action.getAttributes();
  const toolbarAttributes = await toolbar.getAttributes();
  const hierarchyXml = await device.generateViewHierarchyXml(true);
  const frame = attributes.frame;
  const toolbarFrame = toolbarAttributes.frame;
  const actionNode = hierarchyXml
    .split('\n')
    .find(line => line.includes(`id="${testID}"`));
  const actionVisibleInHierarchy = actionNode?.includes('visibility="visible"');

  // iOS 27 marks these visible toolbar child buttons hidden in XCUI attributes; verify the actual UIKit node, frame, and toolbar instead.
  if (
    !actionVisibleInHierarchy ||
    !toolbarAttributes.visible ||
    !toolbarAttributes.hittable ||
    !frame ||
    frame.width + 0.001 < 44 ||
    frame.height + 0.001 < 44 ||
    !toolbarFrame
  ) {
    throw new Error(
      `Native navigation action ${testID} must be visible in UIKit, inside a visible and hittable toolbar, and at least 44 points in both dimensions: ${JSON.stringify({ attributes, toolbarAttributes, actionNode })}`,
    );
  }

  // Tap the action's measured center through its visible toolbar because XCUI misreports the child activation point.
  await toolbar.tap({
    x: frame.x + frame.width / 2 - toolbarFrame.x,
    y: frame.y + frame.height / 2 - toolbarFrame.y,
  });
}

describe('native navigation glass', () => {
  // Diagnostics can cover controls, so leave them off; tap the visible roof instead of the hollow glyph center.
  it('keeps Home content clear of native controls and opens Records from the tab bar', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });

    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    const root = await element(
      by.id('navigation-keyboard-avoiding-root'),
    ).getAttributes();
    const recent = await element(by.id('home-open-records')).getAttributes();
    const toolbar = await element(
      by.id('navigation-native-toolbar'),
    ).getAttributes();
    if (!recent.frame || !toolbar.frame || !root.frame)
      throw new Error('Missing Home content or toolbar frame.');
    jestExpect(recent.frame.y + recent.frame.height).toBeLessThanOrEqual(
      toolbar.frame.y,
    );
    // The iPhone simulator's 34pt home area is the only space below the toolbar.
    jestExpect(
      root.frame.y + root.frame.height - toolbar.frame.y - toolbar.frame.height,
    ).toBeLessThanOrEqual(34);
    await device.takeScreenshot('home-native-glass');
    await openRootTab('records', 'records-title');
    await expect(element(by.id('records-new-recording'))).toBeVisible();
    await device.takeScreenshot('records-native-glass-tab');
    await element(by.id('records-new-recording')).tap();
    await waitFor(element(by.id('recording-controls-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('navigation-home'))).toHaveLabel(
      '홈 화면으로 이동',
    );
    await tapNativeNavigationAction('navigation-home');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await device.takeScreenshot('home-after-native-home-action');
  });

  it('keeps root tabs and recording actions reachable with XXXL text', async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: {
        UIPreferredContentSizeCategoryName:
          'UICTContentSizeCategoryAccessibilityXXXL',
      },
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });

    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    // Large text creates real overflow; verify scrolling here rather than assuming it at normal size.
    await scrollRouteToBottom();
    await expect(element(by.id('home-empty-recordings'))).toBeVisible();
    await device.takeScreenshot('home-xxxl-native-glass-tabs');
    await openRootTab('records', 'records-title');
    await expect(element(by.id('records-new-recording'))).toBeVisible();
    await element(by.id('records-new-recording')).tap();

    await waitFor(element(by.id('recording-controls-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    // Start the long-text swipe inside the visible scroll viewport, above the floating glass toolbar.
    await element(by.id('recording-controls-scroll')).scrollTo(
      'bottom',
      0.5,
      0.5,
    );
    await waitFor(element(by.id('recording-start')))
      .toBeVisible()
      .withTimeout(30000);
    await device.takeScreenshot('recording-xxxl-native-navigation');
    await tapNativeNavigationAction('navigation-home');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
  });

  it('shows native back and Home glass actions on a feature route opened from AI', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });

    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await openRootTab('ai', 'ai-features-screen');
    const scroll = element(by.id('ai-features-screen'));
    const featureAction = element(by.id('ai-feature-visit-questions'));
    await scroll.scrollTo('top');
    // The AI row position depends on available vertical space and text sizing.
    await waitFor(featureAction)
      .toBeVisible()
      .whileElement(by.id('navigation-route-scroll'))
      .scroll(100, 'down', 0.5, 0.35);
    await featureAction.tap();

    await waitFor(element(by.id('next-visit-questions-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    const routeRoot = await element(
      by.id('navigation-keyboard-avoiding-root'),
    ).getAttributes();
    const routeScroll = await element(
      by.id('next-visit-questions-scroll'),
    ).getAttributes();
    const routeTitle = await element(by.text('다음 진료 질문')).getAttributes();
    for (const [description, attributes] of [
      ['feature scroll', routeScroll],
      ['feature title', routeTitle],
    ]) {
      if (!attributes.frame || !routeRoot.frame) {
        throw new Error(`Missing safe-area frame for ${description}.`);
      }
      jestExpect(attributes.frame.y - routeRoot.frame.y).toBeGreaterThanOrEqual(
        44,
      );
    }
    // The shared backdrop must be an actual UIKit toolbar in the mounted app.
    await expect(element(by.id('navigation-native-toolbar'))).toExist();
    await expect(element(by.id('navigation-back'))).toHaveLabel(
      '이전 화면으로 돌아가기',
    );
    await expect(element(by.id('navigation-home'))).toHaveLabel(
      '홈 화면으로 이동',
    );
    // Capture the native buttons before verifying the Home action reaches the root route.
    await device.takeScreenshot('visit-questions-safe-area-native-glass');
    await tapNativeNavigationAction('navigation-home');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
  });
});
