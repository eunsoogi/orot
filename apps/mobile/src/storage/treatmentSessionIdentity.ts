/** Dedicated treatment sessions share the encrypted store and its clear-data generation. */
export const treatmentSessionPrefix = 'local-treatment:';

export function treatmentSessionId(generation: number) {
  return `${treatmentSessionPrefix}${generation}`;
}
