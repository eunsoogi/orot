/* global by, device, element, waitFor */
const { expect: jestExpect } = require('@jest/globals');
async function read(id) {
  const attributes = await element(by.id(id)).getAttributes();
  return JSON.parse(attributes.label || attributes.text);
}

describe('issue 189 automatic transcription with real Apple Speech', () => {
  it('refuses the production save, then persists native segments after the real screen stop action', async () => {
    await device.launchApp({
      newInstance: true,
      delete: false,
      launchArgs: { OROT_ISSUE189_AUTOMATIC_VERIFY_SOURCE_ID: '' },
    });
    await device.disableSynchronization();
    await waitFor(element(by.id('issue189-automatic-phase')))
      .toHaveText('ready')
      .withTimeout(60000);
    const refusal = await read('issue189-automatic-refusal');
    console.log('ISSUE189_AUTOMATIC_REFUSAL ' + JSON.stringify(refusal));
    jestExpect(refusal.rejectionCode).toBe('RECORDING_FILE_PROTECTION_FAILED');
    jestExpect(refusal.absentSource).toBe(true);
    jestExpect(refusal.absentSegments).toBe(true);
    jestExpect(refusal.providerCalls).toBe(0);
    jestExpect(refusal.fileProtection).not.toBe('complete');
    await element(by.id('recording-consent')).tap();
    await element(by.id('recording-start')).tap();
    await waitFor(element(by.id('recording-stop')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.id('recording-stop')).tap();
    await waitFor(element(by.id('issue189-automatic-result')))
      .toExist()
      .withTimeout(150000);
    const result = await read('issue189-automatic-result');
    console.log('ISSUE189_AUTOMATIC_RESULT ' + JSON.stringify(result));
    jestExpect(result.providerCalls).toBe(1);
    jestExpect(result.events).toEqual([
      'production-save-refused',
      'screen-start',
      'screen-stop',
      'synthetic-source-saved',
      'native-provider-start',
      'native-provider-complete',
    ]);
    jestExpect(result.fileProtection).toBe(refusal.fileProtection);
    jestExpect(result.nativeResult.segments.length).toBeGreaterThan(0);
    jestExpect(result.segments).toHaveLength(
      result.nativeResult.segments.length,
    );
    for (const [index, segment] of result.segments.entries()) {
      const native = result.nativeResult.segments[index];
      jestExpect(segment.text).toBe(native.text);
      jestExpect(segment.text.trim().length).toBeGreaterThan(0);
      jestExpect(segment.audioRange).toEqual({
        startMs: Math.floor(native.startSeconds * 1000),
        endMs: Math.ceil(native.endSeconds * 1000),
      });
      jestExpect(segment.audioRange.endMs).toBeLessThanOrEqual(
        segment.recordingDurationMs,
      );
      jestExpect(segment.recordingSourceId).toBe(result.source.id);
      jestExpect(segment.reviewState.status).toBe('unreviewed');
      jestExpect(segment.provenance.source.system).toBe('Apple Speech');
      jestExpect(segment.provenance.source.sourceIdentifier).toBe(
        result.nativeResult.engine,
      );
    }
    // Terminate the process, preserving SQLCipher data, and compare every persisted field.
    await device.terminateApp();
    await device.launchApp({
      newInstance: true,
      delete: false,
      launchArgs: {
        OROT_ISSUE189_AUTOMATIC_VERIFY_SOURCE_ID: result.source.id,
      },
    });
    await device.disableSynchronization();
    await waitFor(element(by.id('issue189-automatic-phase')))
      .toHaveText('relaunch-complete')
      .withTimeout(60000);
    const relaunched = await read('issue189-automatic-result');
    console.log('ISSUE189_AUTOMATIC_RELAUNCH ' + JSON.stringify(relaunched));
    jestExpect(relaunched.providerCalls).toBe(0);
    jestExpect(relaunched.source).toEqual(result.source);
    jestExpect(relaunched.segments).toEqual(result.segments);
  });
});
