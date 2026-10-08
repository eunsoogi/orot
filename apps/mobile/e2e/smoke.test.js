/* global by, device, element, waitFor */

/** Exercise a real feature route before returning through its own back control. */
async function openFeatureAndReturn(entryId, screenId, exerciseFeature) {
  await element(by.id(entryId)).tap();
  await waitFor(element(by.id(screenId)))
    .toBeVisible()
    .withTimeout(30000);
  if (exerciseFeature) await exerciseFeature();
  await element(by.text('뒤로').withAncestor(by.id(screenId))).tap();
  await waitFor(element(by.id('ai-features-screen')))
    .toBeVisible()
    .withTimeout(30000);
}

describe('Orot mobile app', () => {
  beforeAll(async () => {
    // Detox reinstalls between spec files, but iOS keeps Keychain items after app uninstall.
    await device.clearKeychain();
    await device.launchApp({
      languageAndLocale: { language: 'en', locale: 'en_US' },
      // The normal app route opts into sanitized logs so repository-open CI failures retain their cause.
      launchArgs: { OROT_STORAGE_DIAGNOSTICS: 'enabled' },
    });
  });

  it('renders the Korean welcome screen in English and opens Calendar linking', async () => {
    await expect(element(by.id('welcome-title'))).toHaveText(
      'Orot에 오신 걸 환영해요',
    );
    await expect(element(by.id('open-ai-features'))).toHaveLabel(
      'AI 건강 기능 살펴보기',
    );
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');

    // Exercise the Korean home entry and return path before the Calendar probe.
    await element(by.id('open-ai-features')).tap();
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('질환 가능성 살펴보기'))).toExist();
    await expect(element(by.text('건강 기록과 대화하기'))).toExist();
    await expect(element(by.text('의료 자료 찾아보기'))).toExist();
    await expect(element(by.id('visit-questions-unavailable'))).toHaveText(
      '현재 진료 질문을 준비할 수 없어요.',
    );

    await openFeatureAndReturn(
      'ai-feature-disease-hypotheses',
      'disease-hypotheses-screen',
      async () => {
        // Keychain is cleared above, so the real app must show a recoverable error before inference.
        await element(by.id('disease-hypotheses-generate')).tap();
        await waitFor(
          element(
            by.text('가능성을 정리하지 못했어요. 잠시 후 다시 시도해 주세요.'),
          ),
        )
          .toBeVisible()
          .withTimeout(30000);
        await expect(
          element(by.id('inference-disclosure-sheet')),
        ).not.toExist();
      },
    );

    await openFeatureAndReturn(
      'ai-feature-rag-conversation',
      'rag-conversation-screen',
      async () => {
        // Empty questions stay local and cannot start a provider request.
        const emptyMessageSend = await element(
          by.id('rag-conversation-send'),
        ).getAttributes();
        expect(emptyMessageSend.enabled).toBe(false);
        // A non-personal probe exercises the real route without selecting or contacting a provider.
        await element(by.id('rag-conversation-input')).typeText(
          'orot-no-provider-check',
        );
        await element(by.id('rag-conversation-input')).tapReturnKey();
        await element(by.id('rag-conversation-send')).tap();
        await waitFor(
          element(
            by.text('답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.'),
          ),
        )
          .toBeVisible()
          .withTimeout(30000);
        await expect(
          element(by.id('inference-disclosure-sheet')),
        ).not.toExist();
      },
    );

    await element(by.id('ai-features-screen')).scrollTo('bottom', 0.5, 0.7);
    await element(by.id('ai-feature-external-evidence')).tap();
    await waitFor(element(by.id('external-medical-evidence-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('external-evidence-query'))).toBeVisible();
    await expect(element(by.id('external-evidence-consent'))).toBeVisible();
    // Confirm a query stays local until the separate literature-search consent is checked.
    await element(by.id('external-evidence-query')).typeText(
      'orot-consent-check',
    );
    await element(by.id('external-evidence-query')).tapReturnKey();
    const searchBeforeConsent = await element(
      by.id('external-evidence-search'),
    ).getAttributes();
    expect(searchBeforeConsent.enabled).toBe(false);
    await element(by.id('external-evidence-consent')).tap();
    const searchAfterConsent = await element(
      by.id('external-evidence-search'),
    ).getAttributes();
    expect(searchAfterConsent.enabled).toBe(true);
    // Do not press search: this route check must not make a real literature request.
    await element(by.id('external-medical-evidence-screen')).scrollTo('top');
    await element(
      by.text('뒤로').withAncestor(by.id('external-medical-evidence-screen')),
    ).tap();
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('ai-feature-back')).tap();
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('open-appointments')).tap();
    // Manual appointment CRUD remains isolated in the dedicated appointments probe.
    await waitFor(element(by.id('calendar-title')))
      .toHaveText('캘린더 연결')
      .withTimeout(30000);
    await expect(element(by.id('calendar-connect'))).toHaveLabel(
      '캘린더 일정 불러오기',
    );
  });
});
