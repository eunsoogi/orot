/* global by, device, element, expect, waitFor, describe, it, beforeAll */

describe('evidence-linked visit-question flow with synthetic-only inputs', () => {
  beforeAll(async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
  });

  it('stops after declined remote consent and presents cited questions for review', async () => {
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_VISIT_QUESTIONS_PROBE: 'synthetic' },
    });

    await element(by.id('visit-question-probe-decline-consent')).tap();
    await waitFor(element(by.id('visit-question-probe-consent-result')))
      .toHaveText('외부 전송 동의 거절 · provider sends: 0')
      .withTimeout(30000);

    await element(by.id('visit-question-probe-prepare')).tap();
    await waitFor(element(by.id('visit-question-review-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('visit-question-probe-metrics'))).toHaveText(
      'synthetic=true · provider calls=3 · evidence references=2 · raw IDs exposed=false',
    );

    await element(by.id('visit-question-probe-scroll')).scrollTo('bottom');
    // Each synthetic question cites the same span; index 2 targets question 3.
    const thirdQuestionEvidence = element(
      by
        .text('이 프로브에만 쓰는 합성 검사 기록입니다.')
        .withAncestor(by.id('visit-question-review-screen')),
    ).atIndex(2);
    await expect(thirdQuestionEvidence).toBeVisible();

    const thirdQuestionPriority = element(
      by
        .id('visit-question-priority-2')
        .withDescendant(by.text('중요 질문 · 우선순위 변경')),
    );
    await element(by.id('visit-question-priority-2')).tap();
    await expect(thirdQuestionPriority).toBeVisible();
  }, 240000);
});
