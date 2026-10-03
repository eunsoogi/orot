const HASH_START = 0xcbf29ce484222325n;
const HASH_MULTIPLIER = 0x100000001b3n;
const HASH_MODULUS = 18446744073709551615n;

export function createFixtureId(seed: string): string {
  if (seed.trim().length === 0) {
    throw new Error('Fixture seed must be a non-empty string.');
  }

  let hash = HASH_START;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * HASH_MULTIPLIER + BigInt(seed.charCodeAt(index))) % HASH_MODULUS;
  }

  return `fixture-${hash.toString(16).padStart(16, '0')}`;
}

export function createRecordId(fixtureId: string, name: string): string {
  return `${fixtureId}:${name}`;
}
