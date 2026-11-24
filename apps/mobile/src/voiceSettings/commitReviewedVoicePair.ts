import type {
  createConsentAuthority,
  ConsentAuthorityState,
} from '../agent/execution/consentAuthority';
import type { SettingsConsentGrant } from '../agent/execution/settingsConsentGrant';

type Slot = 'voice' | 'voice-responses';
type Authority = ReturnType<typeof createConsentAuthority>;
type OwnedGrant = {
  readonly slot: Slot;
  readonly authority: Authority;
  readonly grant: (generation: string) => SettingsConsentGrant;
};
type GenerationPair = Readonly<{ voice: string; 'voice-responses': string }>;

export type VoicePairCommitPorts = {
  readonly stageGrant: (
    slot: Slot,
    token: string,
    grant: SettingsConsentGrant,
  ) => Promise<void>;
  readonly cancelGrant: (token: string) => Promise<void>;
  /** Writes nonauthorizing owner-bound metadata; never replaces the effective selection. */
  readonly stagePair: (generations: GenerationPair) => Promise<boolean>;
  readonly isPriorPairCurrent: (
    slot: Slot,
    generation: string,
  ) => Promise<boolean>;
  readonly publishTogether: (
    modelGrants: readonly { readonly slot: Slot; readonly token: string }[],
    generations: GenerationPair,
    current: () => boolean,
  ) => Promise<void>;
};

/** Both exact recipient approvals precede this operation. Staged grants are
 * unauthorized with either old or newly staged per-slot authority until the
 * protected transaction atomically publishes both and the effective selection. */
export async function commitReviewedVoicePair(
  targets: readonly [OwnedGrant, OwnedGrant],
  ports: VoicePairCommitPorts,
  current: () => boolean,
) {
  if (
    targets[0].slot !== 'voice' ||
    targets[1].slot !== 'voice-responses' ||
    targets[0].authority === targets[1].authority ||
    !current()
  )
    throw new Error('Voice pair owner unavailable');
  const suspended: {
    target: OwnedGrant;
    next: ConsentAuthorityState;
    prior: ConsentAuthorityState | null;
  }[] = [];
  const staged: { slot: Slot; token: string }[] = [];
  let publishing = false;
  try {
    for (const target of targets) {
      const state = await target.authority.suspendForJointReplacement(current);
      suspended.push({ target, ...state });
    }
    const generations = Object.freeze({
      voice: suspended[0]!.next.generation,
      'voice-responses': suspended[1]!.next.generation,
    });
    if (generations.voice === generations['voice-responses'])
      throw new Error('Voice permission generations must be independent');

    for (const { target, next } of suspended) {
      if (!current()) throw new Error('Voice pair owner changed');
      const grant = target.grant(next.generation);
      if (grant.identity.authorityGeneration !== next.generation)
        throw new Error('Voice permission generation changed');
      const token = next.generation + '-model';
      staged.push({ slot: target.slot, token });
      await ports.stageGrant(target.slot, token, grant);
    }
    if (!current() || !(await ports.stagePair(generations)) || !current())
      throw new Error('Voice pair staging unavailable');
    const witnesses: (() => boolean)[] = [];
    const valid = () => current() && witnesses.every(witness => witness());
    for (const { target, next } of suspended) {
      if (!(await target.authority.complete(next, async () => valid())))
        throw new Error('Voice pair owner changed');
      if ((await target.authority.current())?.generation !== next.generation)
        throw new Error('Voice pair authority unavailable');
      witnesses.push(target.authority.witness(next.generation));
    }
    if (!valid()) throw new Error('Voice pair owner changed');
    publishing = true;
    await ports.publishTogether(staged, generations, valid);
  } catch (error) {
    // Could have crossed the only publish boundary. Durable suspension is safe;
    // never restore older permission when protected publication is uncertain.
    for (const { target, next } of [...suspended].reverse()) {
      try {
        await target.authority.suspendCurrent(next.generation);
      } catch {
        // Faulted authority remains fail closed.
      }
    }
    if (!publishing) {
      let recoveredAudio: (() => boolean) | undefined;
      for (const { target, prior, next } of suspended) {
        const audio = target.slot === 'voice';
        if (!prior || (!audio && !recoveredAudio?.())) continue;
        const unchanged = async () =>
          (audio || recoveredAudio?.() === true) &&
          (await ports.isPriorPairCurrent(target.slot, prior.generation)) &&
          (audio || recoveredAudio?.() === true);
        try {
          const restored = await target.authority.restore(
            next,
            prior,
            unchanged,
          );
          if (
            audio &&
            restored &&
            (await target.authority.current())?.generation === prior.generation
          )
            recoveredAudio = target.authority.witness(prior.generation);
          if (!audio && restored && !recoveredAudio?.())
            await target.authority.suspendCurrent(prior.generation);
        } catch {
          // Never recover another scope when the exact owner cannot be proven.
        }
      }
    }
    for (const { token } of staged)
      await ports.cancelGrant(token).catch(() => {});
    throw error;
  }
}
