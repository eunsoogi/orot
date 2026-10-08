/* global by, device, element, waitFor, describe, it, expect */

describe('synthetic next-visit questions screen', () => {
  it('reviews evidence-backed candidates and keeps the saved list after a canceled edit', async () => {
    await device.launchApp({ newInstance: true });
    const scroll = element(by.id('next-visit-questions-scroll'));
    // Center-origin gestures stay usable when the keyboard or CI warning overlay covers
    // Detox's default starting point.
    const scrollToEdge = edge => scroll.scrollTo(edge, 0.5, 0.5);
    const scrollContent = (pixels, direction) =>
      scroll.scroll(pixels, direction, 0.5, 0.5);
    await expect(element(by.id('next-visit-probe-boundary'))).toHaveText(
      '합성 화면 흐름 · 실제 AI 제공자와 영구 저장소는 검증하지 않음',
    );
    await expect(element(by.text('합성 진료 예약'))).toBeVisible();
    await element(by.id('next-visit-generate')).tap();
    await expect(element(by.id('next-visit-generation-loading'))).toBeVisible();
    await element(by.id('next-visit-probe-complete-generation')).tap();
    // The list can exceed the viewport, so wait on its visible heading.
    await waitFor(element(by.text('추천 질문 검토')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(
      element(by.id('next-visit-caveat-conflicting_records')),
    ).toBeVisible();

    await scrollToEdge('top');
    // The citation sits far below the viewport, so two scrolls reveal its whole card.
    await scrollContent(320, 'down');
    await scrollContent(320, 'down');
    await element(by.id('next-visit-source-0-0')).tap();
    await expect(element(by.id('next-visit-source-content'))).toHaveText(
      '합성 기록에서 가져온 예시 문장입니다.',
    );
    await element(by.id('next-visit-source-close')).tap();

    await scrollToEdge('top');
    await scrollContent(320, 'down');
    await element(by.id('next-visit-question-text-0')).replaceText(
      '검토해 수정한 합성 질문',
    );
    await scrollToEdge('bottom');
    await element(by.id('next-visit-review-save')).tap();
    await waitFor(element(by.id('next-visit-save-message')))
      .toHaveText('검토한 질문을 이 예약에 저장했어요.')
      .withTimeout(30000);
    await scrollToEdge('bottom');
    await scrollContent(240, 'up');
    await expect(element(by.id('next-visit-saved-list'))).toBeVisible();
    await expect(element(by.text('검토해 수정한 합성 질문'))).toBeVisible();
    await expect(
      element(by.id('next-visit-caveat-conflicting_records')),
    ).toBeVisible();

    await element(by.id('next-visit-saved-edit')).tap();
    await scrollToEdge('top');
    await scrollContent(320, 'down');
    await element(by.id('next-visit-question-text-0')).replaceText(
      '저장되지 않은 임시 수정',
    );
    await scrollToEdge('bottom');
    await element(by.id('next-visit-review-cancel')).tap();
    await scrollToEdge('bottom');
    await expect(element(by.id('next-visit-saved-list'))).toBeVisible();
    await expect(element(by.text('검토해 수정한 합성 질문'))).toBeVisible();
    await expect(element(by.text('저장되지 않은 임시 수정'))).not.toExist();

    await element(by.id('next-visit-probe-reload-screen')).tap();
    await scrollToEdge('bottom');
    await scrollContent(240, 'up');
    await expect(element(by.id('next-visit-saved-list'))).toBeVisible();
    await expect(
      element(by.id('next-visit-caveat-conflicting_records')),
    ).toBeVisible();
    await expect(element(by.text('검토해 수정한 합성 질문'))).toBeVisible();
  });
});
