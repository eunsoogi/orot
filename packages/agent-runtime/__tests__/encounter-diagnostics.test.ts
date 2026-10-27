import { MemorySaver } from '@langchain/langgraph/web';
import { runEncounterProcessingGraph } from '../src/encounter/graph';
import type { EncounterGraphOptions } from '../src/encounter/contracts';

function setup() {
  const options: EncounterGraphOptions = {
    sourceId: 'synthetic-source',
    threadId: 'synthetic-thread',
    checkpointer: new MemorySaver(),
    port: {
      load: jest.fn(async () => ({
        sourceId: 'synthetic-source',
        segments: [
          {
            id: 'segment',
            transcriptId: 'transcript',
            revision: 1,
            text: 'synthetic',
            effectiveAt: '2035-01-01T00:00:00Z',
            audioRange: { startMs: 0, endMs: 1000 },
          },
        ],
      })),
      extract: jest.fn(async () => []),
      conflicts: jest.fn(async () => []),
      persist: jest.fn(async () => []),
    },
  };
  return options;
}

test('opt-in pending snapshot is identical and still stops before explicit approval', async () => {
  const plain = setup();
  const observed = setup();
  const onDiagnostic = jest.fn();
  const original = await runEncounterProcessingGraph(plain);
  expect(original.status).toBe('pending');
  expect(await runEncounterProcessingGraph({ ...observed, onDiagnostic })).toEqual(original);
  expect(onDiagnostic).not.toHaveBeenCalled();
  expect(observed.port.extract).toHaveBeenCalledTimes(1);
  expect(observed.port.persist).not.toHaveBeenCalled();
});

test.each(['load', 'extract', 'conflicts'] as const)(
  'retains the earliest %s failure before graph normalization',
  async (method) => {
    const options = setup();
    jest
      .mocked(options.port[method])
      .mockRejectedValue(new TypeError('secret transcript SQL prompt'));
    const onDiagnostic = jest.fn();
    expect(await runEncounterProcessingGraph({ ...options, onDiagnostic })).toEqual({
      status: 'unavailable',
    });
    expect(onDiagnostic.mock.calls).toEqual([
      [
        {
          stage: {
            load: 'load_transcript',
            extract: 'extract_candidates',
            conflicts: 'detect_conflicts',
          }[method],
          category: 'type_error',
        },
      ],
    ]);
    expect(options.port.persist).not.toHaveBeenCalled();
  },
);

test('checkpoint read errors and explicit source mismatch remain distinct', async () => {
  const broken = setup();
  jest.spyOn(broken.checkpointer, 'getTuple').mockRejectedValue(new RangeError('private SQL'));
  const first = jest.fn();
  expect((await runEncounterProcessingGraph({ ...broken, onDiagnostic: first })).status).toBe(
    'unavailable',
  );
  expect(first.mock.calls).toEqual([[{ stage: 'checkpoint_read', category: 'range_error' }]]);
  const mismatch = setup();
  await runEncounterProcessingGraph(mismatch);
  const second = jest.fn();
  expect(
    (
      await runEncounterProcessingGraph({
        ...mismatch,
        sourceId: 'another-source',
        onDiagnostic: second,
      })
    ).status,
  ).toBe('unavailable');
  expect(second.mock.calls).toEqual([[{ stage: 'checkpoint_source', category: 'unavailable' }]]);
});

test('a throwing observer and an opaque thrown value preserve the original unavailable outcome', async () => {
  const options = setup();
  jest.mocked(options.port.extract).mockRejectedValue({ message: 'private', cause: 'SQL' });
  const onDiagnostic = jest.fn(() => {
    throw new Error('observer failure');
  });
  expect(await runEncounterProcessingGraph({ ...options, onDiagnostic })).toEqual({
    status: 'unavailable',
  });
  expect(onDiagnostic.mock.calls).toEqual([[{ stage: 'extract_candidates', category: 'UNKNOWN' }]]);
  const plain = setup();
  jest.mocked(plain.port.extract).mockRejectedValue({ message: 'private', cause: 'SQL' });
  expect(await runEncounterProcessingGraph(plain)).toEqual({ status: 'unavailable' });
});
