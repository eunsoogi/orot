/** Keeps the encrypted database module lazy until visit-question prep needs it. */
export function loadSecureDatabaseModule() {
  return import('../../storage/secureDatabase');
}
