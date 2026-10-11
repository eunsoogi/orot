/* global by, device, element, waitFor */
const { expect: jestExpect } = require('@jest/globals');

async function read(id) {
  const attributes = await element(by.id(id)).getAttributes();
  return JSON.parse(attributes.label || attributes.text);
}

describe('issue 189 actual Apple workflow results', () => {
  it('classifies Calendar, generates cited visit questions, and cancels next-visit generation', async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    const result = element(by.id('issue189-apple-workflow-summary'));
    await waitFor(result).toExist().withTimeout(300000);
    const summary = await read('issue189-apple-workflow-summary');
    console.log('ISSUE189_APPLE_WORKFLOW_SUMMARY ' + JSON.stringify(summary));
    const phases = {};
    for (const phase of ['calendar', 'nextVisit', 'cancellation']) {
      phases[phase] = await read(`issue189-apple-${phase}-result`);
      console.log(
        'ISSUE189_APPLE_WORKFLOW_PHASE ' + JSON.stringify(phases[phase]),
      );
    }
    jestExpect(summary.availability).toBe('available');
    jestExpect(summary.calendar).toBe('complete');
    jestExpect(summary.nextVisit).toBe('ready');
    jestExpect(phases.nextVisit.result.questions.length).toBeGreaterThan(0);
    jestExpect(
      phases.nextVisit.result.questions.every(
        question => question.citations.length > 0,
      ),
    ).toBe(true);
    jestExpect(summary.providerStarted).toBe(true);
    jestExpect(summary.abortSent).toBe(true);
    jestExpect(summary.cancellation).toBe('cancelled');
  });
});
