import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import type { ExternalMedicalPublication } from './europePmc';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { navigationText } from '../i18n/navigation';
import { getExternalMedicalEvidenceCopy } from './copy';
import { ExternalMedicalEvidenceSelectedSource } from './ExternalMedicalEvidenceSelectedSource';

export type ExternalMedicalEvidenceSearchState =
  | { readonly status: 'idle' | 'loading' }
  | {
      readonly status: 'available';
      readonly publications: readonly ExternalMedicalPublication[];
      readonly selectedKey: string;
    }
  | { readonly status: 'empty' | 'unavailable' | 'consent_required' };

export function externalMedicalEvidencePublicationKey(
  publication: ExternalMedicalPublication,
): string {
  return `${publication.source}:${publication.recordId}`;
}

interface ExternalMedicalEvidencePresentationProps {
  readonly copy: ReturnType<typeof getExternalMedicalEvidenceCopy>;
  readonly providerSelection?: ReactNode;
  readonly showBack: boolean;
  readonly onBack: () => void;
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
  readonly inputFocused: boolean;
  readonly onInputFocus: () => void;
  readonly onInputBlur: () => void;
  readonly state: ExternalMedicalEvidenceSearchState;
  readonly onSearch: () => void;
  readonly onSelectPublication: (
    publication: ExternalMedicalPublication,
  ) => void;
  readonly onOpenArticle: (publication: ExternalMedicalPublication) => void;
}

/** Keeps search, results, and provenance in one measured reading flow without a second scroll owner. */
export function ExternalMedicalEvidencePresentation({
  copy,
  providerSelection,
  showBack,
  onBack,
  query,
  onQueryChange,
  inputFocused,
  onInputFocus,
  onInputBlur,
  state,
  onSearch,
  onSelectPublication,
  onOpenArticle,
}: ExternalMedicalEvidencePresentationProps) {
  const selectedPublication =
    state.status === 'available'
      ? (state.publications.find(
          publication =>
            externalMedicalEvidencePublicationKey(publication) ===
            state.selectedKey,
        ) ?? state.publications[0])
      : undefined;

  return (
    <AdaptiveColumns
      testID="external-medical-evidence-columns"
      primary={
        <View style={styles.queryPanel}>
          {showBack ? (
            <Button
              accessibilityLabel={navigationText.back.accessibilityLabel}
              onPress={onBack}
              title={navigationText.back.label}
            />
          ) : null}
          <Text accessibilityRole="header" style={styles.heading}>
            {copy.title}
          </Text>
          {providerSelection}
          <Text>{copy.description}</Text>
          <TextInput
            accessibilityLabel={copy.placeholder}
            editable={state.status !== 'loading'}
            maxLength={240}
            onBlur={onInputBlur}
            onChangeText={onQueryChange}
            onFocus={onInputFocus}
            placeholder={copy.placeholder}
            placeholderTextColor={appColors.secondary}
            style={[styles.input, inputFocused && styles.inputFocused]}
            testID="external-evidence-query"
            value={query}
          />
          <Button
            accessibilityState={{
              busy: state.status === 'loading',
              disabled: !query.trim() || state.status === 'loading',
            }}
            disabled={!query.trim() || state.status === 'loading'}
            onPress={onSearch}
            testID="external-evidence-search"
            title={copy.search}
          />
          {state.status === 'available' ? (
            <View
              style={styles.resultList}
              testID="external-evidence-result-list"
            >
              {state.publications.map(publication => {
                const selected =
                  externalMedicalEvidencePublicationKey(publication) ===
                  state.selectedKey;
                return (
                  <Pressable
                    accessibilityLabel={`${publication.title}, ${publication.journal ?? publication.authors ?? copy.source(publication.provider)}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    key={externalMedicalEvidencePublicationKey(publication)}
                    onPress={() => onSelectPublication(publication)}
                    style={({ pressed }) => [
                      styles.resultRow,
                      selected && styles.selectedResult,
                      pressed && styles.pressedResult,
                    ]}
                    testID={`external-evidence-publication-${publication.source}-${publication.recordId}`}
                  >
                    {selected ? (
                      <View
                        accessible={false}
                        style={styles.selectionIndicator}
                        testID={`external-evidence-selection-${publication.source}-${publication.recordId}`}
                      />
                    ) : null}
                    <Text accessibilityRole="header" style={styles.resultTitle}>
                      {publication.title}
                    </Text>
                    {publication.authors ? (
                      <Text style={styles.supporting}>
                        {publication.authors}
                      </Text>
                    ) : null}
                    {publication.journal ? (
                      <Text style={styles.supporting}>
                        {publication.journal}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {/* Status replaces the results in place; no empty detail container reserves page height. */}
          {state.status === 'available' && selectedPublication ? (
            <ExternalMedicalEvidenceSelectedSource
              copy={copy}
              onOpenArticle={onOpenArticle}
              publication={selectedPublication}
            />
          ) : state.status === 'loading' ? (
            <View style={styles.status}>
              <ActivityIndicator color={appColors.primaryText} />
              <Text testID="external-evidence-loading">{copy.loading}</Text>
            </View>
          ) : state.status === 'empty' ? (
            <Text testID="external-evidence-empty">{copy.empty}</Text>
          ) : state.status === 'unavailable' ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {copy.unavailable}
            </Text>
          ) : state.status === 'consent_required' ? (
            <Text>{copy.consentRequired}</Text>
          ) : (
            <Text style={styles.status}>{copy.selectResult}</Text>
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  queryPanel: { gap: 12 },
  heading: { fontSize: 22, fontWeight: '700' },
  input: {
    backgroundColor: appColors.surface,
    borderColor: 'transparent',
    borderRadius: 12,
    borderWidth: 2,
    color: appColors.text,
    minHeight: 48,
    paddingHorizontal: 12,
  },
  // Focus remains visible for keyboard users in both system appearances.
  inputFocused: { borderColor: appColors.primaryText, borderWidth: 2 },
  resultList: { marginTop: 8 },
  resultRow: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 6,
    minHeight: 44,
    paddingVertical: 16,
    paddingHorizontal: 12,
  },
  // The marker adds a shape cue while the row exposes its selected accessibility state.
  selectedResult: { paddingLeft: 16 },
  selectionIndicator: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 3,
    borderRadius: 2,
    backgroundColor: appColors.primaryText,
  },
  pressedResult: { opacity: 0.72 },
  resultTitle: { fontSize: 16, fontWeight: '700' },
  supporting: { color: appColors.secondary },
  status: { color: appColors.secondary, gap: 8 },
  error: { color: appColors.danger },
});
