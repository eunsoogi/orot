import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { readPossibilityOriginal } from '../ragConversation/possibilityOriginalReceipt';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { acquireIndependentReadEpoch } from './protectedReadEpoch';
import {
  createReadOnlyPeriodValidation,
  type ReadOnlyPeriodValidation,
} from './readOnlyPeriodValidation';

export type ConversationPossibilityOriginalInput = Readonly<{
  artifactId: string;
  createdAt: string;
  lease: Readonly<{ id: string; version: number }>;
  current: () => boolean;
  confirmProtected: () => Promise<boolean | null>;
}>;

const ownedRow = `SELECT a.result_json AS raw
  FROM conversation_completions c
  JOIN conversation_artifacts a ON a.id=c.message_id AND a.session_id=c.session_id
  JOIN conversation_requests r ON r.id=c.request_id AND r.session_id=a.session_id
  JOIN conversation_artifact_sessions s ON s.id=r.session_id AND s.version=r.session_version AND s.hidden=0
  JOIN conversation_artifact_generation g ON g.singleton=1 AND s.generation=g.generation
  WHERE a.id=? AND s.id=? AND s.version=? AND a.created_at=?
    AND c.request_id=a.id AND r.created_at=a.created_at
    AND r.status='completed' AND r.input_json IS NULL AND r.interruption_reason IS NULL
    AND NOT EXISTS (SELECT 1 FROM conversation_artifact_removed_sessions x WHERE x.id=s.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts x WHERE x.id=a.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id=a.id)`;

/** Shared exact SQL/content proof; callers provide their own read or write fence. */
export async function selectConversationPossibilityOriginal(
  tx: SqlExecutor,
  database: SqlDatabase,
  stamp: Pick<
    ConversationPossibilityOriginalInput,
    'artifactId' | 'createdAt' | 'lease'
  >,
  current: () => boolean,
  validate: ReadOnlyPeriodValidation,
) {
  const {
    artifactId,
    createdAt,
    lease: { id: sessionId, version },
  } = stamp;
  if (!current()) return null;
  const { rows } = await tx.execute(ownedRow, [
    artifactId,
    sessionId,
    version,
    createdAt,
  ]);
  const raw = rows[0]?.raw;
  if (!current() || rows.length !== 1 || typeof raw !== 'string') return null;
  const original = decodeConversationArtifact(raw);
  if (
    original?.entryIntent !== 'possibilities' ||
    original.status !== 'complete' ||
    original.id !== artifactId ||
    original.sessionId !== sessionId ||
    original.createdAt !== createdAt ||
    !original.sources.length ||
    !original.citations?.length ||
    original.sources.some(
      source => source.reference.sourceKind !== 'personal_record',
    ) ||
    original.citations.some(
      reference => reference.sourceKind !== 'personal_record',
    )
  )
    return null;
  const result = readPossibilityOriginal(
    original.possibilityOriginal,
    original.answer,
  );
  if (!result) return null;
  await assertConversationArtifactCurrent(
    tx,
    database,
    original,
    false,
    validate,
  );
  return current() ? { raw, result } : null;
}

export function createConversationPossibilityOriginalReader(
  database: SqlDatabase,
  isCurrentDatabase: (owner: SqlDatabase) => boolean = () => false,
  requireReference?: (
    tx: SqlExecutor,
    input: ConversationPossibilityOriginalInput,
  ) => Promise<boolean>,
) {
  return async function read(input: ConversationPossibilityOriginalInput) {
    const {
      artifactId,
      createdAt,
      current: callerCurrent,
      confirmProtected,
    } = input;
    const { id: sessionId, version } = input.lease;
    const epoch = acquireIndependentReadEpoch(database);
    if (!epoch) return null;
    const current = () =>
      callerCurrent() && isCurrentDatabase(database) && epoch.current();
    const selected = async () => {
      const holder: {
        value: Awaited<
          ReturnType<typeof selectConversationPossibilityOriginal>
        >;
      } = {
        value: null,
      };
      await database.transaction(async tx => {
        // For bookmarked reads, both protected selections recheck the identity link.
        if (requireReference && !(await requireReference(tx, input))) return;
        holder.value = await selectConversationPossibilityOriginal(
          tx,
          database,
          { artifactId, createdAt, lease: { id: sessionId, version } },
          current,
          createReadOnlyPeriodValidation(tx),
        );
      });
      return current() ? holder.value : null;
    };
    try {
      if (!current() || (await confirmProtected()) !== true || !current())
        return null;
      const first = await selected();
      if (!first || (await confirmProtected()) !== true || !current())
        return null;
      const last = await selected();
      return last && last.raw === first.raw && current() ? last.result : null;
    } catch {
      return null;
    } finally {
      epoch.dispose();
    }
  };
}
