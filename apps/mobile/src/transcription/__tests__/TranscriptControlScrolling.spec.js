const {
  scrollToTranscriptControl,
} = require('../../../e2e/transcription/transcriptEvidenceDetoxHelpers');
const { expect: jestExpect } = require('@jest/globals');

describe('transcript control scrolling', () => {
  const originals = {};

  beforeEach(() => {
    originals.by = global.by;
    originals.waitFor = global.waitFor;
  });

  afterEach(() => {
    global.by = originals.by;
    global.waitFor = originals.waitFor;
  });

  it('waits for the scroll to reveal a control before continuing', async () => {
    const actions = [];
    const target = {};
    const scrollPending = Promise.withResolvers();

    global.by = { id: id => ({ id }) };
    global.waitFor = control => {
      jestExpect(control).toBe(target);
      return {
        toBeVisible: () => ({
          whileElement: container => {
            jestExpect(container.id).toBe('recording-controls-scroll');
            return {
              scroll: (...args) => {
                actions.push(['scroll', ...args]);
                return scrollPending.promise;
              },
            };
          },
        }),
      };
    };

    const saveFlow = scrollToTranscriptControl(target, 'up').then(() =>
      actions.push('save'),
    );
    jestExpect(actions).toEqual([['scroll', 100, 'up', 0.5, 0.35]]);

    scrollPending.resolve();
    await saveFlow;
    jestExpect(actions.at(-1)).toBe('save');
  });
});
