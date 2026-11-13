import { createConversationPreviewReader } from './conversationPreviewRead';
import { eligibleConversationPreviewSources } from './conversationPreviewSources';
import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import type { ConversationArtifact } from './conversationArtifactTypes';
import type { ConversationArtifactSource } from '../ragConversation/conversationArtifactSources';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { createResearchArtifactStorage } from './researchArtifactStorage';
import {
  conversationPreviewSchemaSnapshot,
  setupConversationPreviewSchema,
} from './conversationPreviewSchema';
import { decodeConversationSubmittedInput } from '../ragConversation/conversationSubmittedInput';

export type Lease = {
  readonly requestId: string;
  readonly sessionId: string;
  readonly sessionVersion: number;
};
export type Template = {
  readonly providerId: string;
  readonly modelId: string;
  readonly sources: readonly ConversationArtifactSource[];
};

async function activeRequest(tx: SqlExecutor, lease: Lease) {
  const result = await tx.execute(
    "SELECT r.question, r.created_at, r.preview_boundary, r.input_json FROM conversation_requests r JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.hidden = 0 AND s.version = r.session_version JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE r.id = ? AND r.session_id = ? AND r.session_version = ? AND r.status = 'active'",
    [lease.requestId, lease.sessionId, lease.sessionVersion],
  );
  const row = result.rows[0];
  if (
    !row ||
    typeof row.question !== 'string' ||
    typeof row.created_at !== 'string' ||
    typeof row.preview_boundary !== 'number' ||
    !Number.isSafeInteger(row.preview_boundary) ||
    row.preview_boundary < 0
  )
    throw new Error('Conversation request is unavailable.');
  return row;
}

/** Raw preview is private, incomplete, and never a conversation artifact or model-history source. */
export function createConversationPreviewStorage(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    async invalidatePreview(lease: Lease) {
      await ensure();
      let boundary = 0;
      await database.transaction(async tx => {
        const row = await activeRequest(tx, lease);
        if (Number(row.preview_boundary) >= Number.MAX_SAFE_INTEGER)
          throw new Error('Conversation preview is unavailable.');
        boundary = Number(row.preview_boundary) + 1;
        await tx.execute(
          'UPDATE conversation_requests SET preview_boundary = ? WHERE id = ?',
          [boundary, lease.requestId],
        );
        await tx.execute(
          'DELETE FROM conversation_request_previews WHERE request_id = ?',
          [lease.requestId],
        );
      });
      return boundary;
    },
    async preparePreview(lease: Lease, boundary: number, template: Template) {
      await ensure();
      // Existing research storage owns its own schema; install its source fence before admitting a preview.
      await createResearchArtifactStorage(database).currentGeneration();
      let admitted = false;
      await database.transaction(async tx => {
        await setupConversationPreviewSchema(tx);
        const row = await activeRequest(tx, lease);
        if (row.preview_boundary !== boundary)
          throw new Error('Conversation preview changed.');
        const submitted =
          row.input_json === null
            ? null
            : decodeConversationSubmittedInput(
                JSON.parse(String(row.input_json)),
              );
        if (
          row.input_json !== null &&
          (!submitted ||
            submitted.requestId !== lease.requestId ||
            submitted.sessionId !== lease.sessionId ||
            submitted.question !== row.question)
        )
          throw new Error('Conversation preview input is invalid.');
        const schema = await conversationPreviewSchemaSnapshot(tx);
        if (
          !schema ||
          submitted?.ocr ||
          !eligibleConversationPreviewSources(template.sources)
        )
          return;
        const artifact = {
          id: lease.requestId,
          sessionId: lease.sessionId,
          createdAt: row.created_at,
          question: row.question,
          status: 'partial',
          answer: ' ',
          providerId: template.providerId,
          modelId: template.modelId,
          sources: template.sources,
          citations: [],
        };
        const decoded = decodeConversationArtifact(JSON.stringify(artifact));
        if (!decoded) throw new Error('Conversation preview input is invalid.');
        await assertConversationArtifactCurrent(tx, database, decoded, true);
        await tx.execute(
          'INSERT INTO conversation_request_previews (request_id, session_id, session_version, boundary, template_json, schema_snapshot, body) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            lease.requestId,
            lease.sessionId,
            lease.sessionVersion,
            boundary,
            JSON.stringify({
              providerId: template.providerId,
              modelId: template.modelId,
              sources: template.sources,
            }),
            schema,
            '',
          ],
        );
        admitted = true;
      });
      return admitted;
    },
    async writePreview(lease: Lease, boundary: number, body: string) {
      await ensure();
      let written = false;
      await database.transaction(async tx => {
        const row = await activeRequest(tx, lease);
        const result = await tx.execute(
          'SELECT template_json, schema_snapshot FROM conversation_request_previews WHERE request_id = ? AND session_id = ? AND session_version = ? AND boundary = ?',
          [lease.requestId, lease.sessionId, lease.sessionVersion, boundary],
        );
        const preview = result.rows[0];
        if (!preview || row.preview_boundary !== boundary) return;
        const schema = await conversationPreviewSchemaSnapshot(tx);
        if (
          !schema ||
          schema !== preview.schema_snapshot ||
          typeof preview.template_json !== 'string' ||
          !body ||
          body.length > 64_000
        ) {
          await tx.execute(
            'DELETE FROM conversation_request_previews WHERE request_id = ?',
            [lease.requestId],
          );
          return;
        }
        const template = JSON.parse(preview.template_json) as Template;
        const decoded = decodeConversationArtifact(
          JSON.stringify({
            id: lease.requestId,
            sessionId: lease.sessionId,
            createdAt: row.created_at,
            question: row.question,
            status: 'partial',
            answer: body,
            ...template,
            citations: [],
          }),
        );
        if (!decoded || !eligibleConversationPreviewSources(decoded.sources)) {
          await tx.execute(
            'DELETE FROM conversation_request_previews WHERE request_id = ?',
            [lease.requestId],
          );
          return;
        }
        try {
          await assertConversationArtifactCurrent(tx, database, decoded, true);
        } catch {
          await tx.execute(
            'DELETE FROM conversation_request_previews WHERE request_id = ?',
            [lease.requestId],
          );
          return;
        }
        await tx.execute(
          'UPDATE conversation_request_previews SET body = ? WHERE request_id = ? AND boundary = ?',
          [body, lease.requestId, boundary],
        );
        written = true;
      });
      return written;
    },
    ...createConversationPreviewReader(database, ensure),
  };
}
