/* global by, device, element, waitFor, describe, it, expect */
const { expect: jestExpect } = require('@jest/globals');
const { execFileSync } = require('node:child_process');
const { expectContentAboveFloatingBar } = require('./safeAreaHelpers');
const dismissProbeDebugToast = require('./nextVisitProbeDiagnostics');
const {
  expectNativeNavigationAction,
  tapNativeNavigationAction,
} = require('./smokeHelpers');

describe('synthetic next-visit questions screen', () => {
  it('reviews evidence-backed candidates and keeps the saved list after a canceled edit', async () => {
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
    await device.launchApp({ newInstance: true });
    const scroll = element(by.id('next-visit-questions-scroll'));
    // Keep edge gestures in the scroll content, away from the system edge and text fields.
    const scrollToEdge = edge => scroll.scrollTo(edge, 0.5, 0.2);
    // Scroll from above the keyboard until the target is visible; card heights vary.
    const scrollUntilVisible = (target, direction) =>
      waitFor(target)
        .toBeVisible()
        .whileElement(by.id('next-visit-questions-scroll'))
        .scroll(50, direction, 0.5, 0.2);
    await expect(element(by.id('next-visit-probe-boundary'))).toHaveText(
      '합성 화면 흐름 · 실제 AI 제공자와 영구 저장소는 검증하지 않음',
    );
    await element(by.id('next-visit-probe-close-tools')).tap();
    await dismissProbeDebugToast();
    const initialViewport = (await scroll.getAttributes()).frame;
    if (!initialViewport)
      throw new Error('Missing initial native viewport frame.');
    await expect(element(by.text('합성 진료 예약'))).toBeVisible();
    await tapNativeNavigationAction('next-visit-generate');
    await expect(element(by.id('next-visit-generation-loading'))).toBeVisible();
    await element(by.id('next-visit-probe-tools')).tap();
    await element(by.id('next-visit-probe-complete-generation')).tap();
    // The list can exceed the viewport, so wait on its visible heading.
    await waitFor(element(by.id('next-visit-title')))
      .toBeVisible()
      .withTimeout(30000);
    await scrollUntilVisible(
      element(by.id('next-visit-caveat-conflicting_records')),
      'down',
    );
    await expect(
      element(by.id('next-visit-caveat-conflicting_records')),
    ).toBeVisible();
    await scrollToEdge('top');
    await device.takeScreenshot('edit-questions-light');

    await scrollToEdge('top');
    await scrollUntilVisible(element(by.id('next-visit-source-0-0')), 'down');
    await element(by.id('next-visit-source-0-0')).tap();
    await expect(element(by.id('next-visit-source-content'))).toHaveText(
      '합성 기록에서 가져온 예시 문장입니다.',
    );
    await element(by.id('next-visit-source-close')).tap();

    await scrollToEdge('top');
    await scrollUntilVisible(
      element(by.id('next-visit-question-text-0')),
      'down',
    );
    await element(by.id('next-visit-question-text-0')).replaceText(
      '검토해 수정한 합성 질문',
    );
    // The fixed review footer must stay tappable without scrolling the edited list.
    await expectNativeNavigationAction('next-visit-review-save');
    await tapNativeNavigationAction('next-visit-review-save');
    await waitFor(element(by.id('next-visit-save-message')))
      .toHaveText('검토한 질문을 이 예약에 저장했어요.')
      .withTimeout(30000);
    // Saving or canceling restores the appointment/provider sections above the saved list.
    await scrollToEdge('top');
    await scrollUntilVisible(
      element(by.text('검토해 수정한 합성 질문')),
      'down',
    );
    // The saved section can exceed one viewport; visible question and caveat are checked separately.
    await expect(element(by.id('next-visit-saved-list'))).toExist();
    await expect(element(by.text('검토해 수정한 합성 질문'))).toBeVisible();
    await scrollUntilVisible(
      element(by.id('next-visit-caveat-conflicting_records')),
      'down',
    );
    await expect(
      element(by.id('next-visit-caveat-conflicting_records')),
    ).toBeVisible();

    // Editing stays in the production native toolbar regardless of the list's offset.
    await expectNativeNavigationAction('next-visit-saved-edit');
    await scrollToEdge('top');
    await device.takeScreenshot('saved-questions-light');
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'dark']);
    await expect(element(by.id('next-visit-title'))).toBeVisible();
    await device.takeScreenshot('saved-questions-dark');
    await tapNativeNavigationAction('next-visit-saved-edit');
    await scrollToEdge('top');
    await device.takeScreenshot('edit-questions-dark');
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
    await scrollToEdge('top');
    await scrollUntilVisible(
      element(by.id('next-visit-question-text-0')),
      'down',
    );
    await element(by.id('next-visit-question-text-0')).replaceText(
      '저장되지 않은 임시 수정',
    );
    // The secondary cancel action follows the draft; dismiss the keyboard through the real scroll gesture.
    await scrollUntilVisible(
      element(by.id('next-visit-review-cancel')),
      'down',
    );
    // Keyboard dismissal resizes the viewport; settle at the list end before checking the secondary action.
    await scrollToEdge('bottom');
    await expectContentAboveFloatingBar(
      'next-visit-questions-scroll',
      'next-visit-review-cancel',
    );
    await expect(element(by.id('next-visit-review-cancel'))).toBeVisible();
    await element(by.id('next-visit-review-cancel')).tap();
    // Saving or canceling restores the appointment/provider sections above the saved list.
    await scrollToEdge('top');
    await scrollUntilVisible(
      element(by.text('검토해 수정한 합성 질문')),
      'down',
    );
    await expect(element(by.id('next-visit-saved-list'))).toExist();
    await expect(element(by.text('검토해 수정한 합성 질문'))).toBeVisible();
    await expect(element(by.text('저장되지 않은 임시 수정'))).not.toExist();
    const restoredViewport = (await scroll.getAttributes()).frame;
    if (!restoredViewport)
      throw new Error('Missing restored native viewport frame.');
    jestExpect(restoredViewport.height).toBeCloseTo(initialViewport.height, 0);
    await scrollToEdge('bottom');
    await device.takeScreenshot('saved-questions-bottom-clear');

    await element(by.id('next-visit-probe-tools')).tap();
    await element(by.id('next-visit-probe-reload-screen')).tap();
    await scrollUntilVisible(
      element(by.text('검토해 수정한 합성 질문')),
      'down',
    );
    await expect(element(by.id('next-visit-saved-list'))).toExist();
    await expect(element(by.text('검토해 수정한 합성 질문'))).toBeVisible();
    await scrollUntilVisible(
      element(by.id('next-visit-caveat-conflicting_records')),
      'down',
    );
    await expect(
      element(by.id('next-visit-caveat-conflicting_records')),
    ).toBeVisible();
  });
});
