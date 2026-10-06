import { AppointmentSchema } from '@orot/domain';
import type { Appointment } from '@orot/domain';
import type { LocalMemoryHit } from '@orot/agent-runtime';
import type { HybridSearchOptions } from '@orot/rag';
import { buildPersistedEvidenceChunks } from '@orot/rag';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import {
  createVisitQuestionEvidenceRevalidator,
  type VisitQuestionChunkBuilder,
  type VisitQuestionEvidenceRepository,
  type VisitQuestionQueryPort,
} from './evidenceRevalidation';
import { localEvidenceFingerprint } from './evidence';
import { createVisitQuestionEvidenceCollection } from './evidenceCollection';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type { VisitQuestionEvidenceItem } from './taskContract';

type VisitQuestionRagPort = Pick<LocalE5RagService, 'index' | 'search'>;

export type VisitQuestionContextResult =
  | { readonly status: 'no_confirmed_upcoming_appointment' }
  | {
      readonly status: 'ready';
      readonly appointment: Appointment;
      readonly appointmentRevision: string;
      readonly appointmentContext: {
        readonly effectiveAt: string;
        readonly timeZoneIdentifier: string | null;
        readonly title: string;
        readonly clinicLabel?: string;
        readonly reason?: string;
        readonly note?: string;
      };
      readonly query: string;
      readonly evidence: VisitQuestionEvidenceCollection;
      readonly revalidateEvidence: (
        citations: readonly VisitQuestionEvidenceItem[],
      ) => Promise<boolean>;
    };

const PERSONAL_RECORD_TYPES = [
  'encounter',
  'health_observation',
  'medication_assertion',
  'medication_definition',
  'dose_event',
  'symptom_entry',
  'evidence_span',
] as const;

function resultLimits(maxEvidenceItems: number) {
  if (!Number.isInteger(maxEvidenceItems) || maxEvidenceItems < 3) {
    throw new Error(
      'Visit-question evidence budget must allow at least one result per source.',
    );
  }
  const transcriptResultLimit = Math.min(
    2,
    Math.max(1, Math.floor(maxEvidenceItems / 4)),
  );
  const memoryResultLimit = Math.min(
    2,
    Math.max(1, Math.floor(maxEvidenceItems / 4)),
  );
  return {
    recordResultLimit:
      maxEvidenceItems - transcriptResultLimit - memoryResultLimit,
    transcriptResultLimit,
    memoryResultLimit,
  };
}

function buildVisitContext(appointment: Appointment) {
  const context = {
    effectiveAt: appointment.effectiveAt,
    timeZoneIdentifier:
      appointment.calendarEventSnapshot?.timeZoneIdentifier ?? null,
    title: appointment.calendarEventSnapshot?.title ?? '',
    ...(appointment.clinicLabel
      ? { clinicLabel: appointment.clinicLabel }
      : {}),
    ...(appointment.reason ? { reason: appointment.reason } : {}),
    ...(appointment.note ? { note: appointment.note } : {}),
  };
  const query = [
    context.title,
    context.clinicLabel,
    context.reason,
    context.note,
    '다음 외래 방문을 위해 최근 검사 결과와 건강 기록, 복용 정보, 전사 내용을 확인할 질문',
  ]
    .filter(Boolean)
    .join(' ');
  return { context, query };
}

/** Loads only current local appointment, RAG, transcript, and reviewed-memory evidence. */
export async function prepareVisitQuestionContext(input: {
  readonly now: string;
  readonly maxEvidenceItems: number;
  readonly queryService: VisitQuestionQueryPort;
  readonly repository: VisitQuestionEvidenceRepository;
  readonly rag: VisitQuestionRagPort;
  readonly buildChunks?: VisitQuestionChunkBuilder;
  readonly currentTime?: () => string;
}): Promise<VisitQuestionContextResult> {
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error(
      'Visit-question preparation needs a valid current timestamp.',
    );
  }
  const result = await input.queryService.queryNextConfirmedCalendarAppointment(
    input.now,
  );
  if (result.status !== 'available' || result.appointment === null) {
    return { status: 'no_confirmed_upcoming_appointment' };
  }
  const parsedAppointment = AppointmentSchema.safeParse(result.appointment);
  if (!parsedAppointment.success) {
    throw new Error(
      'The confirmed Calendar appointment is no longer a valid local record.',
    );
  }
  const appointment = parsedAppointment.data;
  if (
    (appointment.status !== 'scheduled' &&
      appointment.status !== 'rescheduled') ||
    !appointment.calendarEventIdentifier ||
    !appointment.calendarEventSnapshot
  ) {
    return { status: 'no_confirmed_upcoming_appointment' };
  }

  const limits = resultLimits(input.maxEvidenceItems);
  const { context, query } = buildVisitContext(appointment);
  const buildChunks = input.buildChunks ?? buildPersistedEvidenceChunks;
  const chunks = await buildChunks(input.repository);
  await input.rag.index(chunks);

  let memoryHits: readonly LocalMemoryHit[] = [];
  let memoryUnavailable = false;
  try {
    const memory = await input.queryService.searchMemory(
      query,
      limits.memoryResultLimit,
    );
    memoryHits = memory.hits;
    memoryUnavailable = memory.status === 'local_memory_unavailable';
  } catch {
    memoryUnavailable = true;
  }

  const recordFilters: HybridSearchOptions = {
    filters: { recordTypes: PERSONAL_RECORD_TYPES },
  };
  const transcriptFilters: HybridSearchOptions = {
    filters: { recordTypes: ['transcript_segment'] },
  };
  const [recordHits, transcriptHits] = await Promise.all([
    input.rag.search(query, chunks, limits.recordResultLimit, recordFilters),
    input.rag.search(
      query,
      chunks,
      limits.transcriptResultLimit,
      transcriptFilters,
    ),
  ]);
  const evidence = await createVisitQuestionEvidenceCollection({
    repository: input.repository,
    recordHits,
    transcriptHits,
    memoryHits,
    memoryUnavailable,
    ...limits,
    maxEvidenceItems: input.maxEvidenceItems,
  });
  const revalidateEvidence = createVisitQuestionEvidenceRevalidator({
    appointment,
    query,
    evidence,
    queryService: input.queryService,
    repository: input.repository,
    buildChunks,
    currentTime: input.currentTime ?? (() => new Date().toISOString()),
  });

  return {
    status: 'ready',
    appointment,
    appointmentRevision: localEvidenceFingerprint(appointment),
    appointmentContext: context,
    query,
    evidence,
    revalidateEvidence,
  };
}
