import { readGuardedBoundRows } from './readGuardedBoundRows';
import { registerHistoryRead } from '../healthEvidence/historyObservationHydrationOwner';
import { conversationToolSnapshotReader } from './conversationToolSnapshot';
import { committedPeriodReadOperation } from './committedPeriodReadOperation';
import type { SqlDatabase } from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationArtifact } from './conversationArtifactCodec';
import { createConversationStrictRoots } from './conversationArtifactStrictRoots';

type BoundParentRows = {
  readonly rows?: (ConversationArtifact | null)[];
  tokens?: readonly (number | undefined)[];
};
/** Only capture's two independent parent fences may select the witnessed plan. */
export type BoundCaptureReadPhase = 'initial' | 'final';

const boundParentReaders = new WeakMap<
  object,
  {
    storage: object;
    signal?: AbortSignal;
    read(
      ids: readonly string[],
      capturePhase?: BoundCaptureReadPhase,
    ): Promise<BoundParentRows | undefined>;
  }
>();

/** Only this factory can mint a witness. A replacement scope callback receives no authority. */
export function readOwnedBoundParentRows(
  operation: object,
  storage: object,
  signal: AbortSignal,
  ids: readonly string[],
  capturePhase?: BoundCaptureReadPhase,
) {
  const owner = boundParentReaders.get(operation);
  return owner?.storage === storage && owner.signal === signal
    ? owner.read(ids, capturePhase)
    : undefined;
}

/** Validate a page in one transaction so hide, clear, or source deletion cannot split its snapshot. */
export function createConversationArtifactReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  readToolTurnsSnapshot: ReturnType<typeof conversationToolSnapshotReader>,
) {
  const readManyWithLease = createConversationStrictRoots(database, ensure);
  const methods = (
    operation?: ReturnType<typeof committedPeriodReadOperation>,
    rollbackOnFailure = false,
    canBatchOrdinary?: () => boolean,
  ) => {
    const readMany = (ids: readonly string[]) =>
      readManyWithLease(
        ids,
        undefined,
        undefined,
        operation,
        rollbackOnFailure,
      );
    return {
      readMany,
      async readManyWithAncestry(ids: readonly string[]) {
        // Publish the graph only after the protected transaction commits. This is
        // a page-local snapshot, never authority for live source reads or later requests.
        const ancestry = new Map<string, ConversationArtifact>();
        const items = await readManyWithLease(
          ids,
          undefined,
          artifact => {
            const existing = ancestry.get(artifact.id);
            if (existing && fingerprint(existing) !== fingerprint(artifact))
              throw new Error(
                'Conversation ancestry changed inside its snapshot.',
              );
            ancestry.set(artifact.id, artifact);
          },
          operation,
          rollbackOnFailure,
          canBatchOrdinary,
        );
        return {
          items,
          ancestry: ancestry as ReadonlyMap<string, ConversationArtifact>,
        };
      },
      // Lease and content must share one snapshot, including when the page is empty.
      readSessionMany(
        sessionId: string,
        version: number,
        ids: readonly string[],
      ) {
        return readManyWithLease(
          ids,
          { sessionId, version },
          undefined,
          operation,
          rollbackOnFailure,
        );
      },
      async read(id: string) {
        return (await readMany([id]))[0] ?? null;
      },
    };
  };
  const base = methods();
  return {
    ...base,
    /** Explicit read-only operation; escaped methods revert to strict after disposal. */
    beginReadOperation(
      this: typeof base & {
        readToolTurnsSnapshot: typeof readToolTurnsSnapshot;
        beginReadOperation?: unknown;
      },
      signal?: AbortSignal,
      options?: {
        readonly rollbackOnFailure?: boolean;
        readonly historyPage?: boolean;
      },
    ) {
      const entry = this?.beginReadOperation;
      // A wrapper replacing any read boundary must retain its strict custom path,
      // including replacements made while an operation is awaiting hydration.
      const owned = () =>
        Boolean(
          this &&
          this.readMany === base.readMany &&
          this.readManyWithAncestry === base.readManyWithAncestry &&
          this.readSessionMany === base.readSessionMany &&
          this.read === base.read &&
          this.readToolTurnsSnapshot === readToolTurnsSnapshot &&
          this.beginReadOperation === entry,
        );
      if (!owned()) return undefined;
      const operation = committedPeriodReadOperation(
        database,
        signal,
        options?.historyPage,
      );
      const canBatchOrdinary = () =>
        Boolean(options?.historyPage && operation.active && owned());
      const rollback = options?.rollbackOnFailure;
      const scoped = methods(operation, rollback, canBatchOrdinary);
      const toolSnapshot = conversationToolSnapshotReader(
        database,
        ensure,
        operation,
      );
      const reads = {
        get healthContextReportScope() {
          return owned() && operation.active
            ? operation.reportScope
            : undefined;
        },
        readToolTurnsSnapshot: (
          ...args: Parameters<typeof readToolTurnsSnapshot>
        ) =>
          (owned() && operation.active
            ? toolSnapshot
            : this.readToolTurnsSnapshot)(...args),
        readMany: (ids: readonly string[]) =>
          (owned() ? scoped : this).readMany(ids),
        readManyWithAncestry: (ids: readonly string[]) =>
          (owned() ? scoped : this).readManyWithAncestry(ids),
        readManyFinalFence: (ids: readonly string[]) =>
          canBatchOrdinary?.()
            ? readManyWithLease(
                ids,
                undefined,
                undefined,
                operation,
                rollback,
                canBatchOrdinary,
              )
            : (owned() ? scoped : this).readMany(ids),
        readSessionMany: (
          id: string,
          version: number,
          ids: readonly string[],
        ) => (owned() ? scoped : this).readSessionMany(id, version, ids),
        read: (id: string) => (owned() ? scoped : this).read(id),
        dispose: operation.dispose,
      };
      const originalReadMany = reads.readMany;
      const boundReaderCurrent = () =>
        owned() && operation.active && reads.readMany === originalReadMany;
      boundParentReaders.set(reads, {
        storage: this,
        signal,
        async read(ids, capturePhase) {
          if (!boundReaderCurrent()) return undefined;
          const canWitness =
            capturePhase === 'initial' || capturePhase === 'final';
          // Complete schema preparation before minting a read-only witness.
          if (canWitness) await ensure();
          if (!boundReaderCurrent()) return { rows: undefined };
          return readGuardedBoundRows(
            database,
            ids,
            boundReaderCurrent,
            canWitness,
            (targetIds, record, witness) =>
              readManyWithLease(
                targetIds,
                undefined,
                undefined,
                operation,
                rollback,
                undefined,
                record,
                boundReaderCurrent,
                witness,
              ),
          );
        },
      });
      return registerHistoryRead(reads, database, canBatchOrdinary);
    },
  };
}
