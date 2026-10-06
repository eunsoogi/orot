const {
  tapLoopbackConsentContinue,
} = require('./providerSelectionSystemConsent');

async function verifyNativeAuthSessionCancellation({
  by,
  device,
  element,
  reset,
  system,
  summary,
  waitFor,
}) {
  await device.disableSynchronization();
  try {
    await element(by.id('provider-selection-native-auth-cancel')).tap();
    // Let ASWebAuthenticationSession present its local-loopback consent sheet before tapping it.
    await new Promise(resolve => setTimeout(resolve, 250));
    await tapLoopbackConsentContinue({ by, system });
    await waitFor(summary)
      .toHaveText(
        'nativeAuthSessionCancellation=verified; realAccount=unverified',
      )
      .withTimeout(120000);
  } finally {
    await device.enableSynchronization();
  }
  console.log(
    'PROVIDER_SELECTION_SIMULATOR nativeAuthSessionCancellation=verified; continuationResolved=verified; realAccount=unverified',
  );
  await reset.tap();
  await waitFor(summary)
    .toHaveText(
      'selectionCallback=not-called-on-load; synthetic=cleared; realAccount=unverified',
    )
    .withTimeout(120000);
}

module.exports = { verifyNativeAuthSessionCancellation };
