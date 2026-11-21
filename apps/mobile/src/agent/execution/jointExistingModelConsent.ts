import type {
  createConsentAuthority,
  ConsentAuthorityState,
} from './consentAuthority';
import type { SettingsConsentGrant } from './settingsConsentGrant';
import type {
  createSettingsConsentStorage,
  SettingsConsentDomain,
} from '../../storage/settingsConsentStorage';

type Authority = ReturnType<typeof createConsentAuthority>;
type Storage = ReturnType<typeof createSettingsConsentStorage>;
type Target = {
  readonly slot: 'calendar' | 'conversation';
  readonly authority: Authority;
  readonly ownerCurrent: () => boolean;
  readonly grants: (generation: string) => readonly {
    readonly domain: SettingsConsentDomain;
    readonly grant: SettingsConsentGrant;
  }[];
};

/**
 * Run only after one explicit review for two exact, independently
 * witnessed recipients. Inference never calls this function. Fresh generations
 * carry no grants, even if the process dies after either Keychain activation.
 * The protected SQLite transaction is the sole joint publication point.
 */
export async function commitJointExistingModelConsent(
  targets: readonly [Target, Target],
  storage: Storage,
  requestCurrent: () => boolean,
  replacement?: {
    readonly stage: () => Promise<boolean>;
    readonly compensate: () => Promise<void>;
  },
) {
  if (
    targets[0].slot !== 'conversation' ||
    targets[1].slot !== 'calendar' ||
    targets[0].authority === targets[1].authority
  )
    throw new Error('Invalid joint permission owners');
  const current = () =>
    requestCurrent() && targets.every(target => target.ownerCurrent());
  if (!current()) throw new Error('Joint permission owner changed');
  const touched: {
    target: Target;
    prior: ConsentAuthorityState | null;
    next: ConsentAuthorityState;
  }[] = [];
  const staged: {
    slot: Target['slot'];
    token: string;
    domain: SettingsConsentDomain;
  }[] = [];
  let publishing = false;
  try {
    for (const target of targets) {
      const states = await target.authority.suspendForJointReplacement(current);
      touched.push({ target, ...states });
    }
    for (const { target, next } of touched) {
      if (!current()) throw new Error('Joint permission owner changed');
      const grants = target.grants(next.generation);
      if (
        !grants.some(entry => entry.domain === 'model') ||
        (target.slot === 'calendar' &&
          grants.some(entry => entry.domain !== 'model'))
      )
        throw new Error('Invalid joint permission scope');
      for (const { domain, grant } of grants) {
        if (grant.identity.authorityGeneration !== next.generation)
          throw new Error('Joint permission generation changed');
        const token = `${next.generation}-${target.slot}-${domain}`;
        await storage.stage(target.slot, token, grant, domain);
        staged.push({ slot: target.slot, token, domain });
      }
    }
    // A newly chosen Conversation selection may be staged only while both
    // generations are suspended. It cannot authorize until protected commit.
    if (replacement && (!current() || !(await replacement.stage())))
      throw new Error('Joint permission selection changed');
    const witnesses: (() => boolean)[] = [];
    for (const { target, next } of touched) {
      const valid = () => current() && witnesses.every(witness => witness());
      if (!(await target.authority.complete(next, async () => valid())))
        throw new Error('Joint permission owner changed');
      const active = await target.authority.current();
      if (active?.generation !== next.generation)
        throw new Error('Joint permission owner changed');
      witnesses.push(target.authority.witness(next.generation));
    }
    const valid = () => current() && witnesses.every(witness => witness());
    if (!valid()) throw new Error('Joint permission owner changed');
    publishing = true;
    await storage.activateJointScopes(staged, valid, true);
  } catch (error) {
    if (!publishing) await replacement?.compensate().catch(() => {});
    // No old generation is restorable after SQL publication may have begun.
    // Before it begins, only exact generations/principals may restore their prior grant.
    for (const { target, prior, next } of touched.reverse()) {
      try {
        await target.authority.suspendCurrent(next.generation);
        if (!publishing && prior && target.ownerCurrent())
          await target.authority.restore(next, prior, async () =>
            target.ownerCurrent(),
          );
      } catch {
        // A missing or unavailable durable owner fails closed.
      }
    }
    for (const { token } of staged) await storage.cancel(token).catch(() => {});
    throw error;
  }
}
