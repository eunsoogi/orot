export interface OpenAIAccountSummary {
  readonly issuedClientID: string;
  readonly requiresSignIn: boolean;
  readonly hasDirectPlanAccess: boolean;
}

/** Keep the bridge account projection closed; credential fields must never escape into JS. */
export function readAccountSummary(value: unknown): OpenAIAccountSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidAccountSummary();
  }
  const summary = value as Record<string, unknown>;
  const keys = Object.keys(summary).sort();
  if (
    keys.join(',') !== 'hasDirectPlanAccess,issuedClientID,requiresSignIn' ||
    !isIssuedClientID(summary.issuedClientID) ||
    typeof summary.requiresSignIn !== 'boolean' ||
    typeof summary.hasDirectPlanAccess !== 'boolean'
  ) {
    throw invalidAccountSummary();
  }
  return {
    issuedClientID: summary.issuedClientID,
    requiresSignIn: summary.requiresSignIn,
    hasDirectPlanAccess: summary.hasDirectPlanAccess,
  };
}

export function isIssuedClientID(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== 'dynamic_agent_client' &&
    /^[A-Za-z0-9._-]{1,256}$/.test(value)
  );
}

export function invalidAccountSummary(): Error {
  const error = new Error('The ChatGPT account summary is invalid.');
  Object.assign(error, { code: 'INVALID_CHATGPT_ACCOUNT_SUMMARY' });
  return error;
}
