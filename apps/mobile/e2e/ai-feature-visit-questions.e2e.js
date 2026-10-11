/* global beforeAll, by, describe, device, element, expect, it, waitFor */

const { expect: jestExpect } = require('@jest/globals');
const {
  openRootTab,
  expectNativeNavigationAction,
  tapNativeNavigationAction,
} = require('./smokeHelpers');

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
    await openRootTab('ai', 'ai-features-screen');
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
    await expect(element(by.id('next-visit-provider-select'))).toHaveLabel(
      'AI 선택 또는 변경, 합성 UI 검사 제공자',
    );

    await expectNativeNavigationAction('next-visit-generate');
    await tapNativeNavigationAction('next-visit-generate');
    // The save button confirms the review UI; its enclosing view is layout-only.
    await waitFor(element(by.id('next-visit-review-save')))
      .toExist()
      .withTimeout(30000);
    const scroll = element(by.id('next-visit-questions-scroll'));
    await scroll.scrollTo('bottom', 0.5, 0.2);
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
    await expectNativeNavigationAction('next-visit-review-save');
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
    await tapNativeNavigationAction('next-visit-review-save');
    await waitFor(element(by.id('next-visit-save-message')))
      .toHaveText('검토한 질문을 이 예약에 저장했어요.')
      .withTimeout(30000);
    await device.takeScreenshot('visit-questions-after-save');
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);
  });
});
