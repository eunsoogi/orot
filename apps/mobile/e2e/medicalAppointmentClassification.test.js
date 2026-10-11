/* global by, device, element, waitFor, describe, it, expect */

const { expect: jestExpect } = require('@jest/globals');

describe('issue 40 inference disclosure on iOS Simulator', () => {
  it('shows the synthetic request, blocks its provider until approval, and preserves manual entry without saving failed classifications', async () => {
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: {
        OROT_E2E_PROBE: 'medical-appointment-classification',
      },
    });

    const providerCalls = element(by.id('issue40-synthetic-provider-calls'));
    await waitFor(element(by.id('medical-appointment-import')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('medical-appointment-import')).tap();
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
          '일부 일정을 분류하지 못했어요. 다시 시도하거나 직접 입력해 주세요.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(30000);
    const afterCancel = await providerCalls.getAttributes();
    jestExpect(afterCancel.label || afterCancel.text).toBe(
      'syntheticProviderCalls=0',
    );

    await element(by.id('medical-appointment-import')).tap();
    await waitFor(element(by.id('inference-disclosure-sheet')))
      .toBeVisible()
      .withTimeout(30000);
    await element(by.id('inference-disclosure-allow')).tap();
    await waitFor(
      element(
        by.text(
          '일부 일정을 분류하지 못했어요. 다시 시도하거나 직접 입력해 주세요.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(30000);
    const afterApproval = await providerCalls.getAttributes();
    jestExpect(afterApproval.label || afterApproval.text).toBe(
      'syntheticProviderCalls=1',
    );

    await expect(
      element(by.id('issue40-synthetic-calendar-save')),
    ).not.toExist();
    await expect(
      element(by.id('medical-appointment-save-calendar-candidate-1')),
    ).not.toExist();
    await expect(element(by.id('medical-appointment-manual'))).toBeVisible();
    await element(by.id('medical-appointment-manual')).tap();
    await expect(element(by.id('issue40-synthetic-manual-entry'))).toExist();
    console.log(
      'ISSUE_40_SYNTHETIC_SIMULATOR: requestDisclosure=verified; cancelBlocksProvider=verified; explicitApproval=verified; failedClassificationNotSaved=verified; manualEntryAction=available; realProvider=unverified',
    );
    await device.terminateApp();
  });
});
