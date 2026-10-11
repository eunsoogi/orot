/* global by, device, element, waitFor */
const { expect: jestExpect } = require('@jest/globals');
async function report() {
  const attributes = await element(by.id('metering-report')).getAttributes();
  return JSON.parse(attributes.label || attributes.text);
}
async function start() {
  await device.launchApp({ newInstance: true, delete: false });
  await device.disableSynchronization();
  await waitFor(element(by.id('metering-status')))
    .toHaveText('idle')
    .withTimeout(10000);
  await element(by.id('metering-consent')).tap();
  await element(by.id('metering-start')).tap();
  await waitFor(element(by.id('metering-status')))
    .toHaveText('recording')
    .withTimeout(20000);
}

describe('issue 189 real microphone metering in isolated native module', () => {
  it('observes native events, pauses to zero, resumes, and removes its own artifact', async () => {
    await start();
    // A real 3-second observation window; no synthetic tone or amplitude injection.
    await new Promise(resolve => setTimeout(resolve, 3000));
    const initial = await report();
    console.log('ISSUE189_METERING_INITIAL ' + JSON.stringify(initial));
    jestExpect(initial.statistics.initial.samples).toBeGreaterThan(0);
    jestExpect(initial.statistics.initial.min).toBeGreaterThanOrEqual(0);
    jestExpect(initial.statistics.initial.max).toBeLessThanOrEqual(1);
    jestExpect(initial.state.unlinked).toBe(true);
    jestExpect(initial.state.excludedFromBackup).toBe(true);
    await device.takeScreenshot('issue189-real-microphone-waveform');
    await element(by.id('metering-pause')).tap();
    await waitFor(element(by.id('metering-status')))
      .toHaveText('paused')
      .withTimeout(5000);
    const paused = await report();
    await new Promise(resolve => setTimeout(resolve, 1000));
    const pausedAfter = await report();
    jestExpect(pausedAfter.state.ticks).toBe(paused.state.ticks);
    jestExpect(pausedAfter.state.amplitude).toBe(0);
    jestExpect(pausedAfter.statistics.pausedNonzero).toBe(0);
    console.log('ISSUE189_METERING_PAUSED ' + JSON.stringify(pausedAfter));
    await element(by.id('metering-resume')).tap();
    await new Promise(resolve => setTimeout(resolve, 3000));
    const resumed = await report();
    jestExpect(resumed.statistics.resumed.samples).toBeGreaterThan(0);
    jestExpect(resumed.state.ticks).toBeGreaterThan(paused.state.ticks);
    console.log('ISSUE189_METERING_RESUMED ' + JSON.stringify(resumed));
    await element(by.id('metering-finish')).tap();
    await waitFor(element(by.id('metering-status')))
      .toHaveText('completed')
      .withTimeout(5000);
    const completed = await report();
    jestExpect(completed.state.cleanupComplete).toBe(true);
    jestExpect(completed.state.amplitude).toBe(0);
    jestExpect(completed.state.reason).toBe('explicit-stop');
    console.log('ISSUE189_METERING_COMPLETE ' + JSON.stringify(completed));
  });

  it('ends automatically within the bounded lifetime', async () => {
    await device.terminateApp();
    await start();
    await waitFor(element(by.id('metering-status')))
      .toHaveText('completed')
      .withTimeout(30000);
    const completed = await report();
    jestExpect(completed.state.reason).toBe('timeout');
    jestExpect(completed.state.cleanupComplete).toBe(true);
    console.log('ISSUE189_METERING_TIMEOUT ' + JSON.stringify(completed));
  });
});
