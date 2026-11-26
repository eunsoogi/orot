import type { SqlDatabase } from '@orot/storage';
import { acquireIndependentReadEpoch } from './protectedReadEpoch';
import { readPairedDetails } from '../ragConversation/archivedPairedDetailsLayout';
import type { ConversationA2UINode } from '../ragConversation/conversationA2UI';

type Lease = Readonly<{ id: string; version: number }>;
type Identity = Readonly<{
  artifactId: string;
  createdAt: string;
  sessionId: string;
}>;
export type MountedPairedDetailsMarker = Readonly<Record<never, never>>;
const admitted = new WeakMap<
  MountedPairedDetailsMarker,
  Identity & { exact: string; lease: Lease }
>();

function readSourceFree(raw: unknown, id: Identity) {
  if (typeof raw !== 'string' || raw.length > 32_768) return;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    const empty = (field: string, optional = true) =>
      (optional && value[field] === undefined) ||
      (Array.isArray(value[field]) && value[field].length === 0);
    if (
      value?.id !== id.artifactId ||
      value.sessionId !== id.sessionId ||
      value.createdAt !== id.createdAt ||
      value.status !== 'complete' ||
      typeof value.answer !== 'string' ||
      !empty('sources', false) ||
      !empty('citations') ||
      !empty('historicalDialogueParents') ||
      !empty('priorDialogue') ||
      !empty('priorUserReports') ||
      [
        'entryIntent',
        'treatmentContext',
        'submittedInput',
        'dailyReport',
        'healthSummary',
        'visitQuestions',
      ].some(field => Object.hasOwn(value, field))
    )
      return;
    return readPairedDetails(value.archivedA2UILayout, value.answer);
  } catch {
    return undefined;
  }
}

const unbound = new WeakMap<
  ConversationA2UINode,
  Identity & {
    exact: string;
    panels: readonly number[];
  }
>();
/** Only the exact completed archive reader can stage a source-free row. */
export function stageMountedPairedDetails(
  identity: Identity,
  serialized: unknown,
) {
  if (typeof serialized !== 'string') return;
  const layout = readSourceFree(serialized, identity);
  if (!layout) return;
  unbound.set(layout.root, {
    ...identity,
    exact: serialized,
    panels: layout.positions,
  });
  return layout.root;
}

export function bindMountedPairedDetails(
  root: ConversationA2UINode,
  lease: Lease,
) {
  const entry = unbound.get(root);
  if (!entry || entry.sessionId !== lease.id) return;
  const marker = Object.freeze({});
  admitted.set(marker, { ...entry, lease: { ...lease } });
  return { marker, panels: entry.panels };
}

const latestCompletedRow = `SELECT a.result_json AS raw
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
    AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents x WHERE x.id=a.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_artifact_sources x WHERE x.artifact_id=a.id)
    AND NOT EXISTS (SELECT 1 FROM conversation_request_sources x WHERE x.request_id=a.id)`;

/** Verify the exact existing encrypted row and its empty authority edges;
 * neither this opener nor the marker can write or broaden source selection. */
export function createArchivedPairedDetailsOwner(
  database: SqlDatabase,
  isCurrentDatabase: (owner: SqlDatabase) => boolean = () => false,
) {
  const currentDatabase = () => isCurrentDatabase(database);
  const verify = async (
    marker: MountedPairedDetailsMarker,
    lease: Lease,
    current: () => boolean,
  ) => {
    const expected = admitted.get(marker);
    if (
      !expected ||
      expected.lease.id !== lease.id ||
      expected.lease.version !== lease.version ||
      !current() ||
      !currentDatabase()
    )
      return;
    try {
      const { rows } = await database.execute(latestCompletedRow, [
        expected.artifactId,
        lease.id,
        lease.version,
        expected.createdAt,
      ]);
      const serialized = rows[0]?.raw;
      // Compare exact protected bytes rather than a collision-prone fingerprint.
      if (
        rows.length !== 1 ||
        !current() ||
        !currentDatabase() ||
        serialized !== expected.exact
      )
        return;
      return readSourceFree(serialized, expected);
    } catch {
      return undefined;
    }
  };
  return Object.assign(verify, {
    hold(retire: () => void) {
      if (!currentDatabase()) return;
      const epoch = acquireIndependentReadEpoch(database);
      const stop = epoch?.beforeDispatch(retire);
      if (!epoch || !stop) {
        epoch?.dispose();
        return;
      }
      return {
        current: () => currentDatabase() && epoch.current(),
        dispose() {
          stop();
          epoch.dispose();
        },
      };
    },
  });
}
