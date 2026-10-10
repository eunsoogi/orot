/* global by, device, element, waitFor */

const { expect: jestExpect } = require('@jest/globals');
const { tapNativeNavigationAction } = require('./smokeHelpers');

/** Exercise a real route and confirm only when its state guard reports local edits. */
async function openFeatureAndReturn(
  entryId,
  screenId,
  exerciseFeature,
  confirmUnsaved = false,
) {
  // Home keeps the feature cards in its shared scroll view rather than a nested list.
  await element(by.id('navigation-route-scroll')).scroll(240, 'down', 0.5, 0.7);
  await element(by.id(entryId)).tap();
  await waitFor(element(by.id(screenId)))
    .toBeVisible()
    .withTimeout(30000);
  if (exerciseFeature) await exerciseFeature();
  // Integrated feature routes expose Back through the shared native toolbar.
  await tapNativeNavigationAction('navigation-back');
  if (confirmUnsaved) await confirmUnsavedLeave();
  await waitFor(element(by.id('welcome-title')))
    .toBeVisible()
    .withTimeout(30000);
}

async function confirmUnsavedLeave() {
  await waitFor(element(by.text('내용 버리고 나가기')))
    .toBeVisible()
    .withTimeout(5000);
  await element(by.text('내용 버리고 나가기')).tap();
}

describe('Orot mobile app', () => {
  beforeAll(async () => {
    // Detox reinstalls between spec files, but iOS keeps Keychain items after app uninstall.
    await device.clearKeychain();
  });

  // Keep the integrated route flow in one Release case.
  // The observed CI path exceeded the shared 120-second default.
  it('renders AI routes and opens Calendar linking from the Korean welcome screen', async () => {
    // Keep the integrated App route deterministic without contacting a provider or reading user records.
    await device.launchApp({
      newInstance: true,
      languageAndLocale: { language: 'en', locale: 'en_US' },
      launchArgs: {
        OROT_E2E_PROBE: 'ai-feature-visit-questions',
        OROT_STORAGE_DIAGNOSTICS: 'enabled',
      },
    });
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await expect(element(by.id('navigation-recording'))).toHaveLabel(
      '녹음 화면으로 이동',
    );
    await tapNativeNavigationAction('navigation-recording');
    await waitFor(element(by.id('recording-controls-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    // The synthetic route operations isolate the keyboard/save assertion while preserving real App navigation.
    await element(by.id('ai-feature-visit-questions')).tap();
    await waitFor(element(by.id('next-visit-questions-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('navigation-back'))).toBeVisible();
    await expect(element(by.id('next-visit-questions-back'))).not.toExist();
    await waitFor(element(by.id('next-visit-appointment-time')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.text('합성 UI 검사 제공자'))).toBeVisible();

    await expect(element(by.id('next-visit-generate'))).toBeVisible();
    await element(by.id('next-visit-generate')).tap();
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
    const keyboardTop = Number(keyboardMatch[1]);
    const keyboardHeight = Number(keyboardMatch[2]);
    jestExpect(keyboardHeight).toBeGreaterThan(0);
    jestExpect(saveFrame.y + saveFrame.height).toBeLessThanOrEqual(keyboardTop);

    await saveAction.tap();
    await waitFor(element(by.id('next-visit-save-message')))
      .toHaveText('검토한 질문을 이 예약에 저장했어요.')
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    // Only Visit Questions uses probe services; every other route keeps App's default dependencies.
    await expect(element(by.id('welcome-title'))).toHaveText('오롯');
    await expect(element(by.text('다음 진료 질문'))).toExist();
    await expect(element(by.text('질환 가능성 살펴보기'))).toExist();
    await expect(element(by.text('건강 기록과 대화하기'))).toExist();
    await expect(element(by.text('의료 자료 찾아보기'))).toExist();
    await expect(element(by.id('open-appointments'))).toHaveLabel('예약');

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
        // Component tests cover disabled state because Detox reports enabled=true for disabled React Native Buttons here.
        await expect(element(by.id('rag-conversation-send'))).toBeVisible();
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
      true,
    );

    await element(by.id('ai-feature-external-evidence')).tap();
    await waitFor(element(by.id('external-medical-evidence-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('external-evidence-query'))).toBeVisible();
    await expect(element(by.id('external-evidence-consent'))).toBeVisible();
    // Use the consent guidance as the route-level boundary; this Detox surface reports disabled Buttons as enabled.
    await element(by.id('external-evidence-query')).typeText(
      'orot-consent-check',
    );
    await element(by.id('external-evidence-query')).tapReturnKey();
    await expect(
      element(by.text('검색어 전송에 동의한 뒤 검색할 수 있어요.')),
    ).toBeVisible();
    await element(by.id('external-evidence-consent')).tap();
    await expect(
      element(by.text('검색어 전송에 동의한 뒤 검색할 수 있어요.')),
    ).not.toExist();
    // Do not press search: this route check must not make a real literature request.
    await element(by.id('external-medical-evidence-screen')).scrollTo('top');
    await tapNativeNavigationAction('navigation-back');
    await confirmUnsavedLeave();
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    // Home controls follow the AI cards, so scroll them into view before tapping.
    await element(by.id('navigation-route-scroll')).scrollTo('bottom');
    await element(by.id('open-provider-selection')).tap();
    await waitFor(element(by.id('provider-selection-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(element(by.id('navigation-back'))).toBeVisible();
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('welcome-title')))
      .toBeVisible()
      .withTimeout(30000);

    await element(by.id('navigation-route-scroll')).scrollTo('bottom');
    await element(by.id('open-appointments')).tap();
    // Manual appointment CRUD remains isolated in the dedicated appointments probe.
    await waitFor(element(by.id('calendar-title')))
      .toHaveText('캘린더 연결')
      .withTimeout(30000);
    await expect(element(by.id('calendar-connect'))).toHaveLabel(
      '캘린더 일정 불러오기',
    );
  }, 180_000);
});
