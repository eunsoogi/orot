/* global beforeAll, by, describe, device, element, expect, it, waitFor */

const { expect: jestExpect } = require('@jest/globals');

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

  // iOS 27 hides visible toolbar buttons in XCUI attributes; verify UIKit visibility and the mounted toolbar.
  if (
    !actionVisibleInHierarchy ||
    !toolbarAttributes.visible ||
    !toolbarAttributes.hittable ||
    !frame ||
    frame.width < 44 ||
    frame.height < 44 ||
    !toolbarFrame
  ) {
    throw new Error(
      `Native navigation action ${testID} must be visible in UIKit, inside a visible and hittable toolbar, and at least 44 points in both dimensions: ${JSON.stringify({ attributes, toolbarAttributes, actionNode })}`,
    );
  }

  // Detox misreports the child activation point, so tap its measured center through the native toolbar.
  await toolbar.tap({
    x: frame.x + frame.width / 2 - toolbarFrame.x,
    y: frame.y + frame.height / 2 - toolbarFrame.y,
  });
}

describe('AI visit questions through the app navigation', () => {
  beforeAll(async () => {
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_E2E_PROBE: 'ai-feature-visit-questions' },
      languageAndLocale: { language: 'en', locale: 'en_US' },
    });
  });

  it('keeps the fixed save action reachable while editing with the keyboard open', async () => {
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('ai-feature-visit-questions')).tap();
    // Check the visible content and controls; the enclosing keyboard-avoiding view is structural.
    await waitFor(element(by.id('next-visit-questions-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    const backAction = element(by.id('navigation-back'));
    await expect(backAction).toHaveLabel('이전 화면으로 돌아가기');
    const backFrame = (await backAction.getAttributes()).frame;
    if (!backFrame || backFrame.width <= 0 || backFrame.height <= 0) {
      throw new Error('The native Back action has no visible frame.');
    }
    await expect(element(by.id('next-visit-questions-back'))).not.toExist();
    await waitFor(element(by.id('next-visit-appointment-time')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('합성 UI 검사 제공자'))).toBeVisible();

    await expect(element(by.id('next-visit-generate'))).toBeVisible();
    await element(by.id('next-visit-generate')).tap();
    // The save button confirms the review UI; its enclosing view is layout-only.
    await waitFor(element(by.id('next-visit-review-save')))
      .toBeVisible()
      .withTimeout(30000);
    const scroll = element(by.id('next-visit-questions-scroll'));
    await scroll.scrollTo('bottom');
    const questionInput = element(by.id('next-visit-question-text-2'));
    await questionInput.tap();
    await expect(questionInput).toBeFocused();
    await waitFor(element(by.id('ai-feature-visit-questions-keyboard-visible')))
      .toExist()
      .withTimeout(30000);

    const keyboardAttributes = await element(
      by.id('ai-feature-visit-questions-keyboard-visible'),
    ).getAttributes();
    const keyboardLabel =
      keyboardAttributes.label || keyboardAttributes.text || '';
    const keyboardMatch =
      /^keyboard-visible:(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u.exec(keyboardLabel);
    if (!keyboardMatch) {
      throw new Error('The iOS keyboard did not provide a visible frame.');
    }

    const saveAction = element(by.id('next-visit-review-save'));
    await expect(saveAction).toBeVisible();
    const saveFrame = (await saveAction.getAttributes()).frame;
    if (!saveFrame) {
      throw new Error(
        'Detox did not return a frame for the fixed save action.',
      );
    }
    // Compare the native keyboard top and action frame in iOS screen coordinates.
    jestExpect(Number(keyboardMatch[2])).toBeGreaterThan(0);
    jestExpect(saveFrame.y + saveFrame.height).toBeLessThanOrEqual(
      Number(keyboardMatch[1]),
    );
    // Keep visual evidence of the fixed action above the actual on-screen keyboard.
    await device.takeScreenshot('visit-questions-keyboard-save-action');
    await saveAction.tap();
    await waitFor(element(by.id('next-visit-save-message')))
      .toHaveText('검토한 질문을 이 예약에 저장했어요.')
      .withTimeout(30000);
    await device.takeScreenshot('visit-questions-after-save');
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);
  });
});
