import type { SqlExecutor } from '@orot/storage';

/** SQLite statement-time guards close the gap between asynchronous source validation
 * and INSERT/UPDATE on a shared native connection. Keep these exact text expressions
 * aligned with userStatementMemory's verbatim projection; tests exercise both paths. */
export async function setupUserStatementInsertGuards(
  sql: SqlExecutor,
  tables: Set<unknown>,
) {
  const state =
    "json_extract(NEW.record_json, '$.meta.provenance.reviewState') = 'user_stated'";
  const text = "json_extract(NEW.record_json, '$.text')";
  const refs =
    "json_each(NEW.record_json, '$.meta.provenance.sourceReferences') r";
  for (const event of ['INSERT', 'UPDATE']) {
    if (tables.has('manual_history_entries')) {
      const expected =
        "'사용자가 직접 남긴 기록 (의학적 검증 아님). 기록 시각: ' || json_extract(h.payload_json, '$.recordedAt') || '. 발생일: ' || CASE WHEN json_extract(h.payload_json, '$.effectiveDate.status') = 'known' THEN json_extract(h.payload_json, '$.effectiveDate.date') ELSE '알 수 없음' END || '.' || char(10) || json_extract(h.payload_json, '$.title') || char(10) || json_extract(h.payload_json, '$.details')";
      await sql.execute(
        `CREATE TRIGGER IF NOT EXISTS user_statement_history_insert_${event.toLowerCase()} BEFORE ${event} ON agent_memory_records WHEN ${state} AND EXISTS (SELECT 1 FROM ${refs} WHERE json_extract(r.value, '$.kind') = 'manual_history' AND NOT EXISTS (SELECT 1 FROM manual_history_entries h WHERE h.id = json_extract(r.value, '$.id') AND NOT EXISTS (SELECT 1 FROM manual_history_entries n WHERE n.supersedes_id = h.id) AND ${text} = (${expected}))) BEGIN SELECT RAISE(ABORT, 'Original user statement is unavailable'); END`,
      );
    }
    if (tables.has('conversation_artifacts')) {
      const expected =
        "json_extract(a.result_json, '$.createdAt') || ' 사용자가 직접 말한 내용 (당시의 진술이며 현재 상태나 의학적으로 확인된 사실이 아님):' || char(10) || trim(json_extract(a.result_json, '$.question'))";
      await sql.execute(
        `CREATE TRIGGER IF NOT EXISTS user_statement_conversation_insert_${event.toLowerCase()} BEFORE ${event} ON agent_memory_records WHEN ${state} AND EXISTS (SELECT 1 FROM ${refs} WHERE json_extract(r.value, '$.kind') = 'conversation_user_statement' AND NOT EXISTS (SELECT 1 FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id JOIN conversation_artifact_generation g ON g.singleton = 1 AND g.generation = s.generation WHERE a.id = json_extract(r.value, '$.id') AND s.hidden = 0 AND json_extract(a.result_json, '$.status') = 'complete' AND ${text} = (${expected}))) BEGIN SELECT RAISE(ABORT, 'Original user statement is unavailable'); END`,
      );
    }
  }
}
