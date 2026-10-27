import {
  EvidenceSpanSchema,
  HealthObservationSchema,
  TimestampSchema,
} from '@orot/domain';
import {
  encounterCanonical,
  encounterReferences,
  requireEncounterActive,
  validateEncounterApproval,
  validateEncounterCandidates,
} from '@orot/agent-runtime';
import type { EncounterApproval, EncounterPending } from '@orot/agent-runtime';
import type { RecordRepository } from '@orot/storage';
import { readEncounterTranscript } from './transcript';
import { encounterConflicts } from './conflicts';
import { requireCurrentEncounterReviewSession } from './reviewSession';

/** Receipt and records commit together. A replay after a checkpoint-write failure returns the same IDs without another write. */
export async function persistEncounterApproval(
  repository: RecordRepository,
  pending: EncounterPending,
  approval: EncounterApproval,
  signal: AbortSignal,
  requireCurrentSession = false,
): Promise<string[]> {
  validateEncounterApproval(pending, approval);
  if (approval.decision !== 'approve')
    throw new Error('An explicit approval is required.');
  const reviewedAt = TimestampSchema.parse(approval.reviewedAt);
  return repository.transaction(async (writer, sql) => {
    requireEncounterActive(signal);
    if (!sql)
      throw new Error('Encounter writes require a canonical SQL transaction.');
    if (requireCurrentSession)
      await requireCurrentEncounterReviewSession(
        sql,
        pending.sourceId,
        pending.threadId,
      );
    const transcript = await readEncounterTranscript(
      writer,
      sql,
      pending.sourceId,
    );
    if (
      encounterCanonical(encounterReferences(transcript)) !==
      encounterCanonical(pending.segments)
    )
      throw new Error('Transcript changed before approval could commit.');
    validateEncounterCandidates(pending.candidates, transcript);
    validateEncounterCandidates(approval.candidates, transcript);
    const receiptKey =
      'encounter-approval:' + encodeURIComponent(pending.threadId);
    const receipt = await sql.execute(
      'SELECT value FROM healthkit_sync_checkpoints WHERE checkpoint_key = ?',
      [receiptKey],
    );
    const approvedValue = encounterCanonical(approval);
    if (receipt.rows.length) {
      const saved = JSON.parse(String(receipt.rows[0].value));
      if (saved.approval !== approvedValue)
        throw new Error(
          'This encounter already has a different committed approval.',
        );
      // Do not resurrect records removed after confirmation, even if a stale checkpoint is replayed.
      for (const id of saved.recordIds)
        if (!(await writer.get('health_observation', id)))
          throw new Error('A confirmed encounter record was removed.');
      requireEncounterActive(signal);
      return saved.recordIds as string[];
    }
    if (
      encounterCanonical(
        await encounterConflicts(writer, pending.candidates),
      ) !== encounterCanonical(pending.conflicts)
    )
      throw new Error('Conflicts changed; obtain a new review snapshot.');
    // Edits cannot silently introduce a conflict that was absent from the approved preview.
    const selectedConflicts = pending.conflicts.filter(conflict =>
      approval.candidates.some(
        candidate => candidate.id === conflict.candidateId,
      ),
    );
    if (
      encounterCanonical(
        await encounterConflicts(writer, approval.candidates),
      ) !== encounterCanonical(selectedConflicts)
    )
      throw new Error('Edited candidates require a new conflict review.');
    const recordIds: string[] = [];
    for (const candidate of approval.candidates) {
      const id =
        'encounter:' +
        encodeURIComponent(pending.threadId) +
        ':' +
        encodeURIComponent(candidate.id);
      if (await writer.get('health_observation', id))
        throw new Error('Encounter record identity already exists.');
      const segments = candidate.evidence.map(evidence =>
        transcript.segments.find(item => item.id === evidence.segmentId)!,
      );
      const sourceRecordIds = [
        ...new Set([pending.sourceId, ...segments.map(segment => segment.id)]),
      ];
      const metadata = {
        effectiveAt: segments[0].effectiveAt,
        recordedAt: reviewedAt,
        ingestedAt: reviewedAt,
        provenance: {
          origin: 'derived' as const,
          sourceRecordIds,
          source: {
            system: 'encounter-processing',
            sourceIdentifier: pending.threadId,
            sourceName: 'speaker:unknown',
          },
        },
        reviewState: {
          status: 'reviewed' as const,
          reviewerId: approval.reviewerId,
          reviewedAt,
        },
      };
      const evidenceIds: string[] = [];
      for (const [index, evidence] of candidate.evidence.entries()) {
        const segment = segments[index];
        // Text offsets address this exact transcript revision; the paired locator retains its recording time range.
        for (const [suffix, locator] of [
          [
            'text',
            {
              kind: 'text_range' as const,
              startOffset: evidence.startOffset,
              endOffset: evidence.endOffset,
            },
          ],
          [
            'audio',
            { kind: 'audio_time_range' as const, ...segment.audioRange },
          ],
        ] as const) {
          const evidenceId = `${id}:evidence:${index}:${suffix}`;
          if (await writer.get('evidence_span', evidenceId))
            throw new Error('Evidence identity already exists.');
          const span = EvidenceSpanSchema.parse({
            ...metadata,
            id: evidenceId,
            sourceRecordId: pending.sourceId,
            text: evidence.quote,
            locator,
            provenance: {
              ...metadata.provenance,
              source: {
                system: 'encounter-processing',
                sourceIdentifier: segment.id,
                sourceName: 'speaker:unknown',
              },
            },
          });
          await writer.put('evidence_span', span);
          evidenceIds.push(evidenceId);
        }
      }
      // A reviewed transcript statement is not proof of current use or a clinician-issued prescription.
      await writer.put(
        'health_observation',
        HealthObservationSchema.parse({
          ...metadata,
          id,
          provenance: {
            ...metadata.provenance,
            sourceRecordIds: [...sourceRecordIds, ...evidenceIds],
          },
          observationKind: 'other',
          concept:
            candidate.kind === 'medication'
              ? 'encounter_medication_statement'
              : 'encounter_plan',
          value: {
            kind: 'text',
            text:
              candidate.text +
              (candidate.dosageInstruction
                ? '\n' + candidate.dosageInstruction
                : ''),
          },
        }),
      );
      recordIds.push(id);
    }
    await writer.putSyncCheckpoint({
      key: receiptKey,
      value: JSON.stringify({
        sourceId: pending.sourceId,
        approval: approvedValue,
        recordIds,
      }),
      updatedAt: reviewedAt,
    });
    // Cancellation before commit rolls back evidence, records and the replay receipt as one unit.
    requireEncounterActive(signal);
    return recordIds;
  });
}
