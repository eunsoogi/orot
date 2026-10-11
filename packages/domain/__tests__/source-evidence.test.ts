import { describe, expect, it } from '@jest/globals';
import {
  EvidenceSpanLocatorSchema,
  EvidenceSpanSchema,
  SourceContentHashSchema,
  SourceRecordSchema,
} from '../src';
import { metadata } from './fixtures';

describe('source content hashes and evidence locators', () => {
  it('accepts canonical SHA-256 source hashes and rejects ambiguous encodings', () => {
    const hash = 'sha256:' + 'a'.repeat(64);
    const source = SourceRecordSchema.parse({
      ...metadata('source-hash-1'),
      sourceKind: 'other',
      contentHash: hash,
    });

    expect(source.contentHash).toBe(hash);
    expect(SourceContentHashSchema.safeParse('sha256:' + 'A'.repeat(64)).success).toBe(false);
    expect(SourceContentHashSchema.safeParse('sha256:' + 'a'.repeat(63)).success).toBe(false);
  });

  it('accepts an audio recording as a source kind', () => {
    const source = SourceRecordSchema.parse({
      ...metadata('audio-source-1'),
      sourceKind: 'audio_recording',
    });

    expect(source.sourceKind).toBe('audio_recording');
  });

  it('stores a measured duration only on audio recording sources', () => {
    const audio = SourceRecordSchema.parse({
      ...metadata('audio-duration-1'),
      sourceKind: 'audio_recording',
      recordingDurationMs: 12500,
    });

    expect(audio.recordingDurationMs).toBe(12500);
    expect(
      SourceRecordSchema.safeParse({
        ...audio,
        recordingDurationMs: -1,
      }).success,
    ).toBe(false);
    expect(
      SourceRecordSchema.safeParse({
        ...metadata('note-duration-1'),
        sourceKind: 'user_note',
        recordingDurationMs: 12500,
      }).success,
    ).toBe(false);
  });

  it('accepts audio, text, and document ranges with explicit coordinates', () => {
    const locators = [
      { kind: 'audio_time_range', startMs: 0, endMs: 1250 },
      { kind: 'text_range', startOffset: 0, endOffset: 24 },
      { kind: 'document_range', pageNumber: 2, startOffset: 4, endOffset: 12 },
    ];

    locators.forEach((locator) => {
      expect(EvidenceSpanLocatorSchema.safeParse(locator).success).toBe(true);
    });
  });

  it('rejects empty, reversed, and negative evidence ranges', () => {
    expect(
      EvidenceSpanLocatorSchema.safeParse({
        kind: 'audio_time_range',
        startMs: 250,
        endMs: 250,
      }).success,
    ).toBe(false);
    expect(
      EvidenceSpanLocatorSchema.safeParse({
        kind: 'text_range',
        startOffset: 8,
        endOffset: 7,
      }).success,
    ).toBe(false);
    expect(
      EvidenceSpanLocatorSchema.safeParse({
        kind: 'document_range',
        pageNumber: 0,
        startOffset: 0,
        endOffset: 1,
      }).success,
    ).toBe(false);
  });

  it('keeps legacy spans readable while validating locators when present', () => {
    const legacySpan = {
      ...metadata('evidence-legacy-1', {
        provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
      }),
      sourceRecordId: 'source-1',
      text: 'Synthetic extracted excerpt.',
    };
    const locatedSpan = {
      ...legacySpan,
      locator: { kind: 'document_range', pageNumber: 3, startOffset: 10, endOffset: 38 },
    };

    expect(EvidenceSpanSchema.safeParse(legacySpan).success).toBe(true);
    expect(EvidenceSpanSchema.parse(locatedSpan).locator).toEqual(locatedSpan.locator);
    expect(
      SourceRecordSchema.safeParse({
        ...metadata('derived-source-1', {
          provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
        }),
        sourceKind: 'other',
        contentHash: 'sha256:' + 'b'.repeat(64),
      }).success,
    ).toBe(false);
  });

  it('rejects a document locator that conflicts with the legacy page number', () => {
    const span = {
      ...metadata('evidence-page-conflict-1', {
        provenance: { origin: 'derived', sourceRecordIds: ['source-1'] },
      }),
      sourceRecordId: 'source-1',
      text: 'Synthetic extracted excerpt.',
      pageNumber: 1,
      locator: { kind: 'document_range', pageNumber: 2, startOffset: 0, endOffset: 7 },
    };

    expect(EvidenceSpanSchema.safeParse(span).success).toBe(false);
    expect(
      EvidenceSpanSchema.safeParse({
        ...span,
        pageNumber: 2,
      }).success,
    ).toBe(true);

    const legacyOnlySpan = { ...span, pageNumber: 1 };
    delete (legacyOnlySpan as { locator?: unknown }).locator;
    expect(EvidenceSpanSchema.safeParse(legacyOnlySpan).success).toBe(true);
  });
});
