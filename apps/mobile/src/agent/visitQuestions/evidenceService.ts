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
import type { VisitQuestionEvidenceItem } from './taskContract';
import {
  searchVisitQuestionEvidence,
  type VisitQuestionSearchSource,
} from './evidenceSearch';

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

  const { context, query } = buildVisitContext(appointment);
  const buildChunks = input.buildChunks ?? buildPersistedEvidenceChunks;
  const initialEvidence = await searchVisitQuestionEvidence({
    query,
    maxEvidenceItems: input.maxEvidenceItems,
    queryService: input.queryService,
    repository: input.repository,
    rag: input.rag,
    buildChunks,
  });
  // This same map is extended by later read-only research results before revalidation or save.
  const metadataByCitation = new Map(initialEvidence.metadataByCitation);
  const evidence = { ...initialEvidence, metadataByCitation };
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
    return searched;
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
