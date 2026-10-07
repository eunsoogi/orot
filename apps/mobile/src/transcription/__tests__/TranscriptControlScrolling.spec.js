const {
  scrollToTranscriptControl,
} = require('../../../e2e/transcription/transcriptEvidenceDetoxHelpers');
const { expect: jestExpect } = require('@jest/globals');

describe('transcript control scrolling', () => {
  const originals = {};

  beforeEach(() => {
    originals.by = global.by;
    originals.device = global.device;
    originals.element = global.element;
    originals.expect = global.expect;
    originals.system = global.system;
    originals.waitFor = global.waitFor;
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    global.by = originals.by;
    global.device = originals.device;
    global.element = originals.element;
    global.expect = originals.expect;
    global.system = originals.system;
    global.waitFor = originals.waitFor;
    jest.restoreAllMocks();
  });

  it('observes and dismisses the open keyboard before tapping save', async () => {
    const actions = [];
    const target = {};
    const focusedInput = {};
    const keyboard = { type: 'keyboard' };
    const keyboardVisible = Promise.withResolvers();
    const swipeComplete = Promise.withResolvers();
    const focusRelease = Promise.withResolvers();
    const keyboardDismissed = Promise.withResolvers();
    const targetScroll = Promise.withResolvers();
    // Deferred UI waits expose any missing await as an early save tap.
    const scroll = jest.fn(() => {
      actions.push('scroll-target');
      return targetScroll.promise;
    });

    const flushMicrotasks = async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.resolve();
      }
    };

    global.by = {
      id: id => ({ id }),
      system: {
        type: type => ({ type }),
      },
    };
    global.system = {
      element: matcher => {
        jestExpect(matcher.type).toBe('keyboard');
        return keyboard;
      },
    };
    global.element = matcher => {
      return {
        swipe: (...args) => {
          actions.push(['user-drag', ...args]);
          return swipeComplete.promise;
        },
      };
    };
    global.expect = control => {
      if (control !== keyboard) {
        throw new Error('Expected the native system keyboard matcher.');
      }
      return {
        toExist: () => {
          actions.push('assert-keyboard-exists');
          return keyboardVisible.promise;
        },
        get not() {
          return {
            toExist: () => {
              actions.push('assert-keyboard-gone');
              return keyboardDismissed.promise;
            },
          };
        },
      };
    };
    global.device = {
      takeScreenshot: async name => {
        actions.push(`screenshot-${name}`);
        return `${name}.png`;
      },
    };
    global.waitFor = control => {
      if (control === focusedInput) {
        return {
          toBeFocused: () => ({
            withTimeout: async timeout => {
              actions.push(['wait-focused', timeout]);
            },
          }),
          not: {
            toBeFocused: () => ({
              withTimeout: timeout => {
                actions.push(['wait-unfocused', timeout]);
                return focusRelease.promise;
              },
            }),
          },
        };
      }
      return {
        toBeVisible: () => ({
          whileElement: container => {
            actions.push(['wait-target-visible', container.id]);
            return { scroll };
          },
        }),
      };
    };

    const saveFlow = scrollToTranscriptControl(target, 'up', focusedInput).then(
      () => actions.push('tap-save'),
    );
    jestExpect(actions).toEqual(['assert-keyboard-exists']);

    keyboardVisible.resolve();
    await flushMicrotasks();
    jestExpect(actions).toEqual([
      'assert-keyboard-exists',
      ['wait-focused', 5000],
      'screenshot-transcript-evidence-keyboard-open',
      ['user-drag', 'up', 'slow', 0.55, 0.5, 0.35],
    ]);

    swipeComplete.resolve();
    await flushMicrotasks();
    jestExpect(actions.at(-1)).toEqual(['wait-unfocused', 5000]);

    focusRelease.resolve();
    await flushMicrotasks();
    jestExpect(actions.at(-1)).toBe('assert-keyboard-gone');

    keyboardDismissed.resolve();
    await flushMicrotasks();
    const actionNames = actions.map(action =>
      Array.isArray(action) ? action[0] : action,
    );
    jestExpect(actionNames).toContain(
      'screenshot-transcript-evidence-keyboard-dismissed',
    );
    jestExpect(actionNames.slice(-2)).toEqual([
      'wait-target-visible',
      'scroll-target',
    ]);

    targetScroll.resolve();
    await saveFlow;
    jestExpect(actions.slice(-2)).toEqual(['scroll-target', 'tap-save']);
  });
});
