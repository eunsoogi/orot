/* global by, device, element, waitFor, describe, it */

const { expect: jestExpect } = require('@jest/globals');

async function readProbeResult() {
  const result = element(by.id('issue25-hybrid-terminal'));
  await waitFor(result).toBeVisible().withTimeout(900000);
  const attributes = await result.getAttributes();
  const label = attributes.label ?? attributes.text;
  if (typeof label !== 'string') {
    throw new Error(
      'The issue-25 probe finished without an accessible result label.',
    );
  }
  if (label.startsWith('Issue 25 hybrid probe failed:')) throw new Error(label);
  const prefix = 'Issue 25 hybrid complete; result=';
  if (!label.startsWith(prefix))
    throw new Error(`Unexpected issue-25 result: ${label}`);
  const probeResult = JSON.parse(label.slice(prefix.length));
  console.log(`ISSUE25_HYBRID_RETRIEVAL ${JSON.stringify(probeResult)}`);
  return probeResult;
}

describe('on-device SQLCipher hybrid retrieval', () => {
  it('combines local FTS and E5 candidates while preserving filters and evidence locators', async () => {
    await device.uninstallApp();
    await device.clearKeychain();
    await device.installApp();
    await device.launchApp({ newInstance: true });
    try {
      const assertHybridResult = (result, mode) => {
        // Detox replaces the global expect with UI matchers; use Jest for probe data.
        jestExpect(result.mode).toBe(mode);
        jestExpect(result.sqlCipherEnabled).toBe(true);
        jestExpect(result.tempStoreMode).toBe(2);
        jestExpect(result.remainingVectorCount).toBe(1);
        jestExpect(result.ftsOnly).toMatchObject({
          lexicalRank: 1,
          vectorRank: null,
        });
        jestExpect(result.vectorOnly).toMatchObject({
          lexicalRank: null,
          vectorRank: 1,
        });
        jestExpect(result.filtersApplied).toBe(true);
        jestExpect(result.locatorPreserved).toBe(true);
        jestExpect(result.temporaryTablesCleaned).toBe(true);
      };
      assertHybridResult(await readProbeResult(), 'indexed');

      await device.terminateApp();
      await device.launchApp({ newInstance: true });
      assertHybridResult(await readProbeResult(), 'reopened');
    } finally {
      await device.terminateApp();
      await device.uninstallApp();
      await device.clearKeychain();
    }
  });
});
