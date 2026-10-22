import { useInferenceConsent } from '../agent/execution/useInferenceConsent';
import { publicMedicalQueryConsent } from '../agent/execution/publicMedicalQueryConsent';
import type { ReactNode } from 'react';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { navigationText } from '../i18n/navigation';
import { appColors } from '../layout/appColors';
import { getExternalMedicalEvidenceCopy } from './copy';
import type { AiFeatureNavigationStateChange } from '../aiFeatures/integration/useAiFeatureNavigationState';
import { useAiFeatureScreenNavigationState } from '../aiFeatures/integration/useAiFeatureNavigationState';
import type {
  EuropePmcMedicalEvidenceService,
  EuropePmcSearchResult,
  ExternalMedicalPublication,
} from './europePmc';

interface ExternalMedicalEvidenceScreenProps {
  readonly providerSelection?: ReactNode;
  readonly navigationRouteKey?: string;
  readonly onNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly onBack: () => void;
  readonly service: EuropePmcMedicalEvidenceService;
  readonly onOpenArticle: (publication: ExternalMedicalPublication) => void;
}

type SearchState =
  | { readonly status: 'idle' | 'loading' }
  | {
      readonly status: 'available';
      readonly publications: readonly ExternalMedicalPublication[];
    }
  | { readonly status: 'empty' | 'unavailable' | 'consent_required' };

/** Requires separate query-only opt-in before calling the public literature service. */
export function ExternalMedicalEvidenceScreen({
  providerSelection,
  navigationRouteKey,
  onNavigationStateChange,
  onBack,
  service,
  onOpenArticle,
}: ExternalMedicalEvidenceScreenProps) {
  const navigationInset = useNavigationContentInset();
  const copy = getExternalMedicalEvidenceCopy();
  const [query, setQuery] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const { consent, disclosureSheet } = useInferenceConsent();
  const queryConsent = publicMedicalQueryConsent(consent);
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const operationController = useRef<AbortController | null>(null);
  const inputRevision = useRef(0);

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges:
        query.length > 0 ||
        state.status === 'available' ||
        state.status === 'empty' ||
        state.status === 'unavailable',
      isRecording: false,
      // Search supports AbortSignal; confirmed route removal cancels the fetch.
      hasOngoingOperation: state.status === 'loading',
    },
    inputRevision.current,
    onNavigationStateChange,
  );

  useEffect(
    () => () => {
      operationController.current?.abort();
      operationController.current = null;
    },
    [],
  );

  async function search() {
    if (!query.trim() || state.status === 'loading') return;
    const submittedQuery = query.trim();
    const controller = new AbortController();
    operationController.current = controller;
    setState({ status: 'loading' });
    try {
      const decision = await queryConsent.authorize({
        operationRunId: 'manual-medical-search',
        operationKey: 'search',
        sourceId: 'europe-pmc',
        query: submittedQuery,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (decision !== 'authorized') {
        setState({ status: 'consent_required' });
        return;
      }
      const result: EuropePmcSearchResult = await service.search(
        submittedQuery,
        {
          externalQueryConsented: true,
          signal: controller.signal,
        },
      );
      if (controller.signal.aborted) return;
      setState(
        result.status === 'available'
          ? { status: 'available', publications: result.publications }
          : { status: result.status === 'empty' ? 'empty' : 'unavailable' },
      );
    } catch {
      if (!controller.signal.aborted) setState({ status: 'unavailable' });
    } finally {
      if (operationController.current === controller) {
        operationController.current = null;
      }
    }
  }

  return (
    <>
      <ScrollView
        contentContainerStyle={[styles.container, navigationInset]}
        keyboardShouldPersistTaps="handled"
        testID="external-medical-evidence-screen"
      >
        {navigationRouteKey ? null : (
          <Button
            accessibilityLabel={navigationText.back.accessibilityLabel}
            onPress={onBack}
            title={navigationText.back.label}
          />
        )}
        <Text accessibilityRole="header" style={styles.heading}>
          {copy.title}
        </Text>
        {providerSelection}
        <Text>{copy.description}</Text>
        <TextInput
          accessibilityLabel={copy.placeholder}
          editable={state.status !== 'loading'}
          maxLength={240}
          onChangeText={value => {
            inputRevision.current += 1;
            setQuery(value);
          }}
          placeholder={copy.placeholder}
          placeholderTextColor={appColors.secondary}
          onFocus={() => setInputFocused(true)}
          onBlur={() => setInputFocused(false)}
          style={[styles.input, inputFocused && styles.inputFocused]}
          testID="external-evidence-query"
          value={query}
        />
        <Button
          disabled={!query.trim() || state.status === 'loading'}
          accessibilityState={{ busy: state.status === 'loading' }}
          onPress={() => {
            search().catch(() => setState({ status: 'unavailable' }));
          }}
          testID="external-evidence-search"
          title={copy.search}
        />
        {state.status === 'consent_required' ? (
          <Text>{copy.consentRequired}</Text>
        ) : null}
        {state.status === 'loading' ? (
          <Text testID="external-evidence-loading">{copy.loading}</Text>
        ) : null}
        {state.status === 'empty' ? (
          <Text testID="external-evidence-empty">{copy.empty}</Text>
        ) : null}
        {state.status === 'unavailable' ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {copy.unavailable}
          </Text>
        ) : null}
        {state.status === 'available'
          ? state.publications.map(publication => (
              <View
                key={`${publication.source}:${publication.recordId}`}
                testID={`external-evidence-publication-${publication.source}-${publication.recordId}`}
                style={styles.card}
              >
                <Text accessibilityRole="header" style={styles.title}>
                  {publication.title}
                </Text>
                <Text>{publication.authors ?? copy.authorUnknown}</Text>
                <Text>{publication.journal ?? ''}</Text>
                <Text>
                  {copy.publicationDate(
                    publication.publicationDate ?? copy.unknownDate,
                  )}
                </Text>
                <Text>
                  {copy.updatedDate(
                    publication.updatedDate ?? copy.unknownDate,
                  )}
                </Text>
                <Text>{copy.retrievedAt(publication.retrievedAt)}</Text>
                <Text>{copy.source(publication.provider)}</Text>
                <Text selectable>{publication.originalUrl}</Text>
                {publication.abstract ? (
                  <Text>{publication.abstract}</Text>
                ) : null}
                <Button
                  onPress={() => onOpenArticle(publication)}
                  title={copy.open}
                />
              </View>
            ))
          : null}
      </ScrollView>
      {disclosureSheet}
    </>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20 },
  heading: { fontSize: 22, fontWeight: '700' },
  input: {
    backgroundColor: appColors.surface,
    borderColor: appColors.secondary,
    borderRadius: 12,
    borderWidth: 1,
    color: appColors.text,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  error: { color: appColors.danger },
  // Focus remains visible for keyboard users in both system appearances.
  inputFocused: { borderColor: appColors.primaryText, borderWidth: 2 },
  // A result is a surface above the canvas, rather than a transparent outline.
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
});
