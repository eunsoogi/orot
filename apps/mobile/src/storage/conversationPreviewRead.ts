import type { SqlDatabase } from '@orot/storage';
import { decodeConversationArtifact } from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { conversationPreviewSchemaSnapshot } from './conversationPreviewSchema';
import type { Lease, Template } from './conversationPreviewStorage';
import { eligibleConversationPreviewSources } from './conversationPreviewSources';

/** Restore only a source-checked, interrupted preview. */
export function createConversationPreviewReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return {
    /** Recovered prose remains an incomplete preview and is never a validated answer. */
    async readInterruptedPreview(lease: Lease) {
      await ensure();
      let body: string | null = null;
      await database.transaction(async tx => {
        const result = await tx.execute(
          "SELECT p.template_json, p.schema_snapshot, p.body, r.question, r.created_at FROM conversation_request_previews p JOIN conversation_requests r ON r.id = p.request_id AND r.session_id = p.session_id AND r.session_version = p.session_version AND r.preview_boundary = p.boundary JOIN conversation_artifact_sessions s ON s.id = r.session_id AND s.hidden = 0 AND s.version = r.session_version JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE p.request_id = ? AND p.session_id = ? AND p.session_version = ? AND r.status = 'interrupted'",
          [lease.requestId, lease.sessionId, lease.sessionVersion],
        );
        const row = result.rows[0];
        if (!row) return;
        const schema = await conversationPreviewSchemaSnapshot(tx);
        if (
          !schema ||
          schema !== row.schema_snapshot ||
          typeof row.template_json !== 'string' ||
          typeof row.body !== 'string' ||
          !row.body
        ) {
          await tx.execute(
            'DELETE FROM conversation_request_previews WHERE request_id = ?',
            [lease.requestId],
          );
          return;
        }
        let template: Template;
        try {
          template = JSON.parse(row.template_json) as Template;
        } catch {
          await tx.execute(
            'DELETE FROM conversation_request_previews WHERE request_id = ?',
            [lease.requestId],
          );
          return;
        }
        const decoded = decodeConversationArtifact(
          JSON.stringify({
            id: lease.requestId,
            sessionId: lease.sessionId,
            createdAt: row.created_at,
            question: row.question,
            status: 'partial',
            answer: row.body,
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
        body = row.body;
      });
      return body;
    },
  };
}
