/* global by, device, element, waitFor */
const { expect: jestExpect } = require('@jest/globals');

async function read(id) {
  const attributes = await element(by.id(id)).getAttributes();
  return attributes.label || attributes.text;
}

describe('issue 189 real Apple and Europe PMC integration', () => {
  it('retrieves public literature and returns grounded citations for a synthetic question', async () => {
    await device.launchApp({ newInstance: true });
    await device.disableSynchronization();
    await waitFor(element(by.id('issue189-rag-result')))
      .toExist()
      .withTimeout(150000);
    const summary = JSON.parse(await read('issue189-rag-result'));
    console.log('ISSUE189_RAG_NATIVE_RESULT ' + JSON.stringify(summary));
    for (const [group, count] of [
      ['request', summary.requests],
      ['response', summary.responses],
      ['publication', summary.publications],
      ['citation', summary.citations],
      ['diagnostic', summary.diagnostics],
    ]) {
      for (let index = 0; index < count; index += 1) {
        console.log(
          `ISSUE189_RAG_${group.toUpperCase()} ` +
            (await read(`issue189-rag-${group}-${index}`)),
        );
      }
    }
    console.log('ISSUE189_RAG_ANSWER ' + (await read('issue189-rag-answer')));
    jestExpect(summary.availability).toBe('available');
    jestExpect(summary.retrieval).toBe('observed');
    jestExpect(summary.requests).toBeGreaterThan(0);
    jestExpect(summary.responses).toBeGreaterThan(0);
    jestExpect(summary.publications).toBeGreaterThan(0);
    jestExpect(summary.terminal).toBe('answer');
    jestExpect(summary.citations).toBeGreaterThan(0);
  });
});
