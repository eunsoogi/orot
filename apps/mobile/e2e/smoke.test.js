/* global beforeAll, by, device, element, waitFor */

const { expectContentAboveFloatingBar } = require('./safeAreaHelpers');
const { expect: jestExpect } = require('@jest/globals');
const {
  expectNativeNavigationAction,
  openFeatureAndReturn,
  confirmUnsavedLeave,
  openRootTab,
  tapNativeNavigationAction,
} = require('./smokeHelpers');
const {
  releasePhaseResetGuard,
  resetHookTimeoutMs,
} = require('./storageProbeResetGuard.e2e.js');

describe('Orot mobile app', () => {
  beforeAll(async () => {
    // Share the phase latch so a late uninstall cannot overlap the next Release reset.
    await releasePhaseResetGuard.runReset(async assertMayContinue => {
      await device.uninstallApp();
      assertMayContinue();
      await device.clearKeychain();
      assertMayContinue();
      await device.installApp();
      assertMayContinue();
    });
  }, resetHookTimeoutMs);

  // Keep the integrated route flow in one Release case.
  // The observed CI path exceeded the shared 120-second default.
  it('opens AI routes and Calendar linking from their root tabs', async () => {
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

    await expectContentAboveFloatingBar(
      'navigation-route-scroll',
      'home-empty-recordings',
    );
    await openRootTab('records', 'records-title');
    await expectContentAboveFloatingBar(
      'navigation-route-scroll',
      'records-open-blood-pressure',
    );
    await element(by.id('navigation-route-scroll')).scrollTo('top', 0.5, 0.2);
    await element(by.id('records-new-recording')).tap();
    await waitFor(element(by.id('recording-controls-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('records-title')))
      .toBeVisible()
      .withTimeout(30000);

    await openRootTab('ai', 'ai-features-screen');
    await expectContentAboveFloatingBar(
      'ai-features-screen',
      'ai-feature-external-evidence',
    );
    await element(by.id('ai-features-screen')).scrollTo('top', 0.5, 0.2);
    // The synthetic route operations isolate the keyboard/save assertion while preserving real App navigation.
    await element(by.id('ai-feature-visit-questions')).tap();
    await waitFor(element(by.id('next-visit-questions-scroll')))
      .toBeVisible()
      .withTimeout(30000);
    await expectNativeNavigationAction('navigation-back');
    await expect(element(by.id('next-visit-questions-back'))).not.toExist();
    await waitFor(element(by.id('next-visit-appointment-time')))
      .toBeVisible()
      .withTimeout(30000);
    await expect(
      element(by.text('선택한 AI · 합성 UI 검사 제공자')),
    ).toBeVisible();

    await expectNativeNavigationAction('next-visit-generate');
    await tapNativeNavigationAction('next-visit-generate');
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
    const keyboardTop = Number(keyboardMatch[1]);
    const keyboardHeight = Number(keyboardMatch[2]);
    jestExpect(keyboardHeight).toBeGreaterThan(0);
    jestExpect(saveFrame.y + saveFrame.height).toBeLessThanOrEqual(keyboardTop);

    await tapNativeNavigationAction('next-visit-review-save');
    await waitFor(element(by.id('next-visit-save-message')))
      .toHaveText('검토한 질문을 이 예약에 저장했어요.')
      .withTimeout(30000);
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);

    // Only Visit Questions uses probe services; every other route keeps App's default dependencies.
    await expect(element(by.id('ai-features-screen'))).toBeVisible();
    await expect(element(by.text('다음 진료 질문'))).toExist();
    await expect(element(by.text('증상 정리'))).toExist();
    await expect(element(by.text('기록과 대화'))).toExist();
    await expect(element(by.text('의학 자료 찾기'))).toExist();
    await expect(element(by.id('navigation-tab-schedule'))).toHaveLabel(
      '일정 탭',
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
    await element(by.id('external-medical-evidence-screen')).scrollTo(
      'top',
      0.5,
      0.2,
    );
    await tapNativeNavigationAction('navigation-back');
    await confirmUnsavedLeave();
    await waitFor(element(by.id('ai-features-screen')))
      .toBeVisible()
      .withTimeout(30000);

    await openRootTab('settings', 'settings-title');
    await expectContentAboveFloatingBar(
      'navigation-route-scroll',
      'settings-app-info',
    );
    await element(by.id('navigation-route-scroll')).scrollTo('top', 0.5, 0.2);
    await element(by.id('settings-open-provider')).tap();
    await waitFor(element(by.id('provider-selection-screen')))
      .toBeVisible()
      .withTimeout(30000);
    await expectNativeNavigationAction('navigation-back');
    await tapNativeNavigationAction('navigation-back');
    await waitFor(element(by.id('settings-title')))
      .toBeVisible()
      .withTimeout(30000);

    await openRootTab('schedule', 'calendar-title');
    // Appointment management remains a detail route within the Schedule section.
    await expect(element(by.id('schedule-open-appointments'))).toBeVisible();
    await waitFor(element(by.id('calendar-title')))
      .toHaveText('일정')
      .withTimeout(30000);
    await expect(element(by.id('calendar-connect'))).toHaveLabel(
      '캘린더 일정 불러오기',
    );
  }, 180_000);
});
