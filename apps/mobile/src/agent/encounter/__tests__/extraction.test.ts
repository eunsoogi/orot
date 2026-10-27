import {
  encounterExtractionTask,
  extractEncounterCandidates,
} from '../extraction';
import {
  syntheticEncounterModel,
  syntheticEncounterText,
} from '../syntheticFixture';
import type { EncounterTranscript } from '@orot/agent-runtime';

const transcript: EncounterTranscript = {
  sourceId: 'source',
  segments: [
    {
      id: 'source:segment:r1',
      transcriptId: 'source:segment',
      revision: 1,
      text: syntheticEncounterText,
      effectiveAt: '2035-01-02T00:00:00Z',
      audioRange: { startMs: 100, endMs: 2900 },
    },
  ],
};

describe('Encounter extraction standard runtime boundary', () => {
  it('keeps the original extraction failure when a fixed-status observer throws', async () => {
    const synthetic = syntheticEncounterModel('source', true);
    const onDiagnostic = jest.fn(() => {
      throw new Error('observer failure');
    });
    await expect(
      extractEncounterCandidates({
        transcript,
        model: {
          ...synthetic.model,
          execution: {
            ...synthetic.model.execution,
            operationRunId: 'invalid%synthetic',
          },
        },
        isCurrent: async () => true,
        signal: new AbortController().signal,
        onDiagnostic,
      }),
    ).rejects.toThrow(
      'Encounter extraction did not produce validated candidates.',
    );
    expect(onDiagnostic.mock.calls).toEqual([
      [{ stage: 'extraction_result', category: 'workflow_invalid_output' }],
    ]);
    expect(synthetic.calls()).toBe(0);
  });

  it('does not transmit a remote transcript without exact outbound consent', async () => {
    const synthetic = syntheticEncounterModel('source', true);
    await expect(
      extractEncounterCandidates({
        transcript,
        model: {
          ...synthetic.model,
          execution: {
            ...synthetic.model.execution,
            recipient: 'selected-account',
            remoteProcessing: true,
          },
        },
        isCurrent: async () => true,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('validated candidates');
    expect(synthetic.calls()).toBe(0);
  });

  it('refuses stale source evidence after a model response', async () => {
    const synthetic = syntheticEncounterModel('source', true);
    await expect(
      extractEncounterCandidates({
        transcript,
        model: synthetic.model,
        isCurrent: async () => synthetic.calls() === 0,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('validated candidates');
    expect(synthetic.calls()).toBe(1);
  });

  it('cannot promote model-inferred clinician attribution or accept invented quotes', () => {
    const task = encounterExtractionTask(transcript);
    const proposal = {
      candidates: [
        {
          kind: 'medication',
          text: 'Synthetic medication',
          speaker: 'clinician',
          evidence: [
            {
              segmentId: 'source:segment:r1',
              startOffset: 0,
              endOffset: 3,
              quote: syntheticEncounterText.slice(0, 3),
            },
          ],
        },
      ],
    };
    const input = {
      request: 'Extract',
      evidence: { items: [], conflicts: [], coverage: [] },
    };
    expect(task.validateResult(proposal, input)).toMatchObject({
      status: 'valid',
      value: [{ speaker: 'unknown' }],
    });
    proposal.candidates[0].evidence[0].quote = 'invented';
    expect(task.validateResult(proposal, input).status).toBe('invalid');
  });

  it('refuses a source scope widened beyond the selected recording', async () => {
    const synthetic = syntheticEncounterModel('source', true);
    await expect(
      extractEncounterCandidates({
        transcript,
        model: {
          ...synthetic.model,
          execution: {
            ...synthetic.model.execution,
            allowedScope: { sourceKinds: ['personal_record'] },
          },
        },
        isCurrent: async () => true,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('exact selected recording');
    expect(synthetic.calls()).toBe(0);
  });
});
