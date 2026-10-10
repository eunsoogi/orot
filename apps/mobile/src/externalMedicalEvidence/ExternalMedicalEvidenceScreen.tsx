import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
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
  | { readonly status: 'empty' | 'unavailable' };

/** Requires separate query-only opt-in before calling the public literature service. */
export function ExternalMedicalEvidenceScreen({
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
  const [consented, setConsented] = useState(false);
  const [state, setState] = useState<SearchState>({ status: 'idle' });
  const operationController = useRef<AbortController | null>(null);
  const inputRevision = useRef(0);

  useAiFeatureScreenNavigationState(
    navigationRouteKey,
    {
      hasUnsavedChanges:
        query.length > 0 ||
        consented ||
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
    if (!consented || !query.trim() || state.status === 'loading') return;
    const controller = new AbortController();
    operationController.current = controller;
    setState({ status: 'loading' });
    try {
      const result: EuropePmcSearchResult = await service.search(query, {
        externalQueryConsented: true,
        signal: controller.signal,
      });
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
    <ScrollView
      contentContainerStyle={[styles.container, navigationInset]}
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
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consented }}
        onPress={() => {
          inputRevision.current += 1;
          setConsented(value => !value);
        }}
        testID="external-evidence-consent"
      >
        <Text>
          {consented ? '☑' : '☐'} {copy.consent}
        </Text>
      </Pressable>
      <Button
        disabled={!consented || !query.trim() || state.status === 'loading'}
        accessibilityState={{ busy: state.status === 'loading' }}
        onPress={() => {
          search().catch(() => setState({ status: 'unavailable' }));
        }}
        testID="external-evidence-search"
        title={copy.search}
      />
      {!consented ? <Text>{copy.consentRequired}</Text> : null}
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
                {copy.updatedDate(publication.updatedDate ?? copy.unknownDate)}
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
  card: {
    borderColor: appColors.border,
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
});
