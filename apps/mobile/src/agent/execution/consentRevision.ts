let revision = 0;
let reuseEnabled = true;

/** Revocation also invalidates approvals already cached inside active workflows. */
export const consentRevision = () => revision;
export const canReuseConsent = () => reuseEnabled;
export function beginConsentReset() {
  revision += 1;
  reuseEnabled = false;
}
export function finishConsentReset() {
  reuseEnabled = true;
}
