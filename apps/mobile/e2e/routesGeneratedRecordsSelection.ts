/** Test-bundle-only admission. Never open or modify storage for an unrelated launch. */
export function routesGeneratedRecordsEnabled(
  settings: Readonly<Record<string, unknown>>,
) {
  return (
    settings.OROT_TEST_SCENARIO === 'ai-feature-visit-questions' &&
    settings.OROT_ROUTES_GENERATED_RECORDS === 'synthetic'
  );
}
