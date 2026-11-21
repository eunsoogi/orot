import { decodeConversationArtifact as original } from '../../../test-support/conversationDecodeOriginal';
import { serialized } from '../../../test-support/conversationDecodeFixture';
import {
  stableJson,
  utf8ByteLength,
} from '../../aiFeatures/integration/evidenceUtils';
import { decodeConversationArtifact as candidate } from '../conversationArtifactCodec';

/** Original frozen decoder is the oracle; all data is synthetic JSON. */
function parity(input: unknown) {
  const before = original(input);
  const after = candidate(input);
  expect(after).toEqual(before);
  return after;
}

test('matches source, citation, optional delivery and unknown-field decisions', () => {
  const mutations = [
    (v: any) => {
      delete v.citations;
    },
    (v: any) => {
      v.citations = [];
    },
    (v: any) => {
      v.sources = [];
    },
    (v: any) => {
      v.citations = null;
    },
    (v: any) => {
      v.citations = [null];
    },
    (v: any) => {
      v.citations[0].sourceRevision = 'foreign';
    },
    (v: any) => {
      v.sources.push(v.sources[0]);
      v.citations.reverse();
    },
    (v: any) => {
      v.citations = [v.citations[2], v.citations[0], v.citations[2]];
    },
    (v: any) => {
      v.sources[2].reference.sourceKind = 'invalid';
      v.citations = [];
    },
    (v: any) => {
      v.sources[0].reference.locator = null;
      v.citations[0].locator = null;
    },
    (v: any) => {
      v.sources[0].reference.extra = { z: [null, 1, '1', false], a: {} };
      v.citations[0].extra = { a: {}, z: [null, 1, '1', false] };
    },
    (v: any) => {
      v.sources[0].reference.extra = 1;
      v.citations[0].extra = '1';
    },
    (v: any) => {
      v.sources[0].reference.locator = ['one', { two: null }];
      v.citations[0].locator = ['one', { two: null }];
    },
    (v: any) => {
      v.delivery = { invalid: true };
    },
    (v: any) => {
      v.answer = 'a'.repeat(50000);
    },
    (v: any) => {
      v.delivery = {
        submittedAt: '2026-11-01T00:00:00Z',
        acceptedAt: '2026-11-01T00:00:01Z',
      };
    },
    (v: any) => {
      v.citations[0] = Object.fromEntries(
        Object.entries(v.citations[0]).reverse(),
      );
    },
  ];
  for (const mutate of mutations) {
    const value = JSON.parse(serialized(3));
    mutate(value);
    parity(JSON.stringify(value));
  }
  for (const value of [undefined, null, '', '{', 'null', '[]']) parity(value);
});

test('does not serialize an unused deep locator, but rejects it when reached', () => {
  const value = JSON.parse(serialized(2));
  value.sources[1].reference.locator = 'DEEP';
  value.citations = [value.sources[0].reference];
  // Construct raw JSON to avoid testing JSON.stringify recursion instead of decode.
  const input = JSON.stringify(value).replace(
    '"DEEP"',
    '['.repeat(20000) + '0' + ']'.repeat(20000),
  );
  const before = original(input);
  const after = candidate(input);
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  // Jest deep equality itself overflows here; compare every parsed node iteratively.
  const pending: [unknown, unknown][] = [[before, after]];
  while (pending.length) {
    const [left, right] = pending.pop()!;
    if (left !== null && typeof left === 'object') {
      expect(right !== null && typeof right === 'object').toBe(true);
      expect(Object.keys(right as object)).toEqual(Object.keys(left));
      for (const key of Object.keys(left))
        pending.push([
          (left as Record<string, unknown>)[key],
          (right as Record<string, unknown>)[key],
        ]);
    } else expect(right).toBe(left);
  }
  const missing = input.replace(
    '"citations":[{"sourceKind":"external_medical","sourceId":"source-0"',
    '"citations":[{"sourceKind":"external_medical","sourceId":"missing"',
  );
  expect(parity(missing)).toBeNull();
});

test('never shares mutable decoded results across invocations', () => {
  const input = serialized(3);
  const first = candidate(input)!;
  expect(Reflect.set(first.sources, 'length', 0)).toBe(true);
  expect(Reflect.set(first, 'answer', 'changed')).toBe(true);
  expect(parity(input)?.sources).toHaveLength(3);
  expect(candidate(input)?.answer).toBe('Answer');
});

test.each(['external', 'personal'])(
  'compares %s original and candidate CPU without call spying',
  kind => {
    const value = JSON.parse(serialized(1332));
    if (kind === 'personal') {
      for (const [index, source] of value.sources.entries()) {
        source.reference.sourceKind = 'personal_record';
        source.records = [
          {
            kind: 'health_observation',
            id: `synthetic-${index}`,
            revision: 'revision',
          },
        ];
        value.citations[index].sourceKind = 'personal_record';
      }
    }
    const input = JSON.stringify(value);
    const canonicalUnits = value.sources.reduce(
      (sum: number, source: { reference: unknown }) =>
        sum + stableJson(source.reference).length,
      0,
    );
    const start = performance.now();
    const before = original(input);
    const originalMs = performance.now() - start;
    const next = performance.now();
    const after = candidate(input);
    const candidateMs = performance.now() - next;
    expect(after).toEqual(before);
    console.log(
      JSON.stringify({
        synthetic: true,
        kind,
        count: 1332,
        jsonBytes: utf8ByteLength(input),
        canonicalUnits,
        originalMs,
        candidateMs,
      }),
    );
  },
);
