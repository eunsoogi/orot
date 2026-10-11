const {
  runTranscriptDeletionAssertion,
} = require('../../../e2e/transcription/transcriptDeletionDetoxHelpers');
const { expect: jestExpect, jest } = require('@jest/globals');

test('uses the selected detail action and native deletion confirmation', async () => {
  const selectors = [];
  const systemTaps = [];
  const textTaps = [];
  const scrollAttempts = [];
  const sourceId = '123e4567-e89b-12d3-a456-426614174000';
  const by = {
    id: value => {
      selectors.push({ matcher: 'id', value });
      return { matcher: 'id', value };
    },
    label: value => {
      selectors.push({ matcher: 'label', value });
      return { matcher: 'label', value };
    },
    text: value => {
      selectors.push({ matcher: 'text', value });
      return { matcher: 'text', value };
    },
    system: {
      label: value => {
        selectors.push({ matcher: 'system-label', value });
        return { matcher: 'system-label', value };
      },
    },
  };
  const element = selector => ({
    selector,
    tap: async () => {
      if (selector.matcher === 'text') textTaps.push(selector.value);
    },
    getAttributes: async () =>
      selector.value === 'transcript-evidence-source-id'
        ? { text: sourceId }
        : { label: selector.value },
  });
  const waitFor = target => ({
    toBeVisible: () => ({
      withTimeout: async () => {},
      whileElement: container => ({
        scroll: async (_, direction) => {
          scrollAttempts.push({
            target: target.selector.value,
            container: container.value,
            direction,
          });
        },
      }),
    }),
    toExist: () => ({ withTimeout: async () => {} }),
    toHaveText: () => ({ withTimeout: async () => {} }),
    not: { toExist: () => ({ withTimeout: async () => {} }) },
  });
  const device = {
    terminateApp: async () => {},
    launchApp: async () => {},
  };
  const simulatorResultLog = jest
    .spyOn(console, 'log')
    .mockImplementation(() => {});
  const system = {
    element: selector => ({
      tap: async () => {
        systemTaps.push(selector);
      },
    }),
  };

  // A selected saved row hides the transcript panel's fallback delete control.
  const failure = await runTranscriptDeletionAssertion({
    by,
    device,
    element,
    system,
    waitFor,
  });
  const simulatorResultLogCalls = simulatorResultLog.mock.calls;
  simulatorResultLog.mockRestore();

  jestExpect(failure).toBeNull();
  jestExpect(simulatorResultLogCalls).toEqual([]);
  const ids = selectors
    .filter(selector => selector.matcher === 'id')
    .map(selector => selector.value);
  const labels = selectors
    .filter(selector => selector.matcher === 'label')
    .map(selector => selector.value);
  const texts = selectors
    .filter(selector => selector.matcher === 'text')
    .map(selector => selector.value);
  const systemLabels = selectors
    .filter(selector => selector.matcher === 'system-label')
    .map(selector => selector.value);
  jestExpect(ids).toContain('recording-detail-delete');
  jestExpect(ids).not.toContain('recording-transcript-delete');
  // UIKit repeats action labels on wrapper views; the inner text node stays unique.
  jestExpect(texts).toContain('녹음을 삭제할까요?');
  jestExpect(texts).toEqual(
    jestExpect.arrayContaining(['녹음을 삭제할까요?', '취소', '삭제']),
  );
  jestExpect(textTaps).toEqual(['취소', '삭제']);
  jestExpect(systemLabels).toEqual([]);
  jestExpect(systemTaps).toEqual([]);
  jestExpect(labels).not.toEqual(jestExpect.arrayContaining(['취소', '삭제']));
  jestExpect(
    scrollAttempts.every(
      attempt => attempt.container === 'recording-controls-scroll',
    ),
  ).toBe(true);
  // The seed sits below the selected detail, so the probe must return upward to its delete action.
  jestExpect(
    scrollAttempts.map(({ target, direction }) => [target, direction]),
  ).toEqual([
    ['transcript-evidence-seed-deletion', 'down'],
    ['recording-detail-delete', 'up'],
    ['recording-detail-delete', 'up'],
  ]);
});
