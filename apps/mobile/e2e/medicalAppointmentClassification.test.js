/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('issue 40 inference disclosure on iOS Simulator', () => {
  it('shows the synthetic request, blocks its provider until approval, and keeps manual save available', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: {
        OROT_E2E_PROBE: 'medical-appointment-classification',
      },
    });

    const providerCalls = element(by.id('issue40-synthetic-provider-calls'));
    await waitFor(element(by.text('캘린더 일정 불러오기')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.text('캘린더 일정 불러오기')).tap();
    await waitFor(
      element(
        by.text(
          'SENTINEL_HEALTH_VALUE: synthetic blood pressure 120/80 follow-up',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(30000);

    await element(by.text('선택한 AI로 분류')).tap();
    await waitFor(element(by.id('inference-disclosure-sheet')))
      .toBeVisible()
      .withTimeout(30000);
    const preview = element(by.id('inference-disclosure-message-1'));
    await element(by.id('inference-disclosure-preview')).scrollTo('bottom');
    const previewAttributes = await preview.getAttributes();
    const renderedPreview = JSON.stringify(previewAttributes);
    jestExpect(renderedPreview).toContain('SENTINEL_HEALTH_VALUE');
    jestExpect(renderedPreview).not.toContain(
      'SENTINEL_CALENDAR_EVENT_IDENTIFIER',
    );

    await element(by.id('inference-disclosure-cancel')).tap();
    await waitFor(
      element(
        by.text(
          'AI 결과를 사용할 수 없어 분류하지 않았습니다. 직접 확인해 주세요.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(30000);
    const afterCancel = await providerCalls.getAttributes();
    jestExpect(afterCancel.label || afterCancel.text).toBe(
      'syntheticProviderCalls=0',
    );

    await element(by.text('선택한 AI로 분류')).tap();
    await waitFor(element(by.id('inference-disclosure-sheet')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('inference-disclosure-allow')).tap();
    await waitFor(
      element(
        by.text(
          'AI 결과를 사용할 수 없어 분류하지 않았습니다. 직접 확인해 주세요.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(30000);
    const afterApproval = await providerCalls.getAttributes();
    jestExpect(afterApproval.label || afterApproval.text).toBe(
      'syntheticProviderCalls=1',
    );

    await element(by.id('medical-appointment-save-calendar-candidate-1')).tap();
    await waitFor(element(by.id('issue40-synthetic-calendar-save')))
      .toHaveText('syntheticCalendarSave=confirmed')
      .withTimeout(30000);
    console.log(
      'ISSUE_40_SYNTHETIC_SIMULATOR: requestDisclosure=verified; cancelBlocksProvider=verified; explicitApproval=verified; manualCalendarSave=verified; realProvider=unverified',
    );
    await device.terminateApp();
  });
});
