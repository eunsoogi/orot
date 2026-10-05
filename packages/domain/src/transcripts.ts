import { z } from 'zod';
import { RecordIdSchema, RecordMetadataSchema, TimestampSchema } from './common';

const NonEmptyTextSchema = z.string().trim().min(1);
const NonNegativeIntegerSchema = z.number().int().min(0);
const PositiveIntegerSchema = z.number().int().positive();

/** Audio offsets are zero-based milliseconds from recording start, with a half-open end. */
export const TranscriptAudioRangeSchema = z
  .strictObject({
    startMs: NonNegativeIntegerSchema,
    endMs: PositiveIntegerSchema,
  })
  .superRefine((range, context) => {
    if (range.endMs <= range.startMs) {
      context.addIssue({
        code: 'custom',
        path: ['endMs'],
        message: 'A transcript audio range must end after it starts.',
      });
    }
  });

export const TranscriptEvidenceSegmentSchema = RecordMetadataSchema.safeExtend({
  transcriptId: RecordIdSchema,
  recordingSourceId: RecordIdSchema,
  segmentOrdinal: NonNegativeIntegerSchema,
  revision: PositiveIntegerSchema,
  supersedesId: RecordIdSchema.optional(),
  text: NonEmptyTextSchema,
  language: NonEmptyTextSchema,
  recordingDurationMs: PositiveIntegerSchema,
  audioRange: TranscriptAudioRangeSchema,
}).superRefine((segment, context) => {
  if (segment.id !== `${segment.transcriptId}:r${segment.revision}`) {
    context.addIssue({
      code: 'custom',
      path: ['id'],
      message: 'A transcript revision ID must match its stable transcript ID and revision.',
    });
  }

  if (segment.audioRange.endMs > segment.recordingDurationMs) {
    context.addIssue({
      code: 'custom',
      path: ['audioRange', 'endMs'],
      message: 'A transcript audio range must stay within its recording.',
    });
  }

  if (!segment.provenance.sourceRecordIds.includes(segment.recordingSourceId)) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'sourceRecordIds'],
      message: 'A transcript must identify its recording source.',
    });
  }

  if (segment.revision === 1) {
    if (segment.supersedesId !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesId'],
        message: 'The first transcript revision cannot supersede another record.',
      });
    }
    if (segment.provenance.origin !== 'derived') {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'origin'],
        message: 'An original transcript segment must retain its derived origin.',
      });
    }
    if (segment.reviewState.status !== 'unreviewed') {
      context.addIssue({
        code: 'custom',
        path: ['reviewState'],
        message: 'A machine-generated transcript must begin unreviewed.',
      });
    }
  } else {
    if (!segment.supersedesId) {
      context.addIssue({
        code: 'custom',
        path: ['supersedesId'],
        message: 'A corrected transcript revision must identify the prior revision.',
      });
    } else if (!segment.provenance.sourceRecordIds.includes(segment.supersedesId)) {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'sourceRecordIds'],
        message: 'A corrected transcript must preserve its prior revision as a source.',
      });
    }
    if (segment.provenance.origin !== 'user_reported') {
      context.addIssue({
        code: 'custom',
        path: ['provenance', 'origin'],
        message: 'A user-corrected transcript must retain its user-reported origin.',
      });
    }
    if (segment.reviewState.status !== 'needs_review') {
      context.addIssue({
        code: 'custom',
        path: ['reviewState'],
        message: 'A user correction must remain marked for review.',
      });
    }
  }

  if (!segment.provenance.source?.sourceIdentifier) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'source', 'sourceIdentifier'],
      message: 'A transcript must identify the selected speech engine.',
    });
  }
  if (!segment.provenance.source?.sourceVersion) {
    context.addIssue({
      code: 'custom',
      path: ['provenance', 'source', 'sourceVersion'],
      message: 'A transcript must identify the speech runtime version.',
    });
  }
});

/** Append a user correction while retaining the engine and audio evidence that produced the original. */
export function createTranscriptCorrection(
  previous: TranscriptEvidenceSegment,
  text: string,
  recordedAt: string,
): TranscriptEvidenceSegment {
  const timestamp = TimestampSchema.parse(recordedAt);
  const revision = previous.revision + 1;
  return TranscriptEvidenceSegmentSchema.parse({
    ...previous,
    id: `${previous.transcriptId}:r${revision}`,
    revision,
    supersedesId: previous.id,
    text,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: {
      ...previous.provenance,
      origin: 'user_reported',
      sourceRecordIds: [...new Set([...previous.provenance.sourceRecordIds, previous.id])],
    },
    reviewState: {
      status: 'needs_review',
      reason: 'Transcript text was corrected by the user.',
    },
  });
}

export type TranscriptAudioRange = z.infer<typeof TranscriptAudioRangeSchema>;
export type TranscriptEvidenceSegment = z.infer<typeof TranscriptEvidenceSegmentSchema>;
