const {
  runTranscriptDeletionAssertion,
} = require('../../../e2e/transcription/transcriptDeletionDetoxHelpers');
const { expect: jestExpect } = require('@jest/globals');

test('uses the selected detail action and native deletion confirmation', async () => {
  const selectors = [];
  const scrollContainerIds = [];
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
  };
  const element = selector => ({
    tap: async () => {},
    getAttributes: async () =>
      selector.value === 'transcript-evidence-source-id'
        ? { text: sourceId }
        : { label: selector.value },
  });
  const waitFor = () => ({
    toBeVisible: () => ({
      withTimeout: async () => {},
      whileElement: container => ({
        scroll: async () => {
          scrollContainerIds.push(container.value);
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

  // A selected saved row hides the transcript panel's fallback delete control.
  const failure = await runTranscriptDeletionAssertion({
    by,
    device,
    element,
    waitFor,
  });

  jestExpect(failure).toBeNull();
  const ids = selectors
    .filter(selector => selector.matcher === 'id')
    .map(selector => selector.value);
  const labels = selectors
    .filter(selector => selector.matcher === 'label')
    .map(selector => selector.value);
  jestExpect(ids).toContain('recording-detail-delete');
  jestExpect(ids).not.toContain('recording-transcript-delete');
  jestExpect(labels).toEqual(
    jestExpect.arrayContaining(['녹음을 삭제할까요?', '취소', '삭제']),
  );
  jestExpect(
    scrollContainerIds.every(id => id === 'recording-controls-scroll'),
  ).toBe(true);
});
