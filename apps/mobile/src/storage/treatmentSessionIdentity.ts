/** Legacy unowned treatment sessions stay hidden until cleared by existing data controls. */
export const treatmentSessionPrefix = 'local-treatment:';

// Guard JSON access so a damaged ordinary artifact still reaches its usual unavailable state.
export const treatmentArtifactPredicate =
  "json_type(CASE WHEN json_valid(a.result_json) THEN a.result_json ELSE '{}' END, '$.treatmentContext') IS NOT NULL";
