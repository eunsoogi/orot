import type { ExecutionConsentPort } from '@orot/agent-runtime';

const settingsOnlyPorts = new WeakSet<object>();

/** Used by the actual Settings adapter, which can never show a decision UI. */
export function markSettingsOnlyExecutionConsent(port: ExecutionConsentPort) {
  settingsOnlyPorts.add(port);
}

/** Identity is not inherited by a spread copy or an unrelated authorizer. */
export function isSettingsOnlyExecutionConsent(port: object) {
  return settingsOnlyPorts.has(port);
}
