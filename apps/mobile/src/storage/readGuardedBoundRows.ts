import type { ConversationArtifact } from './conversationArtifactCodec';
import type { SqlDatabase } from '@orot/storage';
import {
  BoundReadWitnessUnavailable,
  createBoundReadResultWitness,
  type BoundReadResultWitness,
} from './boundReadResultWitness';

/** Rows and fingerprints remain scoped to the minted bound reader and never to a retry. */
export async function readGuardedBoundRows(
  database: SqlDatabase,
  ids: readonly string[],
  boundReaderCurrent: () => boolean,
  canProbe: boolean,
  read: (
    targetIds: readonly string[],
    record: (
      raw?: string,
      value?: ConversationArtifact,
    ) => ConversationArtifact | undefined,
    witness?: BoundReadResultWitness,
  ) => Promise<(ConversationArtifact | null)[]>,
) {
  const attempt = async (witness?: BoundReadResultWitness) => {
    const targetIds = witness ? [...new Set(ids)] : ids;
    let previous: string | undefined;
    let sequence = 0;
    const targetTokens: (number | undefined)[] = [];
    const share = ids.some((id, index) => ids[index - 1] === id);
    const record = (raw?: string, same = raw === previous) => {
      if (!same) sequence++;
      previous = raw;
      targetTokens.push(raw === undefined ? undefined : sequence);
    };
    let priorValue: ConversationArtifact | undefined;
    let shared = targetIds.length !== ids.length;
    const recordAndShare = (raw?: string, value?: ConversationArtifact) => {
      const same = raw === previous;
      record(raw, same);
      if (same && raw !== undefined && value && priorValue?.id === value.id) {
        shared = true;
        return priorValue;
      }
      priorValue = value;
      return undefined;
    };
    const targetRows = await read(
      targetIds,
      share
        ? recordAndShare
        : raw => {
            record(raw);
            return undefined;
          },
      witness,
    );
    if (witness && targetRows.length !== targetIds.length)
      throw new BoundReadWitnessUnavailable();
    // Only expand after the entire unique-root plan has passed the native
    // witness, retaining the original slot order and adjacent digest rights.
    const slots =
      shared && targetIds !== ids
        ? new Map(targetIds.map((id, index) => [id, index]))
        : undefined;
    const rows = slots
      ? ids.map(id => targetRows[slots.get(id)!] ?? null)
      : targetRows;
    const tokens = slots
      ? ids.map(id => targetTokens[slots.get(id)!])
      : targetTokens;
    return {
      get rows() {
        return (!shared && !witness) || boundReaderCurrent() ? rows : undefined;
      },
      get tokens() {
        return boundReaderCurrent() && tokens.length === rows.length
          ? tokens
          : undefined;
      },
    };
  };
  const witness =
    canProbe && ids.length > 0
      ? createBoundReadResultWitness(database, boundReaderCurrent)
      : undefined;
  if (!witness) return attempt();
  try {
    const rows = await attempt(witness);
    if (!witness.current()) throw new BoundReadWitnessUnavailable();
    return rows;
  } catch (error) {
    if (!(error instanceof BoundReadWitnessUnavailable)) throw error;
  } finally {
    witness.dispose();
  }
  // A truthy revoked witness tells the caller not to call a replaced scoped
  // reader; it can only fall back to literal stock IDs or fail authority.
  return boundReaderCurrent()
    ? attempt()
    : { rows: undefined, tokens: undefined };
}
