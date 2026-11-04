/** Select all summary descendants across both artifact catalogs before source edges are removed. */
export function generatedSummaryDescendants(
  rootKind: 'generated_summary' | 'generated_conversation',
  rootId = 'OLD.id',
): string {
  return `WITH RECURSIVE descendants(kind, id) AS (
    SELECT '${rootKind}', ${rootId}
    UNION SELECT 'generated_summary', s.summary_id FROM symptom_summary_sources s JOIN descendants d ON s.record_kind = d.kind AND s.record_id = d.id
    UNION SELECT 'generated_conversation', c.artifact_id FROM conversation_artifact_sources c JOIN descendants d ON c.record_kind = d.kind AND c.record_id = d.id
  ) SELECT id FROM descendants WHERE kind = 'generated_summary' AND NOT (kind = '${rootKind}' AND id = ${rootId})`;
}
