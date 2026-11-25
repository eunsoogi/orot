import type {
  EncounterCandidate,
  EncounterTranscript,
} from '@orot/agent-runtime';
import type { TranscriptEvidenceSegment } from '@orot/domain';
import { extractLocalTranscriptPages } from '../extractLocalTranscriptPages';

const source = 'synthetic-recording';
const makeRows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `segment-${i}:r2`,
    transcriptId: `synthetic-${i}`,
    revision: 2,
    recordingSourceId: source,
    segmentOrdinal: i,
    text: `Synthetic transcript line ${i}.`,
    effectiveAt: '2035-01-01T00:00:00Z',
    audioRange: { startMs: i * 100, endMs: (i + 1) * 100 },
  })) as TranscriptEvidenceSegment[];

function fixture(count: number) {
  const rows = makeRows(count);
  const stop = new AbortController();
  const native = new AbortController();
  let cursor = 0;
  let alive = true;
  const dispose = jest.fn();
  const next = jest.fn(async () => {
    const segments = rows.slice(cursor, cursor + 16);
    cursor += segments.length;
    return segments.length ? { segments, done: cursor === rows.length } : null;
  });
  return {
    stop,
    native,
    rows,
    retire: () => (alive = false),
    options: {
      sourceId: source,
      signal: stop.signal,
      selectionCurrent: () => alive,
      pages: {
        signal: native.signal,
        next,
        dispose,
        confirm: jest.fn(async () => alive && !native.signal.aborted),
      },
    },
  };
}

function candidate(
  segment: EncounterTranscript['segments'][number],
): EncounterCandidate {
  return {
    id: 'model-local-id-reused',
    kind: 'plan',
    speaker: 'unknown',
    text: 'Synthetic follow-up candidate.',
    evidence: [
      {
        segmentId: segment.id,
        startOffset: 0,
        endOffset: segment.text.length,
        quote: segment.text,
      },
    ],
  };
}

test('collects all 145 source references and final evidence, with non-repeating request and candidate IDs', async () => {
  const f = fixture(145);
  const extract = jest.fn(async (batch: EncounterTranscript) => {
    const first = candidate(batch.segments[0]!);
    if (batch.segments.length === 1) return [first];
    return [first, { ...first, id: 'duplicate-with-separate-model-id' }];
  });
  const result = await extractLocalTranscriptPages({ ...f.options, extract });
  if (result.status !== 'complete')
    throw new Error('Incomplete synthetic read.');
  expect(result.segments.map(value => value.id)).toEqual(
    f.rows.map(row => row.id),
  );
  expect(result.segments.at(-1)).not.toHaveProperty('text');
  expect(result.candidates.map(value => value.id)).toEqual(
    Array.from({ length: 19 }, (_, i) => 'candidate-' + i),
  );
  expect(result.candidates.at(-1)?.evidence[0]).toMatchObject({
    segmentId: f.rows[144]!.id,
    quote: f.rows[144]!.text,
  });
  expect(
    extract.mock.calls.every(([batch]) => batch.segments.length <= 8),
  ).toBe(true);
  expect(f.options.pages.dispose).toHaveBeenCalledTimes(1);
});

test.each([
  'cancelled',
  'selection',
  'native',
  'wrong-evidence',
  'truncated',
] as const)(
  '%s discards all accumulated output and does not repeat a known page',
  async failure => {
    const f = fixture(65);
    if (failure === 'truncated') {
      f.options.pages.next
        .mockResolvedValueOnce({ segments: f.rows.slice(0, 16), done: false })
        .mockResolvedValueOnce(null);
    }
    const extract = jest.fn(
      async (batch: EncounterTranscript, index: number) => {
        if (index === 1) {
          if (failure === 'cancelled') f.stop.abort();
          if (failure === 'selection') f.retire();
          if (failure === 'native') f.native.abort();
          if (failure === 'wrong-evidence') return [candidate(f.rows[0]!)];
        }
        return [candidate(batch.segments[0]!)];
      },
    );
    expect(
      await extractLocalTranscriptPages({ ...f.options, extract }),
    ).toEqual({
      status: failure === 'cancelled' ? 'cancelled' : 'unavailable',
    });
    expect(extract.mock.calls.map(([, index]) => index)).toEqual([0, 1]);
    expect(f.options.pages.dispose).toHaveBeenCalledTimes(1);
  },
);

test('empty is explicit and never calls extraction', async () => {
  const f = fixture(0);
  const extract = jest.fn();
  expect(await extractLocalTranscriptPages({ ...f.options, extract })).toEqual({
    status: 'empty',
  });
  expect(extract).not.toHaveBeenCalled();
});
