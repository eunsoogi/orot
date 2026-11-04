/** Legacy rows have unknown inputs and are retained privately, never exposed as readable artifacts. */
export const completeSummaryDeletion =
  "CASE WHEN json_valid(result_json) THEN coalesce(json_extract(result_json, '$.inputLineage') = 'complete', 0) ELSE 0 END";
