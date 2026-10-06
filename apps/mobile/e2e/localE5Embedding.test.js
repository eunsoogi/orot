/* global by, device, element, waitFor */

async function waitForProbeResult(mode, timeoutMs) {
  const result = element(by.id('local-e5-probe-terminal'));
  await waitFor(result).toBeVisible().withTimeout(timeoutMs);
  const attributes = await result.getAttributes();
  const label = attributes.label ?? attributes.text;
  if (typeof label !== 'string') {
    throw new Error(
      `The ${mode} probe finished without an accessible result label.`,
    );
  }
  if (label.startsWith('Local E5 probe failed:')) {
    throw new Error(label);
  }
  const resultPrefix = `Local E5 ${mode} complete; result=`;
  if (!label.startsWith(resultPrefix)) {
    throw new Error(`Unexpected ${mode} probe result: ${label}`);
  }
  const probeResult = JSON.parse(label.slice(resultPrefix.length));
  console.log(
    `LOCAL_E5_EMBEDDING_PROBE ${mode} ${JSON.stringify(probeResult)}`,
  );
  return probeResult;
}

describe('on-device multilingual E5 embeddings', () => {
  it('measures Korean retrieval and memory, cancels a native batch, and reads the persisted index after relaunch', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({
      newInstance: false,
      launchArgs: { OROT_LOCAL_E5_PROBE: 'fresh' },
    });
    await waitForProbeResult('fresh', 900000);

    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      launchArgs: { OROT_LOCAL_E5_PROBE: 'restart' },
    });
    await waitForProbeResult('restart', 300000);
  });
});
