/** A closed cause produced only after the provider reports an explicit offline error. */
export class PublicSearchOfflineError extends Error {}

/** App-owned retrieval limitations only, never provider exception text. */
export const publicSearchFailureGaps = {
  timeout: 'Public web search timed out; no external evidence was retrieved.',
  offline:
    'Public web search was unavailable offline; no external evidence was retrieved.',
  unavailable:
    'Public web search was unavailable; no external evidence was retrieved.',
} as const;
