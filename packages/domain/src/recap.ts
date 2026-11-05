import { z } from 'zod';
import { RecordIdSchema } from './common';
import { TranscriptAudioRangeSchema, TranscriptEvidenceSegmentSchema } from './transcripts';

/** A trusted caller supplies visit association; transcript text cannot choose its own visit. */
export const RecapInputSchema = z
  .strictObject({
    recordingSourceId: RecordIdSchema,
    appointmentId: RecordIdSchema,
    binding: z.strictObject({ fingerprint: RecordIdSchema, version: z.number().int().positive() }),
    questions: z
      .array(
        z.strictObject({
          id: RecordIdSchema,
          appointmentId: RecordIdSchema,
          questionText: z.string().trim().min(1).max(2000),
          revision: RecordIdSchema,
        }),
      )
      .max(5),
    segments: z.array(TranscriptEvidenceSegmentSchema).min(1).max(4096),
  })
  .superRefine((input, context) => {
    if (
      new Set(input.questions.map((question) => question.id)).size !== input.questions.length ||
      input.questions.some((question) => question.appointmentId !== input.appointmentId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['questions'],
        message: 'Questions must uniquely belong to the selected visit.',
      });
    }
    if (
      new Set(input.segments.map((segment) => segment.transcriptId)).size !==
        input.segments.length ||
      input.segments.some((segment) => segment.recordingSourceId !== input.recordingSourceId)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'Use one current revision per segment from the selected recording.',
      });
    }
  });

/** Text offsets are half-open UTF-16 units; audio bounds retain the source segment's measured milliseconds. */
export const RecapEvidenceSchema = z
  .strictObject({
    segmentId: RecordIdSchema,
    transcriptId: RecordIdSchema,
    revision: z.number().int().positive(),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    quote: z.string().min(1),
    audioRange: TranscriptAudioRangeSchema,
  })
  .refine(
    (evidence) => evidence.endOffset > evidence.startOffset,
    'Evidence must have a nonempty text range.',
  );

export const RecapQuestionResultSchema = z
  .strictObject({
    questionId: RecordIdSchema,
    // not_found describes this transcript only; it never asserts that a question was not asked.
    status: z.enum(['evidence_found', 'not_found', 'indeterminate']),
    questionEvidence: z.array(RecapEvidenceSchema).max(64),
    answers: z
      .array(
        z.strictObject({
          quotation: z.string().min(1),
          summary: z.string().trim().min(1).max(4000),
          // Apple Speech provides no authenticated diarization. Model guesses cannot promote a speaker.
          speaker: z.literal('unknown'),
          // This is a contextual inference, not authenticated clinician identity or a confirmed medical fact.
          inferredRole: z.enum(['likely_clinician', 'uncertain']),
          speakerUncertainty: z.string().trim().min(1).max(1000),
          evidence: z.array(RecapEvidenceSchema).min(1).max(16),
        }),
      )
      .max(64),
  })
  .superRefine((result, context) => {
    if (
      (result.status === 'evidence_found' && !result.questionEvidence.length) ||
      (result.status !== 'evidence_found' && result.answers.length > 0) ||
      (result.status === 'not_found' && result.questionEvidence.length > 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Question status, evidence and answers must agree.',
      });
    }
  });

export const RecapResultSchema = z.strictObject({
  recordingSourceId: RecordIdSchema,
  appointmentId: RecordIdSchema,
  binding: z.strictObject({ fingerprint: RecordIdSchema, version: z.number().int().positive() }),
  providerId: RecordIdSchema,
  modelId: RecordIdSchema,
  promptVersion: z.literal('transcript-recap-v1'),
  chunkCount: z.number().int().positive(),
  preparedQuestions: z
    .array(
      z.strictObject({
        id: RecordIdSchema,
        questionText: z.string().min(1),
        revision: RecordIdSchema,
      }),
    )
    .min(1)
    .max(5),
  sources: z
    .array(
      z.strictObject({
        segmentId: RecordIdSchema,
        transcriptId: RecordIdSchema,
        revision: z.number().int().positive(),
        audioRange: TranscriptAudioRangeSchema,
      }),
    )
    .min(1),
  questions: z.array(RecapQuestionResultSchema).min(1).max(5),
});

export type RecapInput = z.infer<typeof RecapInputSchema>;
export type RecapEvidence = z.infer<typeof RecapEvidenceSchema>;
export type RecapQuestionResult = z.infer<typeof RecapQuestionResultSchema>;
export const RecapBindingSchema = RecapInputSchema.shape.binding;
export const RecapPreparedQuestionSchema = RecapResultSchema.shape.preparedQuestions.element;
export const RecapSourceSchema = RecapResultSchema.shape.sources.element;

export type RecapResult = z.infer<typeof RecapResultSchema>;

/** Downstream writes must call this inside their source-validation/write transaction, never trust a cached success. */
export function isRecapResultCurrent(result: RecapResult, current: RecapInput): boolean {
  const parsed = RecapInputSchema.safeParse(current);
  if (
    !parsed.success ||
    !RecapResultSchema.safeParse(result).success ||
    new Set(result.sources.map((source) => source.segmentId)).size !== result.sources.length ||
    new Set(result.preparedQuestions.map((question) => question.id)).size !==
      result.preparedQuestions.length ||
    new Set(result.questions.map((question) => question.questionId)).size !==
      result.preparedQuestions.length ||
    result.questions.length !== result.preparedQuestions.length ||
    !result.questions.every((question) =>
      result.preparedQuestions.some((prepared) => prepared.id === question.questionId),
    ) ||
    result.recordingSourceId !== current.recordingSourceId ||
    result.appointmentId !== current.appointmentId ||
    result.sources.length !== current.segments.length ||
    result.binding.fingerprint !== current.binding.fingerprint ||
    result.binding.version !== current.binding.version ||
    result.preparedQuestions.length !== current.questions.length
  )
    return false;
  return (
    result.sources.every((source) =>
      current.segments.some(
        (segment) =>
          source.segmentId === segment.id &&
          source.transcriptId === segment.transcriptId &&
          source.revision === segment.revision &&
          source.audioRange.startMs === segment.audioRange.startMs &&
          source.audioRange.endMs === segment.audioRange.endMs,
      ),
    ) &&
    result.questions.every(
      (question) =>
        question.answers.every(
          (answer) =>
            answer.quotation === answer.evidence.map((evidence) => evidence.quote).join('\n'),
        ) &&
        [
          ...question.questionEvidence,
          ...question.answers.flatMap((answer) => answer.evidence),
        ].every((evidence) => {
          const segment = current.segments.find((item) => item.id === evidence.segmentId);
          return (
            segment &&
            segment.transcriptId === evidence.transcriptId &&
            segment.revision === evidence.revision &&
            evidence.startOffset < segment.text.length &&
            evidence.endOffset <= segment.text.length &&
            segment.text.slice(evidence.startOffset, evidence.endOffset) === evidence.quote &&
            evidence.audioRange.startMs === segment.audioRange.startMs &&
            evidence.audioRange.endMs === segment.audioRange.endMs
          );
        }),
    ) &&
    result.preparedQuestions.every((question) =>
      current.questions.some(
        (item) =>
          question.id === item.id &&
          question.questionText === item.questionText &&
          question.revision === item.revision,
      ),
    )
  );
}
