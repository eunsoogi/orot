import { render, screen } from '@testing-library/react-native';
import { StyleSheet, useColorScheme } from 'react-native';
import { appThemeForScheme } from '../../design';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ExternalMedicalEvidenceScreen } from '../../externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { FeatureEntryScreen } from '../FeatureEntryScreen';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: jest.fn(() => 'light'),
}));

afterEach(() => jest.mocked(useColorScheme).mockReturnValue('light'));

// The real screens are rendered together only to compare their shared presentation contract.
// Service calls remain covered by each screen's interaction tests; this is not native layout proof.
test.each(['light', 'dark'] as const)(
  'applies the %s palette and accessible controls to all four AI screens',
  async scheme => {
    jest.mocked(useColorScheme).mockReturnValue(scheme);
    await render(
      <>
        <FeatureEntryScreen
          onOpenVisitQuestions={jest.fn()}
          onOpenDiseaseHypotheses={jest.fn()}
          onOpenRagConversation={jest.fn()}
          onOpenExternalEvidence={jest.fn()}
        />
        <DiseaseHypothesesScreen
          onBack={jest.fn()}
          onGenerate={jest.fn()}
          onOpenSource={jest.fn()}
        />
        <ConversationScreen
          onBack={jest.fn()}
          onSend={jest.fn()}
          onOpenSource={jest.fn()}
        />
        <ExternalMedicalEvidenceScreen
          onBack={jest.fn()}
          service={{ search: jest.fn() }}
          onOpenArticle={jest.fn()}
        />
      </>,
    );
    for (const id of [
      'ai-features-screen',
      'disease-hypotheses-screen',
      'rag-conversation-screen',
      'external-medical-evidence-screen',
    ]) {
      expect(
        StyleSheet.flatten(screen.getByTestId(id).props.style).backgroundColor,
      ).toBe(appThemeForScheme(scheme).colors.canvas);
    }
    for (const button of screen.getAllByRole('button')) {
      const style = StyleSheet.flatten(button.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(44);
      expect(button.props.accessibilityLabel).toBeTruthy();
    }
    for (const heading of screen.getAllByRole('header')) {
      expect(heading.props.allowFontScaling).toBe(true);
      expect(heading.props.maxFontSizeMultiplier).toBeUndefined();
      expect(heading.props.numberOfLines).toBeUndefined();
    }
    for (const id of ['rag-conversation-input', 'external-evidence-query']) {
      const input = screen.getByTestId(id);
      expect(input.props.allowFontScaling).toBe(true);
      expect(screen.getByText(input.props.accessibilityLabel)).toBeTruthy();
      expect(
        StyleSheet.flatten(input.props.style).minHeight,
      ).toBeGreaterThanOrEqual(44);
    }
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByTestId('external-evidence-search')).toBeDisabled();
    expect(screen.getByTestId('rag-conversation-send')).toBeDisabled();
  },
);
