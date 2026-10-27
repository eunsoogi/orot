import { MemorySaver } from '@langchain/langgraph/web';
import { runEncounterProcessingGraph } from '../src/encounter/graph';
import type {
  EncounterApproval,
  EncounterCandidate,
  EncounterGraphPort,
  EncounterPending,
} from '../src/encounter/contracts';

const candidate: EncounterCandidate = {
  id: 'medication',
  kind: 'medication',
  text: 'Synthetic medication',
  speaker: 'unknown',
  evidence: [{ segmentId: 'segment:r1', startOffset: 0, endOffset: 4, quote: '약 언급' }],
};

function setup() {
  const transcript = {
    sourceId: 'source',
    segments: [
      {
        id: 'segment:r1',
        transcriptId: 'segment',
        revision: 1,
        text: '약 언급 이후 계획',
        effectiveAt: '2035-01-01T00:00:00Z',
        audioRange: { startMs: 10, endMs: 1000 },
      },
    ],
  };
  const port: EncounterGraphPort = {
    load: jest.fn(async () => transcript),
    extract: jest.fn(async () => [candidate]),
    conflicts: jest.fn(async () => [
      { candidateId: 'medication', recordId: 'older', description: 'Different dose', version: '1' },
    ]),
    persist: jest.fn(async () => ['record']),
  };
  const options = { threadId: 'thread', sourceId: 'source', checkpointer: new MemorySaver(), port };
  const run = (approval?: EncounterApproval, signal?: AbortSignal) =>
    runEncounterProcessingGraph({ ...options, approval, signal });
  return { run, port, transcript, options };
}

function approve(
  pending: EncounterPending,
  decision: 'approve' | 'deny' = 'approve',
): EncounterApproval {
  return {
    pending,
    decision,
    candidates: pending.candidates,
    reviewerId: 'user',
    reviewedAt: '2035-01-02T00:00:00Z',
  };
}

async function pendingOf(run: ReturnType<typeof setup>['run']) {
  const result = await run();
  if (result.status !== 'pending') throw new Error('Expected a durable confirmation interrupt');
  return result.pending;
}

describe('Encounter processing graph approval boundary', () => {
  it('interrupts with conflicts and resumes a newly compiled graph without extraction replay', async () => {
    const { run, port } = setup();
    const pending = await pendingOf(run);
    expect(pending.conflicts[0].recordId).toBe('older');
    expect(port.persist).not.toHaveBeenCalled();
    expect(await run()).toEqual({ status: 'pending', pending });
    expect(await run(approve(pending))).toEqual({ status: 'saved', recordIds: ['record'] });
    expect(await run(approve(pending))).toEqual({ status: 'saved', recordIds: ['record'] });
    expect(port.persist).toHaveBeenCalledTimes(1);
    expect(port.extract).toHaveBeenCalledTimes(1);
  });

  it('denies without writing and permits explicit text edits with the original evidence', async () => {
    const denied = setup();
    const pending = await pendingOf(denied.run);
    expect(await denied.run(approve(pending, 'deny'))).toEqual({ status: 'denied' });
    expect(denied.port.persist).not.toHaveBeenCalled();
    const edited = setup();
    const next = await pendingOf(edited.run);
    const approval = {
      ...approve(next),
      candidates: [{ ...next.candidates[0], text: 'User corrected medication' }],
    };
    expect((await edited.run(approval)).status).toBe('saved');
    expect(edited.port.persist).toHaveBeenCalledWith(next, approval, expect.any(AbortSignal));
  });

  it.each(['snapshot', 'evidence', 'speaker', 'identity'])(
    'rejects an approval with altered %s',
    async (field) => {
      const { run, port } = setup();
      const pending = await pendingOf(run);
      const approval = JSON.parse(JSON.stringify(approve(pending)));
      if (field === 'snapshot') approval.pending.conflicts = [];
      if (field === 'evidence') approval.candidates[0].evidence[0].quote = 'forged';
      if (field === 'speaker') approval.candidates[0].speaker = 'clinician';
      if (field === 'identity') approval.candidates[0].id = 'other';
      expect(await run(approval)).toEqual({ status: 'unavailable' });
      expect(port.persist).not.toHaveBeenCalled();
      expect((await run(approve(pending))).status).toBe('saved');
    },
  );

  it('rejects stale revisions and exact-quote mismatches before confirmation or persistence', async () => {
    const { run, port, transcript } = setup();
    const pending = await pendingOf(run);
    transcript.segments[0].revision = 2;
    expect((await run(approve(pending))).status).toBe('unavailable');
    expect(port.persist).not.toHaveBeenCalled();
    const invalid = setup();
    invalid.transcript.segments[0].text = 'different';
    expect((await invalid.run()).status).toBe('unavailable');
    expect(invalid.port.persist).not.toHaveBeenCalled();
  });

  it('honors cancellation before dispatch and after extraction without saving', async () => {
    const first = setup();
    const controller = new AbortController();
    controller.abort();
    expect(await first.run(undefined, controller.signal)).toEqual({ status: 'cancelled' });
    expect(first.port.load).not.toHaveBeenCalled();
    const second = setup();
    const during = new AbortController();
    second.port.extract = jest.fn(async () => {
      during.abort();
      return [candidate];
    });
    expect(await second.run(undefined, during.signal)).toEqual({ status: 'cancelled' });
    expect(second.port.persist).not.toHaveBeenCalled();
  });

  it('serializes duplicate concurrent resume requests', async () => {
    const { run, port } = setup();
    const pending = await pendingOf(run);
    const results = await Promise.all([run(approve(pending)), run(approve(pending))]);
    expect(results.map((result) => result.status)).toEqual(['saved', 'saved']);
    expect(port.persist).toHaveBeenCalledTimes(1);
  });
});
