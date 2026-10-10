import type {
  NextVisitQuestionsTheme,
  ProviderViewState,
} from '../../nextVisitQuestions';
import { nextVisitQuestionsCopy as copy } from '../../nextVisitQuestions/copy';
import { appColorPalettes } from '../../layout/appColors';
import type { SelectedAiResolution } from './provider';

const nextVisitQuestionsTokens: NextVisitQuestionsTheme['tokens'] = {
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
  radii: { control: 16, card: 24 },
  typography: {
    sizes: { caption: 13, body: 16, heading: 20, title: 26 },
    weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
  },
  minTouchTarget: 44,
};

/** Builds string colors for the screen's theme contract when iOS appearance changes. */
export function createNextVisitQuestionsTheme(
  isDarkAppearance: boolean,
): NextVisitQuestionsTheme {
  const palette = isDarkAppearance
    ? appColorPalettes.dark
    : appColorPalettes.light;

  return {
    colors: {
      canvas: palette.background,
      surface: palette.surface,
      surfaceSubtle: isDarkAppearance ? '#252d36' : '#f3f6f5',
      text: palette.text,
      textMuted: isDarkAppearance ? palette.secondary : '#45524f',
      border: isDarkAppearance ? '#64707d' : '#c9d4d1',
      accent: palette.primaryAction,
      onAccent: palette.onPrimary,
      accentSubtle: isDarkAppearance ? palette.primarySoft : '#e5efec',
      accentText: palette.primaryText,
      warning: isDarkAppearance ? '#ffd89e' : '#704800',
      warningSurface: isDarkAppearance ? '#3a2d18' : '#fff4d6',
      danger: isDarkAppearance ? '#ffb4ab' : '#8a1c1c',
      dangerSurface: isDarkAppearance ? '#48211f' : '#fde8e8',
    },
    tokens: nextVisitQuestionsTokens,
  };
}

export function visitQuestionsProviderState(
  result: SelectedAiResolution,
): ProviderViewState {
  if (result.status === 'ready') {
    return {
      status: 'available',
      selection: result.selection,
      displayName: result.option.displayName,
      privacyBoundary: result.option.privacyBoundary,
    };
  }
  return result.status === 'selection-required'
    ? { status: 'unselected', selection: null }
    : { status: 'error', selection: null, message: copy.provider.error };
}

export function sameVisitQuestionSelection(
  left: { providerId: string; modelId: string },
  right: { providerId: string; modelId: string },
) {
  return left.providerId === right.providerId && left.modelId === right.modelId;
}
