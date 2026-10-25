import { Document } from '@langchain/core/documents';
import { chunkEvidenceSpan, chunkStructuredRecord, chunkTranscriptSegment } from '../src/chunking';
import type { ChunkEvidenceLocator, EvidenceChunk } from '../src/chunking';
import { documentToEvidenceChunk, evidenceChunkToDocument } from '../src';
import {
  correctedTranscript,
  currentObservation,
  medicationEvidenceSpan,
  originalTranscript,
} from './fixtures';

describe('LangChain evidence documents', () => {
  const transcriptChunk = chunkTranscriptSegment(correctedTranscript);

  it.each([
    ['transcript', transcriptChunk],
    ['evidence span', chunkEvidenceSpan(medicationEvidenceSpan)],
    ['structured record', chunkStructuredRecord('health_observation', currentObservation)],
  ] as const)('round-trips the complete %s chunk without recomputing identity', (_kind, chunk) => {
    const document = evidenceChunkToDocument(chunk);
    expect(document).toBeInstanceOf(Document);
    expect(document.id).toBe(chunk.id);
    expect(document.pageContent).toBe(chunk.text);
    expect(document.metadata).toStrictEqual(chunk.metadata);
    expect(documentToEvidenceChunk(document)).toStrictEqual(chunk);
  });

  it.each(['', '  복용 기록 🩺\n\t500 mg\r\n', 'e\u0301 and é\u0000'])(
    'preserves exact text %p',
    (text) => {
      const chunk = { ...transcriptChunk, text };
      expect(documentToEvidenceChunk(evidenceChunkToDocument(chunk))).toStrictEqual(chunk);
    },
  );

  it('keeps stable chunk IDs across corrections and preserves revision citations', () => {
    const original = evidenceChunkToDocument(chunkTranscriptSegment(originalTranscript));
    const corrected = evidenceChunkToDocument(transcriptChunk);
    expect(corrected.id).toBe(original.id);
    expect(corrected.metadata.evidenceId).not.toBe(original.metadata.evidenceId);
    expect(corrected.metadata.transcriptRevision).toStrictEqual({
      transcriptId: correctedTranscript.transcriptId,
      segmentOrdinal: correctedTranscript.segmentOrdinal,
      revision: correctedTranscript.revision,
      supersedesId: originalTranscript.id,
    });
    expect(documentToEvidenceChunk(corrected)).toStrictEqual(transcriptChunk);
  });

  const locators: ChunkEvidenceLocator[] = [
    { kind: 'audio_time_range', startMs: 0, endMs: 133000 },
    { kind: 'text_range', startOffset: 0, endOffset: 20 },
    { kind: 'document_range', pageNumber: 2, startOffset: 4, endOffset: 30 },
    { kind: 'structured_record', recordId: 'synthetic-record' },
  ];
  it.each(locators)('preserves citation coordinates for $kind', (evidenceLocator) => {
    const chunk = {
      ...transcriptChunk,
      metadata: { ...transcriptChunk.metadata, evidenceLocator },
    };
    expect(documentToEvidenceChunk(evidenceChunkToDocument(chunk))).toStrictEqual(chunk);
  });

  it('retains null time, explicit undefined, encounter links, and review details', () => {
    const chunk: EvidenceChunk = {
      ...transcriptChunk,
      metadata: {
        ...transcriptChunk.metadata,
        effectiveTime: null,
        encounterId: 'synthetic-encounter',
        transcriptRevision: undefined,
        reviewState: { status: 'needs_review', reason: 'Synthetic unresolved source' },
      },
    };
    expect(documentToEvidenceChunk(evidenceChunkToDocument(chunk))).toStrictEqual(chunk);
    const noOptionalFields = chunkEvidenceSpan(medicationEvidenceSpan);
    expect(documentToEvidenceChunk(evidenceChunkToDocument(noOptionalFields))).toStrictEqual(
      noOptionalFields,
    );
  });

  it.each(['deleted', 'stale'] as const)(
    'preserves opaque %s source markers and provenance',
    (state) => {
      // The chunk contract has no lifecycle schema: these caller-owned extension fields
      // exercise lossless transport, without introducing new retrieval eligibility rules.
      const chunk = {
        ...transcriptChunk,
        metadata: {
          ...transcriptChunk.metadata,
          sourceState: state,
          deleted: state === 'deleted',
          stale: state === 'stale',
          sourceMarkers: [{ sourceId: transcriptChunk.metadata.sourceId, state }],
          invalidatedAt: null,
        },
      };
      const document = evidenceChunkToDocument(chunk);
      expect(document.metadata.sourceState).toBe(state);
      expect(documentToEvidenceChunk(document)).toStrictEqual(chunk);
      // Standard JSON document storage must retain markers as well as citation fields.
      const restored = new Document<typeof chunk.metadata>(JSON.parse(JSON.stringify(document)));
      expect(documentToEvidenceChunk(restored)).toStrictEqual(chunk);
    },
  );

  it('isolates mutable Document metadata from the source chunk in both directions', () => {
    const chunk = {
      ...transcriptChunk,
      metadata: {
        ...transcriptChunk.metadata,
        sourceRecordIds: [...transcriptChunk.metadata.sourceRecordIds],
        sourceMarkers: [{ state: 'stale' }],
      },
    };
    const document = evidenceChunkToDocument(chunk);
    document.metadata.sourceRecordIds.push('synthetic-extra-source');
    document.metadata.sourceMarkers[0].state = 'deleted';
    expect(chunk.metadata.sourceRecordIds).toEqual(transcriptChunk.metadata.sourceRecordIds);
    expect(chunk.metadata.sourceMarkers).toEqual([{ state: 'stale' }]);
    expect(document.metadata.evidenceLocator).not.toBe(chunk.metadata.evidenceLocator);
    expect(document.metadata.reviewState).not.toBe(chunk.metadata.reviewState);
    expect(document.metadata.transcriptRevision).not.toBe(chunk.metadata.transcriptRevision);

    const restored = documentToEvidenceChunk(document);
    restored.metadata.sourceRecordIds.push('another-synthetic-source');
    restored.metadata.sourceMarkers[0].state = 'current';
    expect(document.metadata.sourceRecordIds).not.toContain('another-synthetic-source');
    expect(document.metadata.sourceMarkers).toEqual([{ state: 'deleted' }]);
  });

  it('rejects a missing Document ID without exposing evidence text', () => {
    const document = new Document({
      pageContent: 'Synthetic private evidence',
      metadata: transcriptChunk.metadata,
    });
    expect(() => documentToEvidenceChunk(document)).toThrow(
      'An evidence document must retain its chunk ID.',
    );
  });
});
