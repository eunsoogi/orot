import type {
  NextVisitQuestionsTheme,
  ProviderViewState,
} from '../../nextVisitQuestions';
import { nextVisitQuestionsCopy as copy } from '../../nextVisitQuestions/copy';
import type { SelectedAiResolution } from './provider';

/** Keeps the feature palette aligned with the app's other AI screens. */
export const nextVisitQuestionsTheme: NextVisitQuestionsTheme = {
  colors: {
    canvas: '#f7f8fa',
    surface: '#ffffff',
    surfaceSubtle: '#f3f6f5',
    text: '#17212b',
    textMuted: '#45524f',
    border: '#c9d4d1',
    accent: '#174f45',
    onAccent: '#ffffff',
    accentSubtle: '#e5efec',
    accentText: '#174f45',
    warning: '#704800',
    warningSurface: '#fff4d6',
    danger: '#8a1c1c',
    dangerSurface: '#fde8e8',
  },
  tokens: {
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24 },
    radii: { control: 10, card: 16 },
    typography: {
      sizes: { caption: 13, body: 16, heading: 20, title: 26 },
      weights: { regular: '400', medium: '500', semibold: '600', bold: '700' },
    },
    minTouchTarget: 44,
  },
};

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
