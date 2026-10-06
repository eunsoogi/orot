import { AppointmentSchema, compareTimestamps } from '@orot/domain';
import type { Appointment } from '@orot/domain';
import type { LocalRecordQueryService } from '@orot/agent-runtime';
import type { EvidenceChunk } from '@orot/rag';
import type { PersistedEvidenceReader } from '@orot/rag';
import type { RecordRepository } from '@orot/storage';
import {
  localEvidenceFingerprint,
  mapMemoryHitToVisitQuestionEvidence,
  mapRagHitToVisitQuestionEvidence,
  VISIT_QUESTION_RECORD_KINDS,
  visitQuestionCitationKey,
} from './evidence';
import type { VisitQuestionEvidenceCollection } from './evidenceCollection';
import type { VisitQuestionEvidenceItem } from './taskContract';

export type VisitQuestionQueryPort = Pick<
  LocalRecordQueryService<unknown, unknown, unknown, unknown, unknown>,
  'queryNextConfirmedCalendarAppointment' | 'searchMemory'
>;

export type VisitQuestionEvidenceRepository = Pick<RecordRepository, 'get'> &
  PersistedEvidenceReader;

export type VisitQuestionChunkBuilder = (
  repository: PersistedEvidenceReader,
) => Promise<EvidenceChunk[]>;

/** Rechecks Calendar, RAG, transcript revisions, and reviewed memory before display or save. */
export function createVisitQuestionEvidenceRevalidator(input: {
  readonly appointment: Appointment;
  readonly query: string;
  readonly evidence: VisitQuestionEvidenceCollection;
  readonly queryService: VisitQuestionQueryPort;
  readonly repository: VisitQuestionEvidenceRepository;
  readonly buildChunks: VisitQuestionChunkBuilder;
  readonly currentTime: () => string;
}): (citations: readonly VisitQuestionEvidenceItem[]) => Promise<boolean> {
  return async citations => {
    if (citations.length === 0) return false;
    try {
      const currentNow = input.currentTime();
      if (!Number.isFinite(Date.parse(currentNow))) return false;
      const currentAppointment =
        await input.queryService.queryNextConfirmedCalendarAppointment(
          currentNow,
        );
      if (
        currentAppointment.status !== 'available' ||
        currentAppointment.appointment === null
      ) {
        return false;
      }
      const parsedCurrentAppointment = AppointmentSchema.safeParse(
        currentAppointment.appointment,
      );
      if (
        !parsedCurrentAppointment.success ||
        parsedCurrentAppointment.data.id !== input.appointment.id ||
        (parsedCurrentAppointment.data.status !== 'scheduled' &&
          parsedCurrentAppointment.data.status !== 'rescheduled') ||
        !parsedCurrentAppointment.data.calendarEventIdentifier ||
        !parsedCurrentAppointment.data.calendarEventSnapshot ||
        compareTimestamps(
          parsedCurrentAppointment.data.effectiveAt,
          currentNow,
        ) < 0 ||
        localEvidenceFingerprint(parsedCurrentAppointment.data) !==
          localEvidenceFingerprint(input.appointment)
      ) {
        return false;
      }

      for (const citation of citations) {
        if (
          !input.evidence.metadataByCitation.has(
            visitQuestionCitationKey(citation),
          )
        )
          return false;
      }
      const personalCitations = citations.filter(
        citation => citation.sourceKind === 'personal_record',
      );
      if (personalCitations.length > 0) {
        const currentChunks = await input.buildChunks(input.repository);
        for (const citation of personalCitations) {
          const metadata = input.evidence.metadataByCitation.get(
            visitQuestionCitationKey(citation),
          );
          if (!metadata?.recordKind || !metadata.evidenceRecordId) return false;
          const currentChunk = currentChunks.find(
            candidate =>
              candidate.metadata.evidenceId === metadata.evidenceRecordId &&
              candidate.metadata.sourceId === citation.sourceId &&
              VISIT_QUESTION_RECORD_KINDS[candidate.metadata.recordType] ===
                metadata.recordKind,
          );
          if (!currentChunk) return false;
          const current = await mapRagHitToVisitQuestionEvidence(
            input.repository,
            {
              chunk: currentChunk,
              score: 0,
              lexicalRank: null,
              vectorRank: null,
            },
          );
          if (
            visitQuestionCitationKey(current.item) !==
            visitQuestionCitationKey(citation)
          ) {
            return false;
          }
        }
      }

      const memoryCitations = citations.filter(
        citation => citation.sourceKind === 'reviewed_memory',
      );
      if (memoryCitations.length > 0) {
        const currentMemory = await input.queryService.searchMemory(
          input.query,
          5,
        );
        if (currentMemory.status !== 'available') return false;
        const currentKeys = new Set(
          currentMemory.hits
            .map(mapMemoryHitToVisitQuestionEvidence)
            .filter(
              (value): value is NonNullable<typeof value> => value !== null,
            )
            .map(value => visitQuestionCitationKey(value.item)),
        );
        if (
          memoryCitations.some(
            citation => !currentKeys.has(visitQuestionCitationKey(citation)),
          )
        ) {
          return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  };
}
