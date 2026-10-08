const {
  scrollToSaveButton,
} = require('../../../e2e/transcription/transcriptEvidenceDetoxHelpers');
const { expect: jestExpect } = require('@jest/globals');

describe('transcript control scrolling', () => {
  const originals = {};

  beforeEach(() => {
    originals.by = global.by;
    originals.element = global.element;
    originals.waitFor = global.waitFor;
  });

  afterEach(() => {
    global.by = originals.by;
    global.element = originals.element;
    global.waitFor = originals.waitFor;
  });

  it('scrolls down and waits for the Save control before tapping it', async () => {
    const actions = [];
    const target = { tap: () => actions.push('tap') };
    const scrollPending = Promise.withResolvers();

    global.by = { id: id => ({ id }) };
    global.element = selector => {
      jestExpect(selector.id).toBe('transcript-save-0');
      return target;
    };
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

    // Detox scroll direction follows content order; Save sits below the editor.
    const saveFlow = scrollToSaveButton('transcript-save-0').then(saveButton =>
      saveButton.tap(),
    );
    jestExpect(actions).toEqual([['scroll', 100, 'down', 0.5, 0.35]]);

    scrollPending.resolve();
    await saveFlow;
    jestExpect(actions.at(-1)).toBe('tap');
  });
});
