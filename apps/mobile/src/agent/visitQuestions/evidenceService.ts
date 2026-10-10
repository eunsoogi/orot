import { AppointmentSchema } from '@orot/domain';
import type { Appointment } from '@orot/domain';
import { buildPersistedEvidenceChunks } from '@orot/rag';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import {
  createVisitQuestionEvidenceRevalidator,
  type VisitQuestionChunkBuilder,
  type VisitQuestionEvidenceRepository,
  type VisitQuestionQueryPort,
} from './evidenceRevalidation';
import { localEvidenceFingerprint } from './evidence';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import { hasConflictingHealthObservations } from './evidenceCollection';
import type { VisitQuestionEvidenceItem } from './taskContract';
import {
  searchVisitQuestionEvidence,
  type VisitQuestionSearchSource,
} from './evidenceSearch';

type VisitQuestionRagPort = Pick<LocalE5RagService, 'index' | 'search'>;

export type VisitQuestionContextResult =
  | { readonly status: 'cancelled' }
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
      readonly searchEvidence: (
        query: string,
        maxEvidenceItems: number,
        sourceKind: VisitQuestionSearchSource,
        signal?: AbortSignal,
      ) => Promise<VisitQuestionEvidenceCollection>;
      readonly revalidateEvidence: (
        citations: readonly VisitQuestionEvidenceItem[],
      ) => Promise<boolean>;
    };

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

/** Loads appointment evidence and returns cancellation before exposing context. */
export async function prepareVisitQuestionContext(input: {
  readonly now: string;
  readonly maxEvidenceItems: number;
  readonly queryService: VisitQuestionQueryPort;
  readonly repository: VisitQuestionEvidenceRepository;
  readonly rag: VisitQuestionRagPort;
  readonly buildChunks?: VisitQuestionChunkBuilder;
  readonly currentTime?: () => string;
  readonly signal?: AbortSignal;
}): Promise<VisitQuestionContextResult> {
  if (!Number.isFinite(Date.parse(input.now))) {
    throw new Error(
      'Visit-question preparation needs a valid current timestamp.',
    );
  }
  if (input.signal?.aborted) return { status: 'cancelled' };
  let result: Awaited<
    ReturnType<VisitQuestionQueryPort['queryNextConfirmedCalendarAppointment']>
  >;
  try {
    result = await input.queryService.queryNextConfirmedCalendarAppointment(
      input.now,
    );
  } catch (error) {
    if (input.signal?.aborted) return { status: 'cancelled' };
    throw error;
  }
  if (input.signal?.aborted) return { status: 'cancelled' };
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

  const { context, query } = buildVisitContext(appointment);
  const buildChunks = input.buildChunks ?? buildPersistedEvidenceChunks;
  let initialEvidence: VisitQuestionEvidenceCollection;
  try {
    initialEvidence = await searchVisitQuestionEvidence({
      query,
      maxEvidenceItems: input.maxEvidenceItems,
      queryService: input.queryService,
      repository: input.repository,
      rag: input.rag,
      buildChunks,
      signal: input.signal,
    });
  } catch (error) {
    // RAG adapters may reject when their caller-owned signal aborts an operation.
    if (input.signal?.aborted) return { status: 'cancelled' };
    throw error;
  }
  if (input.signal?.aborted) return { status: 'cancelled' };
  // This same map is extended by later read-only research results before revalidation or save.
  const metadataByCitation = new Map(initialEvidence.metadataByCitation);
  const evidence = { ...initialEvidence, metadataByCitation };
  // A later search can reveal a conflict that was split across batches.
  let hasMaterialConflict = initialEvidence.batch.conflicts.length > 0;
  const searchEvidence = async (
    searchQuery: string,
    maxEvidenceItems: number,
    sourceKind: VisitQuestionSearchSource,
    signal?: AbortSignal,
  ) => {
    const searched = await searchVisitQuestionEvidence({
      query: searchQuery,
      maxEvidenceItems,
      sourceKind,
      queryService: input.queryService,
      repository: input.repository,
      rag: input.rag,
      buildChunks,
      signal,
    });
    for (const [key, metadata] of searched.metadataByCitation) {
      metadataByCitation.set(key, metadata);
    }
    hasMaterialConflict ||=
      searched.batch.conflicts.length > 0 ||
      hasConflictingHealthObservations(
        [...metadataByCitation.values()].map(metadata => ({ metadata })),
      );
    return {
      ...searched,
      batch: {
        ...searched.batch,
        // Keep private record details out of the shared workflow's conflict notice.
        conflicts: hasMaterialConflict
          ? [
              'Conflicting health observation values exist for the same concept and time.',
            ]
          : [],
      },
    };
  };
  const revalidateEvidence = createVisitQuestionEvidenceRevalidator({
    appointment,
    query,
    metadataByCitation,
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
    searchEvidence,
    revalidateEvidence,
  };
}
