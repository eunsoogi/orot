import { readLivePreferences, type Preferences } from './liveVoicePreferences';

type Owner = string;
export type LiveVoicePreferenceStore = ReturnType<
  typeof createLiveVoicePreferenceStore
>;

/** A preferences-only write is not a settings-consent or credential mutation.
 * Keep it serialized and bound to a credential epoch; do not notify active calls. */
export function createLiveVoicePreferenceStore(
  input: Readonly<{
    currentOwner(): Promise<Owner | null>;
    read(): Promise<unknown>;
    write(record: { owner: Owner; preferences: Preferences }): Promise<void>;
  }>,
) {
  let pending = Promise.resolve();
  return {
    async load() {
      await pending.catch(() => undefined);
      const owner = await input.currentOwner();
      if (!owner) return { kind: 'unavailable' } as const;
      const value = await input.read();
      if (
        value !== undefined &&
        (typeof value !== 'object' ||
          value === null ||
          typeof Reflect.get(value, 'owner') !== 'string' ||
          !Reflect.has(value, 'preferences'))
      )
        return { kind: 'unavailable' } as const;
      const stored = value as
        { owner: string; preferences: unknown } | undefined;
      if (owner !== (await input.currentOwner()))
        return { kind: 'unavailable' } as const;
      const parsed = readLivePreferences(
        stored?.owner === owner ? stored.preferences : undefined,
      );
      return parsed.kind === 'ready'
        ? ({ kind: 'ready', owner, preferences: parsed.value } as const)
        : parsed;
    },
    save(owner: Owner, preferences: Preferences) {
      const parsed = readLivePreferences(preferences);
      const next = pending
        .catch(() => undefined)
        .then(async () => {
          if (
            parsed.kind !== 'ready' ||
            !owner ||
            owner !== (await input.currentOwner())
          )
            throw new Error('Live preference owner unavailable');
          await input.write({ owner, preferences: parsed.value });
          if (owner !== (await input.currentOwner()))
            throw new Error('Live preference owner changed');
        });
      pending = next;
      return next;
    },
  };
}
