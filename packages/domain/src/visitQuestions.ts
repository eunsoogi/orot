import { z } from 'zod';
import { RecordIdSchema, RecordMetadataSchema } from './common';
import { VisitQuestionHealthContextSourceSchema } from './visitQuestionHealthContext';

const NonEmptyTextSchema = z.string().trim().min(1);
const UniqueRecordIdsSchema = z
  .array(RecordIdSchema)
  .refine((ids) => new Set(ids).size === ids.length, 'Record IDs must be unique.');
const GeneratedArtifactSourceSchema = z
  .strictObject({
    kind: z.enum(['generated_summary', 'generated_conversation', 'generated_research']),
    type: z.enum([
      'symptom_summary',
      'disease_possibilities',
      'daily_report',
      'conversation_turn',
      'research_publication',
      'research_web_explanation',
    ]),
    id: RecordIdSchema,
    revision: z.string().min(1),
  })
  .refine(
    (source) =>
      (source.kind === 'generated_summary' &&
        (source.type === 'symptom_summary' ||
          source.type === 'disease_possibilities' ||
          source.type === 'daily_report')) ||
      (source.kind === 'generated_conversation' && source.type === 'conversation_turn') ||
      (source.kind === 'generated_research' &&
        (source.type === 'research_publication' || source.type === 'research_web_explanation')),
    'Generated artifact kind and type must agree.',
  );
const GeneratedArtifactSourcesSchema = z
  .array(GeneratedArtifactSourceSchema)
  .max(3)
  .refine(
    (sources) =>
      new Set(sources.map((source) => `${source.kind}\u0000${source.id}`)).size === sources.length,
    'Generated artifact sources must be unique.',
  );

export const VisitQuestionSchema = RecordMetadataSchema.safeExtend({
  questionText: NonEmptyTextSchema,
  priority: z.enum(['routine', 'important']),
  // Missing kind denotes a legacy, source-backed question, never a new clarification.
  kind: z.enum(['confirmed_fact', 'clarification']).optional(),
  evidenceSpanIds: UniqueRecordIdsSchema,
  // Older lists have only quote spans. New computed citations retain their fixed period and revision.
  healthContextSources: z.array(VisitQuestionHealthContextSourceSchema).min(1).max(3).optional(),
  // Optional fields keep older saved questions readable; new reviewed lists use the required schema below.
  appointmentId: RecordIdSchema.optional(),
  // Generated parents stay typed historical AI output and never become clinical facts.
  generatedArtifactSources: GeneratedArtifactSourcesSchema.optional(),
  rationale: NonEmptyTextSchema.optional(),
  position: z.number().int().min(1).max(5).optional(),
});

/** Requires an appointment association and stable display order for a newly saved reviewed list. */
export const VisitQuestionCreateSchema = VisitQuestionSchema.safeExtend({
  appointmentId: RecordIdSchema,
  rationale: NonEmptyTextSchema,
  position: z.number().int().min(1).max(5),
});

export type VisitQuestion = z.infer<typeof VisitQuestionSchema>;
export type VisitQuestionCreate = z.infer<typeof VisitQuestionCreateSchema>;
