import { useColorScheme } from 'react-native';

export const designTokens = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radii: { control: 12, card: 18, pill: 999 },
  typography: {
    sizes: {
      small: 12,
      caption: 14,
      body: 16,
      heading: 20,
      title: 24,
      display: 32,
    },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  },
  minTouchTarget: 44,
} as const;

export const appColors = {
  light: {
    canvas: '#F3F7F7',
    surface: '#FFFFFF',
    surfaceSubtle: '#EEF3F3',
    text: '#152A2A',
    textMuted: '#455B5A',
    border: '#C9D6D5',
    accent: '#155E62',
    onAccent: '#FFFFFF',
    accentSubtle: '#DCEFEB',
    accentText: '#0F4546',
    warning: '#755008',
    warningSurface: '#FFF2CD',
    danger: '#9B2822',
    dangerSurface: '#FCE8E5',
  },
  dark: {
    canvas: '#101918',
    surface: '#1A2625',
    surfaceSubtle: '#223330',
    text: '#F1F7F5',
    textMuted: '#B3C3C0',
    border: '#455653',
    accent: '#9ADACB',
    onAccent: '#123B38',
    accentSubtle: '#214440',
    accentText: '#C6F1E6',
    warning: '#FFD47E',
    warningSurface: '#493718',
    danger: '#FFB7AA',
    dangerSurface: '#4D2420',
  },
} as const;

export type AppColorRole = keyof typeof appColors.light;
export type AppColorPalette = Record<AppColorRole, string>;
export type AppColorScheme = 'light' | 'dark';

export interface AppTheme {
  scheme: AppColorScheme;
  colors: AppColorPalette;
  tokens: typeof designTokens;
}

const themes: Record<AppColorScheme, AppTheme> = {
  light: { scheme: 'light', colors: appColors.light, tokens: designTokens },
  dark: { scheme: 'dark', colors: appColors.dark, tokens: designTokens },
};

export function appThemeForScheme(scheme: AppColorScheme | null): AppTheme {
  // A missing system preference uses the readable light palette until iOS reports one.
  return themes[scheme ?? 'light'];
}

export function useAppTheme(): AppTheme {
  return appThemeForScheme(useColorScheme());
}
