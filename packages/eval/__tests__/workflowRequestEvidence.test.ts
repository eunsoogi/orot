import { describe, expect, it } from '@jest/globals';

const {
  evidenceFromRequest,
} = require('../../../scripts/evaluation/visit-questions/scripted-provider.cjs');

// These synthetic records prove transport resolution, not model grounding quality.
const first = { evidenceId: 'opaque-first', sourceKind: 'personal_record', content: '합성 기록' };
const second = {
  evidenceId: 'opaque-second',
  sourceKind: 'reviewed_memory',
  content: '합성 메모리',
};
const request = (items: unknown[], results: unknown[]) => ({
  messages: [
    { role: 'user', content: `Available evidence: ${JSON.stringify(items)}` },
    ...results.map((result) => ({ role: 'tool', result })),
  ],
});
const refs = (ids: string[]) => ({ contentLocation: 'current_task_messages', evidenceIds: ids });

describe('synthetic evaluation evidence transport', () => {
  it('resolves multiple reference-only tools from current evidence, excluding unreturned items', () => {
    const unused = { ...first, evidenceId: 'not-returned' };
    expect(
      evidenceFromRequest(
        request(
          [first, second, unused],
          [refs([first.evidenceId]), JSON.stringify(refs([second.evidenceId]))],
        ),
      ),
    ).toEqual([first, second]);
  });

  it('preserves full-batch tool results', () => {
    expect(
      evidenceFromRequest(request([], [{ items: [first] }, JSON.stringify({ items: [second] })])),
    ).toEqual([first, second]);
  });

  it('does not infer evidence from a user message or an unknown content location', () => {
    expect(evidenceFromRequest(request([first], []))).toEqual([]);
    expect(
      evidenceFromRequest(
        request([first], [{ ...refs([first.evidenceId]), contentLocation: 'other' }]),
      ),
    ).toEqual([]);
  });

  it.each([{ items: [] }, { items: [first, first] }])(
    'rejects missing or ambiguous current references: %j',
    ({ items }) => {
      expect(() => evidenceFromRequest(request(items, [refs([first.evidenceId])]))).toThrow(
        'A tool evidence reference must resolve to one current task item.',
      );
    },
  );
});
