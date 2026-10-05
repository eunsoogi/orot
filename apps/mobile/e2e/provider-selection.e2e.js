/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

describe('provider selection on iOS Simulator', () => {
  it('requires remote confirmation and restores only the explicit synthetic selection', async () => {
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
  });
});
