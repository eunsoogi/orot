import { createLocalObservationEvidenceTool, createLocalTranscriptEvidenceTool } from '../src';
import type { EvidenceItem, EvidenceSearchRequest, LocalRecordQueryService } from '../src';

const timeRange = {
  fromInclusive: '2026-10-01T00:00:00.000Z',
  toExclusive: '2026-10-02T00:00:00.000Z',
};

function searchRequest(sourceIds?: readonly string[]): EvidenceSearchRequest {
  return {
    operationRunId: 'run-local-query-1',
    operationKey: 'tool-1',
    input: {},
    allowedScope: {
      sourceKinds: ['personal_record'],
      sourceIds,
      timeRange,
    },
    resultLimit: 3,
    maxPayloadBytes: 32_000,
    signal: new AbortController().signal,
  };
}

function evidenceItem(sourceId: string, id: string, effectiveTime: string): EvidenceItem {
  return {
    sourceKind: 'personal_record',
    sourceId,
    sourceRevision: 'record-revision-1',
    evidenceId: id,
    evidenceRevision: 'evidence-revision-1',
    locator: { kind: 'structured_record', recordId: id },
    effectiveTime,
    reviewState: 'unreviewed',
    content: `Synthetic record ${id}`,
  };
}

describe('multi-agent local query adapters', () => {
  it('passes the half-open time range and budgeted limit through, preserving hasMore as truncation', async () => {
    const observation = { id: 'observation-1' };
    const queryHealthObservations = jest.fn(async () => ({
      status: 'available' as const,
      records: [observation],
      hasMore: true,
      limit: 3,
    }));
    const service = {
      queryHealthObservations,
    } as unknown as LocalRecordQueryService<typeof observation, unknown, unknown, unknown, unknown>;
    const tool = createLocalObservationEvidenceTool({
      id: 'selected-blood-pressure',
      description: 'Read selected imported blood pressure records.',
      queryType: 'blood_pressure',
      service,
      mapEvidence: (record) => evidenceItem(record.id, record.id, '2026-10-01T12:00:00Z'),
    });

    const result = await tool.search(searchRequest());

    expect(queryHealthObservations).toHaveBeenCalledWith({
      ...timeRange,
      limit: 3,
      type: 'blood_pressure',
    });
    expect(result.coverage).toEqual([
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ['observation-1'],
        requestedTimeRange: timeRange,
        gaps: [],
        truncated: true,
        resultLimit: 3,
        returnedCount: 1,
      },
    ]);
  });

  it('preserves nanosecond bounds and enforces the exact 366-day cap', async () => {
    const queryHealthObservations = jest.fn(async () => ({
      status: 'no_local_records_in_range' as const,
      records: [],
      hasMore: false,
      limit: 3,
    }));
    const service = {
      queryHealthObservations,
    } as unknown as LocalRecordQueryService<unknown, unknown, unknown, unknown, unknown>;
    const tool = createLocalObservationEvidenceTool({
      id: 'selected-blood-pressure',
      description: 'Read selected imported blood pressure records.',
      queryType: 'blood_pressure',
      service,
      mapEvidence: () => evidenceItem('record-1', 'unused', '2026-10-01T06:00:00Z'),
    });
    const oneNanosecond = {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:00:00.123400001Z',
    };
    const exactLimit = {
      fromInclusive: '2025-10-01T00:00:00.123400000Z',
      toExclusive: '2026-10-02T00:00:00.123400000Z',
    };

    await expect(
      tool.search({
        ...searchRequest(),
        allowedScope: { sourceKinds: ['personal_record'], timeRange: oneNanosecond },
      }),
    ).resolves.toMatchObject({ coverage: [{ requestedTimeRange: oneNanosecond }] });
    await expect(
      tool.search({
        ...searchRequest(),
        allowedScope: { sourceKinds: ['personal_record'], timeRange: exactLimit },
      }),
    ).resolves.toBeDefined();
    await expect(
      tool.search({
        ...searchRequest(),
        allowedScope: {
          sourceKinds: ['personal_record'],
          timeRange: {
            ...exactLimit,
            toExclusive: '2026-10-02T00:00:00.123400001Z',
          },
        },
      }),
    ).rejects.toThrow('cannot exceed 366 days');
    expect(queryHealthObservations).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the HealthKit query cannot honor a selected-record scope or a range over 366 days', async () => {
    const queryHealthObservations = jest.fn();
    const service = {
      queryHealthObservations,
    } as unknown as LocalRecordQueryService<
      { readonly id: string },
      unknown,
      unknown,
      unknown,
      unknown
    >;
    const tool = createLocalObservationEvidenceTool({
      id: 'selected-heart-rate',
      description: 'Read imported heart rate records.',
      queryType: 'heart_rate',
      service,
      mapEvidence: (record) => evidenceItem(record.id, record.id, '2026-10-01T12:00:00Z'),
    });

    await expect(tool.search(searchRequest(['specific-record-1']))).rejects.toThrow(
      'cannot narrow a read to selected record IDs',
    );
    await expect(
      tool.search({
        ...searchRequest(),
        allowedScope: {
          sourceKinds: ['personal_record'],
          timeRange: {
            fromInclusive: '2025-10-01T00:00:00Z',
            toExclusive: '2026-10-03T00:00:00Z',
          },
        },
      }),
    ).rejects.toThrow('cannot exceed 366 days');
    expect(queryHealthObservations).not.toHaveBeenCalled();
  });

  it('binds transcript reads to the selected recording source and preserves stale artifact links', async () => {
    const segment = {
      id: 'transcript-1:r2',
      recordingSourceId: 'recording-selected-1',
    };
    const queryTranscriptEvidence = jest.fn(async () => ({
      status: 'available' as const,
      records: [segment],
      hasMore: false,
      limit: 3,
      staleArtifacts: [
        {
          kind: 'evidence_span',
          id: 'span-1',
          supersededSegmentId: 'transcript-1:r1',
          currentSegmentId: 'transcript-1:r2',
          invalidatedAt: '2026-10-01T12:00:00Z',
        },
      ],
      staleArtifactsHaveMore: false,
    }));
    const service = {
      queryTranscriptEvidence,
    } as unknown as LocalRecordQueryService<unknown, unknown, unknown, unknown, typeof segment>;
    const tool = createLocalTranscriptEvidenceTool({
      id: 'selected-recording-one',
      description: 'Read current transcript revisions for the selected recording.',
      recordingSourceId: 'recording-selected-1',
      service,
      mapEvidence: (record) =>
        evidenceItem(record.recordingSourceId, record.id, '2026-10-01T12:00:00Z'),
    });

    const result = await tool.search(searchRequest(['recording-selected-1']));

    expect(queryTranscriptEvidence).toHaveBeenCalledWith({
      ...timeRange,
      limit: 3,
      recordingSourceId: 'recording-selected-1',
    });
    expect(result.coverage[0]?.searchedSourceIds).toEqual(['recording-selected-1']);
    expect(result.conflicts).toEqual([expect.stringContaining('transcript-1:r1')]);
    await expect(tool.search(searchRequest(['another-recording']))).rejects.toThrow(
      'requires its selected recording source ID in scope',
    );
    expect(queryTranscriptEvidence).toHaveBeenCalledTimes(1);
  });
});
