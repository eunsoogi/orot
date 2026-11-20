/** Private GPT-Live settings contract. No imported app, audio, credential or transport modules. */
export const liveModel = 'gpt-live-1.1' as const;

export const liveVoiceIds = [
  'marin',
  'quartz',
  'ripple',
  'vesper',
  'willow',
  'stone',
  'gleam',
  'meridian',
  'bossa',
  'tempo',
  'beacon',
  'delta',
  'cinder',
  'nuri',
  'juni',
  'flitz',
  'brise',
  'sillage',
  'nira',
  'harema',
  'shida',
  'noeul',
] as const;

// These are catalog metadata, not a language constraint for the model.
export const liveVoiceCatalog = [
  ['ko', '한국어', ['noeul']],
  [
    'en',
    '영어',
    [
      'quartz',
      'ripple',
      'vesper',
      'willow',
      'stone',
      'gleam',
      'meridian',
      'beacon',
      'delta',
      'cinder',
    ],
  ],
  ['pt', '포르투갈어', ['bossa', 'tempo']],
  ['de', '독일어', ['nuri', 'juni', 'flitz']],
  ['fr', '프랑스어', ['brise', 'sillage']],
  ['hi', '힌디어', ['nira']],
  ['ja', '일본어', ['harema', 'shida']],
] as const;
export type LiveVoiceLanguage = (typeof liveVoiceCatalog)[number][0];
export type LiveLanguage = 'auto' | LiveVoiceLanguage;
export type LiveVoice = 'default' | (typeof liveVoiceIds)[number];
export type Preferences = Readonly<{
  schema: 1;
  language: LiveLanguage;
  voice: LiveVoice;
}>;
export type ReadPreferences =
  | { readonly kind: 'ready'; readonly value: Preferences }
  | { readonly kind: 'unavailable' };
export const initialPreferences: Preferences = Object.freeze({
  schema: 1,
  language: 'auto',
  voice: 'default',
});

const languages: readonly unknown[] = [
  'auto',
  ...liveVoiceCatalog.map(([id]) => id),
];
const voices: readonly unknown[] = ['default', ...liveVoiceIds];

/** Only a missing field from a legacy record receives neutral defaults. */
export function readLivePreferences(value: unknown): ReadPreferences {
  if (value === undefined) return { kind: 'ready', value: initialPreferences };
  if (typeof value !== 'object' || value === null)
    return { kind: 'unavailable' };
  const candidate = value as Partial<Preferences>;
  if (
    candidate.schema !== 1 ||
    !languages.includes(candidate.language) ||
    !voices.includes(candidate.voice)
  )
    return { kind: 'unavailable' };
  return {
    kind: 'ready',
    value: Object.freeze({
      schema: 1,
      language: candidate.language!,
      voice: candidate.voice!,
    }),
  };
}

export function catalogVoiceLanguage(
  locale: unknown,
): LiveVoiceLanguage | undefined {
  const language =
    typeof locale === 'string'
      ? locale.toLowerCase().split(/[-_]/)[0]
      : undefined;
  return liveVoiceCatalog.find(([id]) => id === language)?.[0];
}

/** Provider default is available across groups; never infer a language for Marin. */
export function voicesForLanguage(
  language: LiveVoiceLanguage,
): readonly LiveVoice[] {
  const localized = liveVoiceCatalog.find(([id]) => id === language)?.[2] ?? [];
  return ['default', 'marin', ...localized];
}

/** Map preferences to startup inputs once, after real readiness and saved owner validation. */
export function snapshotForNextCall(preferences: Preferences, ready: boolean) {
  if (!ready || readLivePreferences(preferences).kind !== 'ready') return null;
  return Object.freeze({
    voice: preferences.voice === 'default' ? undefined : preferences.voice,
  });
}
