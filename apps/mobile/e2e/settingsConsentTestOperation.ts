/** Keep native protected-store imports lazy for every unrelated broker operation. */
export async function runSettingsConsentTestOperation(
  parameters: Record<string, unknown>,
) {
  const { runSettingsConsentPersistenceOperation } =
    await import('./settingsConsentPersistenceOperation');
  return runSettingsConsentPersistenceOperation(parameters);
}
