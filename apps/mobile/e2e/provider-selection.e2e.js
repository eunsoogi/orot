/* global by, device, element, system, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');
const {
  verifyNativeAuthSessionCancellation,
} = require('./providerSelectionNativeAuthCancellation');
const {
  tapLoopbackConsentContinue,
} = require('./providerSelectionSystemConsent');
const scrollToConfirmation = require('./providerSelectionScroll');

describe('provider selection on iOS Simulator', () => {
  it('returns from auth, refreshes synthetic account state, and restores explicit selection', async () => {
    await device.launchApp();
    const reset = element(by.id('provider-selection-probe-reset'));
    const summary = element(by.id('provider-selection-probe-summary'));
    await waitFor(reset).toBeVisible().withTimeout(240000);
    await reset.tap();
    await waitFor(element(by.id('provider-selection-probe-summary')))
      .toHaveText(
        'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
      )
      .withTimeout(120000);

    await verifyNativeAuthSessionCancellation({
      by,
      device,
      element,
      reset,
      system,
      summary,
      waitFor,
    });

    await element(by.id('provider-selection-auth-cancel')).tap();
    await waitFor(element(by.id('chatgpt-account-action')))
      .toBeVisible()
      .withTimeout(120000);
    await element(by.id('chatgpt-account-action')).tap();
    const cancelLogin = element(by.id('chatgpt-cancel-sign-in'));
    await waitFor(cancelLogin).toBeVisible().withTimeout(120000);

    // Leaving the route must cancel its native auth session before a later retry.
    await element(by.id('provider-selection-back')).tap();
    await waitFor(summary)
      .toHaveText(
        'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
      )
      .withTimeout(120000);
    await element(by.id('provider-selection-auth-cancel')).tap();
    await waitFor(element(by.id('chatgpt-account-action')))
      .toBeVisible()
      .withTimeout(120000);
    await element(by.id('chatgpt-account-action')).tap();
    await waitFor(cancelLogin).toBeVisible().withTimeout(120000);
    await cancelLogin.tap();
    await waitFor(element(by.text('ChatGPT 로그인을 취소했어요.')))
      .toBeVisible()
      .withTimeout(120000);
    console.log(
      'PROVIDER_SELECTION_SIMULATOR syntheticAuthCancellation=verified; routeExitCancelsPendingAuth=verified; reopenRetry=verified; realAccount=unverified',
    );
    await element(by.id('provider-selection-back')).tap();
    await waitFor(element(by.id('provider-selection-probe-summary')))
      .toHaveText(
        'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
      )
      .withTimeout(120000);
    await element(by.id('provider-selection-auth-success')).tap();
    await waitFor(element(by.id('chatgpt-account-action')))
      .toBeVisible()
      .withTimeout(120000);
    await element(by.id('chatgpt-account-action')).tap();
    await device.disableSynchronization();
    try {
      await tapLoopbackConsentContinue({ by, system });
      await waitFor(
        element(
          by.text(
            '로그인을 확인했어요. 모델 목록을 확인하려면 다시 눌러 주세요.',
          ),
        ),
      )
        .toBeVisible()
        .withTimeout(120000);
    } finally {
      await device.enableSynchronization();
    }
    await waitFor(element(by.text('선택한 계정의 모델 목록 불러오기')))
      .toBeVisible()
      .withTimeout(120000);
    console.log(
      'PROVIDER_SELECTION_SIMULATOR nativeSyntheticAuthReturn=verified; nativeAccountRefresh=verified; realAccount=unverified',
    );
    await element(by.id('provider-selection-back')).tap();
    await waitFor(summary)
      .toHaveText(
        'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
      )
      .withTimeout(120000);

    await device.terminateApp();
    await device.launchApp({ newInstance: true });

    const prompt = element(
      by.text('아직 AI를 선택하지 않았어요. 사용할 AI를 직접 골라 주세요.'),
    );
    await waitFor(prompt).toBeVisible().withTimeout(120000);
    const initialSummary = await summary.getAttributes();
    jestExpect(initialSummary.label || initialSummary.text).toContain(
      'selectionCallback=not-called-on-load',
    );

    await element(by.id('provider-option-1')).tap();
    const selectionScreen = element(by.id('provider-selection-screen'));
    const lastOption = element(by.id('provider-option-12'));
    await waitFor(lastOption).toExist().withTimeout(120000);
    await scrollToConfirmation(selectionScreen, device);
    const confirmation = element(by.id('provider-selection-confirm'));
    await waitFor(confirmation).toBeVisible().withTimeout(120000);
    const privacy = element(by.id('provider-selection-confirmation-privacy'));
    await waitFor(privacy).toBeVisible().withTimeout(120000);
    await confirmation.tap();
    await waitFor(summary)
      .toHaveText(
        'selectionCallback=called; synthetic=provider-selection; realAccount=unverified',
      )
      .withTimeout(120000);

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await waitFor(element(by.text('현재 선택: Synthetic ChatGPT model')))
      .toBeVisible()
      .withTimeout(120000);
    const restoredSummary = await summary.getAttributes();
    jestExpect(restoredSummary.label || restoredSummary.text).toContain(
      'selectionCallback=not-called-on-load',
    );
    console.log(
      'PROVIDER_SELECTION_SIMULATOR synthetic=selection-and-Keychain-persistence; remoteConfirmation=explicit; fallback=none; realAccount=unverified',
    );

    await reset.tap();
    await waitFor(summary)
      .toHaveText(
        'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
      )
      .withTimeout(120000);

    await element(by.id('provider-selection-sign-out-start')).tap();
    const signOut = element(by.id('chatgpt-account-sign-out'));
    await waitFor(signOut).toBeVisible().withTimeout(120000);
    await waitFor(element(by.text('ChatGPT 계정 1 로그아웃')))
      .toBeVisible()
      .withTimeout(120000);
    // This fixture emits one delta; the package gate tests cover queued late packets.
    const signOutRequest = element(
      by.id('provider-selection-sign-out-request'),
    );
    const inFlightResponse = element(
      by.id('provider-selection-sign-out-response'),
    );
    // Disable before this tap; starting the open response otherwise makes Detox wait for idleness.
    await device.disableSynchronization();
    try {
      await signOutRequest.tap();
      await waitFor(inFlightResponse)
        .toHaveText('pending-after-delta')
        .withTimeout(120000);
      await signOut.tap();
      await waitFor(inFlightResponse)
        .toHaveText('failed:authentication_required')
        .withTimeout(120000);
    } finally {
      await device.enableSynchronization();
    }
    await waitFor(
      element(
        by.text(
          'ChatGPT 계정 1의 앱 저장 인증 정보를 삭제했고 갱신 토큰 폐기를 확인했어요. 브라우저 세션 상태는 확인되지 않아요.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(120000);
    await waitFor(
      element(
        by.text(
          '이전에 선택한 AI를 사용할 수 없어요. 자동으로 다른 AI를 고르지 않았습니다.',
        ),
      ),
    )
      .toBeVisible()
      .withTimeout(120000);
    await new Promise(resolve => setTimeout(resolve, 500));
    const responseAfterSignOut = await inFlightResponse.getAttributes();
    jestExpect(responseAfterSignOut.label || responseAfterSignOut.text).toBe(
      'failed:authentication_required',
    );
    console.log(
      'PROVIDER_SELECTION_SIMULATOR nativeSyntheticSignOut=revoked; inFlightRequestCancelled=verified; postSignOutStateStable=verified; selectedProviderUnavailable=verified; realAccount=unverified',
    );
    await element(by.id('provider-selection-back')).tap();

    await device.terminateApp();
    await device.launchApp({ newInstance: true });
    await waitFor(summary)
      .toHaveText(
        'selectionCallback=not-called-on-load; synthetic=enabled; realAccount=unverified',
      )
      .withTimeout(120000);
    // Reopening the native fixture can keep the Simulator run loop awake; assert the UI directly.
    await device.disableSynchronization();
    try {
      await element(by.id('provider-selection-sign-out-reopen')).tap();
      const reloginAction = element(by.id('chatgpt-account-action'));
      await waitFor(reloginAction).toBeVisible().withTimeout(120000);
      await waitFor(element(by.id('chatgpt-account-status')))
        .toBeVisible()
        .withTimeout(120000);
      await waitFor(
        element(
          by.text(
            '이전에 선택한 AI를 사용할 수 없어요. 자동으로 다른 AI를 고르지 않았습니다.',
          ),
        ),
      )
        .toBeVisible()
        .withTimeout(120000);
      await reloginAction.tap();
      await waitFor(
        element(
          by.text(
            '로그인을 확인했어요. 모델 목록을 확인하려면 다시 눌러 주세요.',
          ),
        ),
      )
        .toBeVisible()
        .withTimeout(120000);
      await waitFor(signOut).toBeVisible().withTimeout(120000);
    } finally {
      await device.enableSynchronization();
    }
    console.log(
      'PROVIDER_SELECTION_SIMULATOR syntheticSignOutSurvivesRelaunch=verified; relogin=verified; realAccount=unverified',
    );
    await element(by.id('provider-selection-back')).tap();
    await element(by.id('provider-selection-probe-reset')).tap();
  });
});
