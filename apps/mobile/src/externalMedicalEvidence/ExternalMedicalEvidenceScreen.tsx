import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  DesignButton,
  DesignCard,
  DesignCheckbox,
  DesignInput,
  DesignNotice,
  DesignScreen,
  DesignText,
  designTokens,
} from '../design';
import { getExternalMedicalEvidenceCopy } from './copy';
import type {
  EuropePmcMedicalEvidenceService,
  EuropePmcSearchResult,
  ExternalMedicalPublication,
} from './europePmc';

interface ExternalMedicalEvidenceScreenProps {
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

/** Keeps query-only consent beside search and provenance beside each external result. */
export function ExternalMedicalEvidenceScreen({
  onBack,
  service,
  onOpenArticle,
}: ExternalMedicalEvidenceScreenProps) {
  const copy = getExternalMedicalEvidenceCopy();
  const [query, setQuery] = useState('');
  const [consented, setConsented] = useState(false);
  const [state, setState] = useState<SearchState>({ status: 'idle' });

  async function search() {
    if (!consented || !query.trim() || state.status === 'loading') return;
    setState({ status: 'loading' });
    try {
      const result: EuropePmcSearchResult = await service.search(query, {
        externalQueryConsented: true,
      });
      setState(
        result.status === 'available'
          ? { status: 'available', publications: result.publications }
          : { status: result.status === 'empty' ? 'empty' : 'unavailable' },
      );
    } catch {
      setState({ status: 'unavailable' });
    }
  }

  return (
    <DesignScreen
      backAction={{ label: copy.back, onPress: onBack }}
      description={copy.description}
      testID="external-medical-evidence-screen"
      title={copy.title}
    >
      <View style={styles.search}>
        <DesignInput
          label={copy.placeholder}
          editable={state.status !== 'loading'}
          maxLength={240}
          onChangeText={setQuery}
          placeholder={copy.placeholder}
          testID="external-evidence-query"
          value={query}
        />
        <DesignCheckbox
          checked={consented}
          label={copy.consent}
          onPress={() => setConsented(value => !value)}
          testID="external-evidence-consent"
        />
        {!consented ? (
          <DesignText tone="secondary" variant="caption">
            {copy.consentRequired}
          </DesignText>
        ) : null}
        <DesignButton
          accessibilityState={{ busy: state.status === 'loading' }}
          disabled={!consented || !query.trim() || state.status === 'loading'}
          onPress={() => {
            search().catch(() => setState({ status: 'unavailable' }));
          }}
          testID="external-evidence-search"
          label={copy.search}
        />
      </View>
      {state.status === 'loading' ? (
        <DesignNotice
          busy
          message={copy.loading}
          testID="external-evidence-loading"
        />
      ) : null}
      {state.status === 'empty' ? (
        <DesignNotice message={copy.empty} testID="external-evidence-empty" />
      ) : null}
      {state.status === 'unavailable' ? (
        <DesignNotice message={copy.unavailable} tone="danger" />
      ) : null}
      {state.status === 'available'
        ? state.publications.map(publication => (
            <DesignCard key={`${publication.source}:${publication.recordId}`}>
              <DesignText accessibilityRole="header" variant="heading">
                {publication.title}
              </DesignText>
              <DesignText>
                {publication.authors ?? copy.authorUnknown}
              </DesignText>
              <DesignText tone="secondary">
                {publication.journal ?? ''}
              </DesignText>
              <DesignText tone="secondary" variant="caption">
                {copy.publicationDate(
                  publication.publicationDate ?? copy.unknownDate,
                )}
              </DesignText>
              <DesignText tone="secondary" variant="caption">
                {copy.updatedDate(publication.updatedDate ?? copy.unknownDate)}
              </DesignText>
              <DesignText tone="secondary" variant="caption">
                {copy.retrievedAt(publication.retrievedAt)}
              </DesignText>
              <DesignText variant="bodyStrong">
                {copy.source(publication.provider)}
              </DesignText>
              <DesignText selectable tone="secondary" variant="caption">
                {publication.originalUrl}
              </DesignText>
              {publication.abstract ? (
                <DesignText>{publication.abstract}</DesignText>
              ) : null}
              <DesignButton
                onPress={() => onOpenArticle(publication)}
                label={copy.open}
                variant="secondary"
              />
            </DesignCard>
          ))
        : null}
    </DesignScreen>
  );
}

const styles = StyleSheet.create({
  search: { gap: designTokens.spacing.md },
});
