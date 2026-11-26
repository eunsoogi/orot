import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import {
  archivedVisitBookmarkOriginal,
  archivedVisitRevision,
  type ArchivedVisitBookmarkMarker,
} from './archivedVisitBookmarkIdentity';

export type VisitBookmarkQuestion = Readonly<{
  id: string;
  questionText: string;
  rationale: string;
}>;

export type ArchivedVisitInlineQuestion = VisitBookmarkQuestion & {
  readonly priority: 'routine' | 'important';
};
type Preview = Readonly<{ questions: readonly ArchivedVisitInlineQuestion[] }>;
type Lease = Readonly<{ id: string; version: number }>;
type Current = () => boolean;

type PreviewOwner = Readonly<{
  artifactId: string;
  serialized: string;
  displayed: string;
  lease: Lease;
  current: Current;
}>;

/** An explicit cold preview borrows only the same immutable artifact accepted by the
 * existing writer. A read or abandoned preview never provisions or writes a bookmark. */
export function createArchivedVisitBookmarkAccess(
  database: SqlDatabase,
  originalSql: string,
  resolve: (
    tx: SqlExecutor,
    row: Record<string, unknown> | undefined,
    id: string,
    current: Current,
  ) => Promise<{
    target: string;
    questions: readonly ArchivedVisitInlineQuestion[];
  } | null>,
  bookmark: (
    input: Omit<PreviewOwner, 'serialized'>,
    archived: { serialized: string; confirmProtected: () => Promise<boolean> },
  ) => Promise<boolean>,
) {
  // Raw exact bytes are held only after explicit protected open; never put in a UI receipt.
  const owners = new WeakMap<Preview, PreviewOwner>();
  return {
    async readArchivedVisitBookmarkPreview(input: {
      marker: ArchivedVisitBookmarkMarker;
      lease: Lease;
      current: Current;
    }) {
      const original = archivedVisitBookmarkOriginal(input.marker, input.lease);
      if (!original || !input.current()) return null;
      let staged: { preview: Preview; owner: PreviewOwner } | undefined;
      await database.transaction(async tx => {
        if (!input.current()) return;
        const row = (
          await tx.execute(
            `SELECT a.result_json, a.session_id, a.created_at FROM conversation_artifacts a ${originalSql}
             AND a.id = ? AND s.id = ? AND s.version = ? AND a.created_at = ? AND r.created_at = a.created_at`,
            [
              original.id,
              original.sessionId,
              original.version,
              original.createdAt,
            ],
          )
        ).rows[0];
        if (
          typeof row?.result_json !== 'string' ||
          archivedVisitRevision(row.result_json) !== original.revision ||
          !input.current()
        )
          return;
        const value = await resolve(tx, row, original.id, input.current);
        if (!value || !input.current()) return;
        staged = {
          preview: Object.freeze({
            questions: Object.freeze(
              value.questions.map(question => Object.freeze({ ...question })),
            ),
          }),
          owner: {
            artifactId: original.id,
            serialized: row.result_json,
            displayed: value.target,
            lease: { id: original.sessionId, version: original.version },
            current: input.current,
          },
        };
      });
      if (!staged || !input.current()) return null;
      owners.set(staged.preview, staged.owner);
      return staged.preview;
    },
    abandonArchivedVisitBookmarkPreview(preview: Preview) {
      owners.delete(preview);
    },
    async bookmarkArchivedVisitQuestions(input: {
      preview: Preview;
      lease: Lease;
      current: Current;
      confirmProtected: () => Promise<boolean>;
    }) {
      const owner = owners.get(input.preview);
      owners.delete(input.preview);
      if (
        !owner ||
        owner.lease.id !== input.lease.id ||
        owner.lease.version !== input.lease.version
      )
        return false;
      const current = () => owner.current() && input.current();
      if (!current() || !(await input.confirmProtected()) || !current())
        return false;
      return bookmark(
        {
          artifactId: owner.artifactId,
          displayed: owner.displayed,
          lease: owner.lease,
          current,
        },
        {
          serialized: owner.serialized,
          confirmProtected: input.confirmProtected,
        },
      );
    },
  };
}
