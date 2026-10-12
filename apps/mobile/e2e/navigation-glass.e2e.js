/* global by, describe, device, element, expect, it, waitFor */

const {
  expectActionAboveRootTabSurface,
  expectActiveRouteSafeArea,
  expectRootTabContentLayout,
  expectRootTabScreenEdgeClearance,
} = require('./navigationGlassLayoutAssertions');
const {
  expectOnlyRootTabSelected,
  expectContextActionUnselected,
} = require('./navigationGlassAccessibilityAssertions');
const {
  expectNativeNavigationAction,
  openRootTab,
  scrollRouteToBottom,
  tapRapidNativeNavigationActions,
  tapNativeNavigationAction,
} = require('./smokeHelpers');

describe('native navigation glass', () => {
  // Diagnostics can cover controls, so leave them off; tap the visible roof instead of the hollow glyph center.
  it('visits every root tab, keeps Home clear, and opens Records from the tab bar', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });

    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    // Keep tab traversal in this registered Release case so shard accounting stays exact.
    const tabs = [
      ['home', 'welcome-title', '홈 탭'],
      ['records', 'records-title', '기록 탭'],
      // The retry marker covers the existing data-load error while the normal route is unavailable.
      ['schedule', ['calendar-title', 'schedule-retry'], '일정 탭'],
      ['ai', 'ai-features-screen', 'AI 탭'],
      ['settings', 'settings-title', '설정 탭'],
    ];
    for (const [tab, routeMarker, accessibilityLabel] of tabs) {
      await openRootTab(tab, routeMarker);
      const testID = `navigation-tab-${tab}`;
      const { hierarchyXml } = await expectNativeNavigationAction(testID);
      expectRootTabContentLayout(hierarchyXml, testID);
      expectOnlyRootTabSelected(hierarchyXml, tab);
      await expect(element(by.id(`navigation-tab-${tab}`))).toHaveLabel(
        accessibilityLabel,
      );
      await device.takeScreenshot(`selected-root-tab-${tab}`);
    }
    await tapRapidNativeNavigationActions([
      'navigation-tab-home',
      'navigation-tab-records',
      'navigation-tab-settings',
      'navigation-tab-home',
    ]);
    const { hierarchyXml: interruptedHierarchy } =
      await expectNativeNavigationAction('navigation-tab-home');
    expectOnlyRootTabSelected(interruptedHierarchy, 'home');
    await openRootTab('home', [
      'welcome-title',
      'home-empty-recordings',
      'home-recordings-retry',
    ]);
    const root = await element(
      by.id('navigation-keyboard-avoiding-root'),
    ).getAttributes();
    const recent = await element(by.id('home-open-records')).getAttributes();
    const toolbar = await element(
      by.id('navigation-native-toolbar'),
    ).getAttributes();
    if (!recent.frame || !toolbar.frame || !root.frame)
      throw new Error('Missing Home content or toolbar frame.');
    expectActionAboveRootTabSurface(recent.frame, toolbar.frame);
    expectRootTabScreenEdgeClearance(root.frame, toolbar.frame);
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
    // Home can show either an empty list or its existing load retry; both keep this UI check independent of data availability.
    await openRootTab('home', [
      'home-empty-recordings',
      'home-recordings-retry',
    ]);
    const { hierarchyXml } = await expectNativeNavigationAction(
      'navigation-tab-home',
    );
    expectRootTabContentLayout(hierarchyXml, 'navigation-tab-home');
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

  it('shows native actions and handles edge-back on an AI feature route', async () => {
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
    // Nested native stacks expose multiple shells; retain the matching shell's device-specific safe-area inset.
    const routeRootCandidates = routeRoots.frame
      ? [routeRoots]
      : (routeRoots.elements ?? []);
    const routeRoot = routeRootCandidates.find(({ frame }) => {
      const scrollFrame = routeScroll.frame;
      return (
        scrollFrame &&
        frame.x <= scrollFrame.x &&
        frame.y <= scrollFrame.y &&
        frame.x + frame.width >= scrollFrame.x + scrollFrame.width &&
        frame.y + frame.height >= scrollFrame.y + scrollFrame.height
      );
    });
    expectActiveRouteSafeArea(
      routeScroll.frame,
      titleFrame,
      routeRoot?.frame,
      routeRoot?.safeAreaInsets?.top,
    );
    // The shared backdrop must be an actual UIKit toolbar in the mounted app.
    await expect(element(by.id('navigation-native-toolbar'))).toExist();
    const { hierarchyXml: backHierarchy } =
      await expectNativeNavigationAction('navigation-back');
    expectContextActionUnselected(backHierarchy, 'navigation-back');
    await expect(element(by.id('navigation-back'))).toHaveLabel(
      '이전 화면으로 돌아가기',
    );
    const { hierarchyXml: homeHierarchy } =
      await expectNativeNavigationAction('navigation-home');
    expectContextActionUnselected(homeHierarchy, 'navigation-home');
    await expect(element(by.id('navigation-home'))).toHaveLabel(
      '홈 화면으로 이동',
    );
    // Capture the native buttons before verifying the Home action reaches the root route.
    await device.takeScreenshot('visit-questions-safe-area-native-glass');

    // Keep cancel and commit gestures on the same UIKit stack before checking Home navigation.
    const featureScroll = element(by.id('next-visit-questions-scroll'));
    await device.takeScreenshot('edge-back-before-cancelled-gesture');
    // A short leading-edge pan should finish below UIKit's commit distance.
    await featureScroll.swipe('right', 'slow', 0.08, 0.01, 0.5);
    await expect(featureScroll).toBeVisible();
    await device.takeScreenshot('edge-back-after-cancelled-gesture');

    // A fast, longer pan should let the native stack complete the pop.
    await featureScroll.swipe('right', 'fast', 0.85, 0.01, 0.5);
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await device.takeScreenshot('edge-back-after-completed-gesture');

    await scroll.scrollTo('top');
    await waitFor(featureAction)
      .toBeVisible()
      .whileElement(by.id('navigation-route-scroll'))
      .scroll(100, 'down', 0.5, 0.35);
    await featureAction.tap();
    await waitFor(element(by.id('next-visit-questions-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-home');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
  });
});
