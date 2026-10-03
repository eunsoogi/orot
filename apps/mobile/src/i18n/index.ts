import { ko } from './ko';

export const defaultLanguage = 'ko' as const;
export const supportedLanguages = [defaultLanguage] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];
export type TranslationKey = keyof typeof ko;

type Catalog = Record<TranslationKey, string>;
type PlaceholderNames<Message extends string> =
  Message extends `${string}{${infer Name}}${infer Rest}`
    ? Name | PlaceholderNames<Rest>
    : never;
type TranslationArguments<Key extends TranslationKey> = [
  PlaceholderNames<(typeof ko)[Key]>,
] extends [never]
  ? []
  : [values: Record<PlaceholderNames<(typeof ko)[Key]>, string | number>];

const resources: Record<SupportedLanguage, Catalog> = { ko };
const localeTags: Record<SupportedLanguage, string> = { ko: 'ko-KR' };

export function resolveLanguage(
  deviceLocale = Intl.DateTimeFormat().resolvedOptions().locale,
): SupportedLanguage {
  const language = deviceLocale
    .replace(/_/gu, '-')
    .split('-')[0]
    ?.toLowerCase();
  return language === 'ko' ? 'ko' : defaultLanguage;
}

function currentLocaleTag(): string {
  return localeTags[resolveLanguage()];
}

export function t<Key extends TranslationKey>(
  key: Key,
  ...args: TranslationArguments<Key>
): string {
  const values = args[0] as Record<string, string | number> | undefined;
  return resources[resolveLanguage()][key].replace(
    /\{([A-Za-z][A-Za-z0-9_]*)\}/gu,
    (placeholder, name: string) => {
      const value = values?.[name];
      return value === undefined ? placeholder : String(value);
    },
  );
}

export function formatDate(
  value: Date,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  },
): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), options).format(value);
}

export function formatTime(
  value: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(value);
}

export function formatDateTime(
  value: Date,
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return new Intl.DateTimeFormat(currentLocaleTag(), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone,
  }).format(value);
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(currentLocaleTag(), options).format(value);
}
