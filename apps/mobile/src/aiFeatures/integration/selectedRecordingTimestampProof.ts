import type { SqlDatabase } from '@orot/storage';
import { findExactRecordingTime } from '@orot/storage';
import { acquireIndependentReadEpoch } from '../../storage/protectedReadEpoch';

/** An independently settled read held only until the immediate local handoff. */
export type RecordingTimeWitness = { current(): boolean; dispose(): void };
export type HoldRecordingTime = () => Promise<RecordingTimeWitness | undefined>;

const zonedTimestamp =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Query only after a turn already owns an attended, local source selection. Timestamp
 * agreement does not mint authority: the query must reproduce that exact single source. */
export async function proveSelectedRecordingTimestamp(input: {
  readonly database: SqlDatabase;
  readonly exactUserTimestamp: string;
  readonly submittedText: string;
  readonly expectedSourceId?: string;
  readonly isCurrent: () => boolean;
}) {
  const {
    database,
    exactUserTimestamp,
    submittedText,
    expectedSourceId,
    isCurrent,
  } = input;
  if (!isCurrent()) return { status: 'unavailable' } as const;
  if (
    exactUserTimestamp !== submittedText ||
    exactUserTimestamp.length > 1000 ||
    !zonedTimestamp.test(exactUserTimestamp)
  )
    return { status: 'recording_selector_required' } as const;
  const witness: {
    epoch?: ReturnType<typeof acquireIndependentReadEpoch>;
    rows?: readonly string[];
  } = {};
  try {
    await database.transaction(async tx => {
      if (!isCurrent()) return;
      witness.epoch = acquireIndependentReadEpoch(database);
      if (witness.epoch)
        witness.rows = await findExactRecordingTime(tx, exactUserTimestamp);
    });
    const epoch = witness.epoch;
    if (!isCurrent() || !epoch?.current())
      return { status: 'unavailable' } as const;
    if (
      witness.rows?.length !== 1 ||
      (expectedSourceId && witness.rows[0] !== expectedSourceId)
    )
      return { status: 'recording_selector_required' } as const;
    witness.epoch = undefined;
    return {
      status: 'current',
      sourceId: witness.rows[0]!,
      witness: {
        current: () => isCurrent() && epoch.current(),
        dispose: () => epoch.dispose(),
      },
    } as const;
  } catch {
    return { status: 'unavailable' } as const;
  } finally {
    witness.epoch?.dispose();
  }
}

/** No provider is opened by an unproven timestamp; rechecks take a fresh short
 * witness because the transcript graph's own indexing may write to the database. */
export async function openSelectedRecordingTimeAdmission(
  input: Omit<
    Parameters<typeof proveSelectedRecordingTimestamp>[0],
    'database'
  >,
) {
  const { currentRecordingProtection } =
    await import('../../ragConversation/conversationRecordingPickerPage');
  if (
    !input.isCurrent() ||
    !(await currentRecordingProtection()) ||
    !input.isCurrent()
  )
    return;
  const { openLocalAgentMemoryDatabase, isCurrentLocalAgentMemoryDatabase } =
    await import('../../storage/secureDatabase');
  const database = await openLocalAgentMemoryDatabase();
  const prove = (expectedSourceId?: string) =>
    proveSelectedRecordingTimestamp({
      ...input,
      expectedSourceId,
      database,
      isCurrent: () =>
        input.isCurrent() && isCurrentLocalAgentMemoryDatabase(database),
    });
  const initial = await prove(input.expectedSourceId);
  if (initial.status !== 'current') return initial;
  try {
    if (!(await currentRecordingProtection()) || !initial.witness.current())
      return { status: 'unavailable' } as const;
    const hold: HoldRecordingTime = async () => {
      if (!input.isCurrent() || !(await currentRecordingProtection())) return;
      const proof = await prove(initial.sourceId);
      return proof.status === 'current' ? proof.witness : undefined;
    };
    return { status: 'current', sourceId: initial.sourceId, hold } as const;
  } finally {
    initial.witness.dispose();
  }
}
