/* global by, describe, device, element, expect, it, waitFor */

const { expect: jestExpect } = require('@jest/globals');
const { openRootTab, tapNativeNavigationAction } = require('./smokeHelpers');

async function scrollRouteToBottom() {
  // Scroll the route viewport independently of its fixed bottom action bar.
  await element(by.id('navigation-route-scroll')).scrollTo('bottom', 0.5, 0.5);
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
    const routeRoots = await element(
      by.id('navigation-keyboard-avoiding-root'),
    ).getAttributes();
    const routeScroll = await element(
      by.id('next-visit-questions-scroll'),
    ).getAttributes();
    const routeTitle = await element(by.id('next-visit-title')).getAttributes();
    const titleFrame =
      routeTitle.frame ??
      routeTitle.elements?.find(item => item.identifier === 'next-visit-title')
        ?.frame;
    // Nested native stacks can expose one shell frame per mounted scene; use the one containing this route's scroll view.
    const routeRootFrames = routeRoots.frame
      ? [routeRoots.frame]
      : (routeRoots.elements ?? []).flatMap(item =>
          item.frame ? [item.frame] : [],
        );
    const routeRootFrame = routeRootFrames.find(frame => {
      const scrollFrame = routeScroll.frame;
      return (
        scrollFrame &&
        frame.x <= scrollFrame.x &&
        frame.y <= scrollFrame.y &&
        frame.x + frame.width >= scrollFrame.x + scrollFrame.width &&
        frame.y + frame.height >= scrollFrame.y + scrollFrame.height
      );
    });
    if (!routeScroll.frame || !titleFrame || !routeRootFrame) {
      throw new Error(
        'Missing active route frames for safe-area verification.',
      );
    }
    for (const frame of [routeScroll.frame, titleFrame]) {
      jestExpect(frame.y - routeRootFrame.y).toBeGreaterThanOrEqual(44);
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

  it('cancels and completes the native edge-back gesture on the active route', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await openRootTab('ai', 'ai-features-screen');

    const aiScreen = element(by.id('ai-features-screen'));
    const featureAction = element(by.id('ai-feature-visit-questions'));
    await aiScreen.scrollTo('top');
    await waitFor(featureAction)
      .toBeVisible()
      .whileElement(by.id('navigation-route-scroll'))
      .scroll(100, 'down', 0.5, 0.35);
    await featureAction.tap();

    const featureScroll = element(by.id('next-visit-questions-scroll'));
    await waitFor(featureScroll).toBeVisible().withTimeout(30000);
    await device.takeScreenshot('edge-back-before-cancelled-gesture');
    // UIKit should keep the route when a leading-edge pan ends before its commit distance.
    await featureScroll.swipe('right', 'slow', 0.08, 0.01, 0.5);
    await expect(featureScroll).toBeVisible();
    await device.takeScreenshot('edge-back-after-cancelled-gesture');

    await featureScroll.swipe('right', 'fast', 0.85, 0.01, 0.5);
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await device.takeScreenshot('edge-back-after-completed-gesture');
  });
});
