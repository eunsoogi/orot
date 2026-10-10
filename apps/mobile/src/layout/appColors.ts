import { DynamicColorIOS, Platform } from 'react-native';

/** Light and dark product colors keep shared screens visually consistent. */
export const appColorPalettes = {
  light: {
    primary: '#3182f6',
    primaryAction: '#1b64da',
    onPrimary: '#ffffff',
    primaryText: '#1b64da',
    primarySoft: '#e8f3ff',
    warning: '#704800',
    warningSurface: '#fff4d6',
    danger: '#8a1c1c',
    dangerSurface: '#fde8e8',
    dangerAction: '#b3261e',
    onDanger: '#ffffff',
    background: '#f2f4f6',
    surface: '#ffffff',
    text: '#191f28',
    secondary: '#5e6875',
    border: '#e5e8eb',
  },
  dark: {
    primary: '#3182f6',
    primaryAction: '#1b64da',
    onPrimary: '#ffffff',
    primaryText: '#9fc2ff',
    primarySoft: '#18365a',
    warning: '#ffd89e',
    warningSurface: '#3a2d18',
    danger: '#ffb4ab',
    dangerSurface: '#48211f',
    dangerAction: '#b3261e',
    onDanger: '#ffffff',
    background: '#101318',
    surface: '#1c222a',
    text: '#f2f4f6',
    secondary: '#a1acb8',
    border: '#38424e',
  },
} as const;

type AppearanceColor = Exclude<
  keyof typeof appColorPalettes.light,
  'primary' | 'primaryAction' | 'onPrimary' | 'dangerAction' | 'onDanger'
>;

function systemColor(token: AppearanceColor) {
  const light = appColorPalettes.light[token];
  const dark = appColorPalettes.dark[token];

  // UIKit dynamic colors follow system appearance without per-screen JS state.
  return Platform.OS === 'ios' ? DynamicColorIOS({ light, dark }) : light;
}

/** Dynamic tokens follow iOS appearance while non-iOS platforms use light colors. */
export const appColors = {
  primary: appColorPalettes.light.primary,
  // Filled actions use a deeper blue so their white labels remain readable.
  primaryAction: appColorPalettes.light.primaryAction,
  onPrimary: appColorPalettes.light.onPrimary,
  primaryText: systemColor('primaryText'),
  primarySoft: systemColor('primarySoft'),
  warning: systemColor('warning'),
  warningSurface: systemColor('warningSurface'),
  danger: systemColor('danger'),
  dangerSurface: systemColor('dangerSurface'),
  dangerAction: appColorPalettes.light.dangerAction,
  onDanger: appColorPalettes.light.onDanger,
  background: systemColor('background'),
  surface: systemColor('surface'),
  text: systemColor('text'),
  secondary: systemColor('secondary'),
  border: systemColor('border'),
} as const;
