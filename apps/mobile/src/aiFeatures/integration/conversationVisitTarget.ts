import type { Appointment } from '@orot/domain';
import { HEALTH_EVIDENCE_RECORD_KINDS } from '../../healthEvidence/localEvidenceQueries';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import { isEligibleNextVisit } from '../../routes/nextAppointment';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import {
  fingerprint,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
  utf8ByteLength,
} from './evidenceUtils';
import type { ConversationEntryContext } from './conversationIntent';
import { withProviderStage } from '../../providers/diagnostics';
import type { EvidenceItem } from '@orot/agent-runtime';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';

/** Home may identify one confirmed future visit; an edited or cancelled visit must be reopened. */
function eligible(appointment: Appointment, now: number): boolean {
  return (
    isEligibleNextVisit(appointment, now) &&
    appointment.provenance.origin === 'user_reported' &&
    Boolean(
      appointment.calendarEventIdentifier && appointment.calendarEventSnapshot,
    ) &&
    Date.parse(appointment.effectiveAt) >= now
  );
}

/** Pins the Home target to an opaque, revalidated local citation rather than selecting another visit. */
export async function prepareConversationVisitTarget(input: {
  readonly data: AiFeatureLocalData;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly appointmentId: string;
  readonly signal: AbortSignal;
  readonly now?: () => number;
}) {
  const { data, registry, appointmentId, signal } = input;
  const now = input.now ?? Date.now;
  const appointment = await data.repository.readRecord(
    'appointment',
    appointmentId,
    signal,
  );
  if (signal.aborted || !appointment || !eligible(appointment, now()))
    return null;
  const sourceIds = [...new Set(appointment.provenance.sourceRecordIds)];
  if (sourceIds.length > 1024)
    throw new Error('Visit provenance exceeds the supported bound.');
  const dependencies: LocalHealthEvidenceRecord[] = [];
  for (const id of sourceIds) {
    if (id === appointmentId) continue;
    const found: LocalHealthEvidenceRecord[] = [];
    for (const kind of HEALTH_EVIDENCE_RECORD_KINDS) {
      const record = await data.repository.readRecord(kind, id, signal);
      if (record) found.push({ kind, record } as LocalHealthEvidenceRecord);
    }
    if (found.length !== 1) return null;
    dependencies.push(found[0]!);
  }
  const expected = localEvidenceFingerprint(appointment);
  const expectedDependencies = dependencies.map(row =>
    localEvidenceFingerprint(row.record),
  );
  const readCurrent = async (
    readSignal: AbortSignal,
  ): Promise<EvidenceSourceReadResult> => {
    if (readSignal.aborted) return { status: 'unavailable' };
    const current = await data.repository.readRecord(
      'appointment',
      appointmentId,
      readSignal,
    );
    if (!current) return { status: 'missing' };
    if (
      !eligible(current, now()) ||
      localEvidenceFingerprint(current) !== expected
    )
      return { status: 'changed' };
    const rows: LocalHealthEvidenceRecord[] = [
      { kind: 'appointment', record: current },
    ];
    for (const [index, dependency] of dependencies.entries()) {
      const record = await data.repository.readRecord(
        dependency.kind,
        dependency.record.id,
        readSignal,
      );
      if (!record) return { status: 'missing' };
      if (localEvidenceFingerprint(record) !== expectedDependencies[index])
        return { status: 'changed' };
      rows.push({ kind: dependency.kind, record } as LocalHealthEvidenceRecord);
    }
    return readSignal.aborted
      ? { status: 'unavailable' }
      : {
          status: 'available',
          document: { sourceKind: 'personal_record', records: rows },
        };
  };
  registry.registerSensitiveIdentifier(appointmentId);
  registry.registerSensitiveIdentifier(appointment.calendarEventIdentifier!);
  for (const id of sourceIds) registry.registerSensitiveIdentifier(id);
  const content =
    'appointment: ' +
    JSON.stringify({
      status: appointment.status,
      clinicLabel: appointment.clinicLabel,
      calendarTitle: appointment.calendarEventSnapshot?.title,
      endsAt: appointment.endsAt,
    });
  // Never send an unbounded calendar label as an initial model input.
  if (utf8ByteLength(content) > MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES)
    throw new Error('Selected visit evidence exceeds the supported payload.');
  for (const id of await data.findIdentifiers(content, signal))
    registry.registerSensitiveIdentifier(id);
  if (signal.aborted) return null;
  return registry.add({
    reference: {
      sourceKind: 'personal_record',
      sourceId: appointmentId,
      sourceRevision: fingerprint(appointment),
      evidenceId: appointmentId,
      evidenceRevision: fingerprint(appointment),
      locator: { kind: 'structured_record', recordId: appointmentId },
      effectiveTime: appointment.effectiveAt,
      reviewState:
        appointment.reviewState.status === 'reviewed'
          ? 'reviewed'
          : 'unreviewed',
    },
    content,
    validate: async readSignal =>
      (await readCurrent(readSignal)).status === 'available',
    readSource: readCurrent,
  });
}

/** Resolve a target before provider or public-search work, keeping an absent target distinct from a stale one. */
export async function resolveConversationEntryTarget(input: {
  readonly context?: ConversationEntryContext;
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly signal: AbortSignal;
}): Promise<{
  readonly data?: AiFeatureLocalData;
  readonly evidence?: EvidenceItem;
  readonly failure?: 'validation_failed' | 'stale_evidence';
}> {
  const id = input.context?.appointmentId;
  if (id === undefined) return {};
  if (input.context?.intent !== 'visit-questions' || !id.trim())
    return { failure: 'validation_failed' as const };
  const data = await withProviderStage('rag', 'data', input.loadLocalData);
  const evidence = await prepareConversationVisitTarget({
    data,
    registry: input.registry,
    appointmentId: id,
    signal: input.signal,
  });
  return evidence ? { data, evidence } : { failure: 'stale_evidence' as const };
}
