const owns = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function selectEntryRoute(settings) {
  const launchSettings =
    settings && typeof settings === 'object' ? settings : {};

  if (owns(launchSettings, 'OROT_E2E_PROBE')) {
    // Only an explicit Detox launch argument may opt into a synthetic app entry.
    const probe = launchSettings.OROT_E2E_PROBE;
    if (
      probe !== 'appointments' &&
      probe !== 'medical-appointment-classification' &&
      probe !== 'graph' &&
      probe !== 'checkpoint' &&
      probe !== 'safe-area' &&
      probe !== 'safe-area-blood-pressure' &&
      probe !== 'ai-feature-visit-questions'
    ) {
      throw new Error('Unsupported OROT_E2E_PROBE value');
    }
    if (
      owns(launchSettings, 'OROT_AGENT_MEMORY_PROBE') ||
      owns(launchSettings, 'OROT_STORAGE_PROBE')
    ) {
      throw new Error('Conflicting Orot E2E probe selectors');
    }
    return probe;
  }

  if (owns(launchSettings, 'OROT_AGENT_MEMORY_PROBE')) {
    if (owns(launchSettings, 'OROT_STORAGE_PROBE')) {
      throw new Error('Conflicting Orot E2E probe selectors');
    }
    return 'agent-memory';
  }

  return 'storage';
}

module.exports = { selectEntryRoute };
