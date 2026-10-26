import {
  createTranscriptCorrection,
  TranscriptAudioRangeSchema,
  TranscriptEvidenceSegmentSchema,
} from '../src';

const original = {
  id: 'recording-1:segment:0:r1',
  transcriptId: 'recording-1:segment:0',
  recordingSourceId: 'recording-1',
  segmentOrdinal: 0,
  revision: 1,
  text: '복용하지 않았어요.',
  language: 'ko-KR',
  recordingDurationMs: 5000,
  audioRange: { startMs: 250, endMs: 1800 },
  effectiveAt: '2026-10-05T10:00:00.250Z',
  recordedAt: '2026-10-05T10:01:00.000Z',
  ingestedAt: '2026-10-05T10:01:00.000Z',
  provenance: {
    origin: 'derived' as const,
    sourceRecordIds: ['recording-1'],
    source: {
      system: 'Apple Speech',
      sourceIdentifier: 'dictation_transcriber',
      sourceVersion: 'Version 26.2 (Build 23C54)',
      productType: 'on-device-speech-transcription',
    },
  },
  reviewState: { status: 'unreviewed' as const },
};

describe('transcript evidence domain', () => {
  it('accepts audio-relative ranges with engine provenance and an unreviewed original', () => {
    expect(TranscriptEvidenceSegmentSchema.parse(original)).toEqual(original);
  });

  it('rejects empty, reversed, or out-of-recording audio ranges', () => {
    expect(TranscriptAudioRangeSchema.safeParse({ startMs: 50, endMs: 50 }).success).toBe(false);
    expect(TranscriptAudioRangeSchema.safeParse({ startMs: 70, endMs: 60 }).success).toBe(false);
    expect(
      TranscriptEvidenceSegmentSchema.safeParse({
        ...original,
        audioRange: { startMs: 4500, endMs: 5001 },
      }).success,
    ).toBe(false);
  });

  it('requires source-record linkage and both engine and runtime provenance', () => {
    expect(
      TranscriptEvidenceSegmentSchema.safeParse({
        ...original,
        provenance: { ...original.provenance, sourceRecordIds: [] },
      }).success,
    ).toBe(false);
    expect(
      TranscriptEvidenceSegmentSchema.safeParse({
        ...original,
        provenance: {
          ...original.provenance,
          source: { system: 'Apple Speech', sourceIdentifier: 'dictation_transcriber' },
        },
      }).success,
    ).toBe(false);
  });

  it('requires a correction to retain its prior revision and user-reported origin', () => {
    const correction = createTranscriptCorrection(
      original,
      '복용했다고 말했어요.',
      '2026-10-05T10:02:00.000Z',
    );
    expect(TranscriptEvidenceSegmentSchema.parse(correction)).toEqual(correction);
    expect(correction.provenance.source).toEqual(original.provenance.source);
    expect(correction.audioRange).toEqual(original.audioRange);
    expect(
      TranscriptEvidenceSegmentSchema.safeParse({
        ...correction,
        provenance: { ...correction.provenance, sourceRecordIds: ['recording-1'] },
      }).success,
    ).toBe(false);
    expect(
      TranscriptEvidenceSegmentSchema.safeParse({
        ...correction,
        provenance: { ...correction.provenance, origin: 'derived' },
      }).success,
    ).toBe(false);
    expect(
      TranscriptEvidenceSegmentSchema.safeParse({
        ...correction,
        reviewState: { status: 'unreviewed' },
      }).success,
    ).toBe(false);
  });
});
