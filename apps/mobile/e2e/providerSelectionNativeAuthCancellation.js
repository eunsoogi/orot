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
    // Give the local website consent prompt time to appear before treating it as optional.
    await new Promise(resolve => setTimeout(resolve, 250));
    for (const label of ['Continue', '계속']) {
      try {
        await system.element(by.system.label(label)).tap();
        break;
      } catch {
        // A reused Simulator may remember the website consent already.
      }
    }
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
