import { useState } from 'react';
import {
  Button,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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

/** Requires separate query-only opt-in before calling the public literature service. */
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
    <ScrollView
      contentContainerStyle={styles.container}
      testID="external-medical-evidence-screen"
    >
      <Button onPress={onBack} title={copy.back} />
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.title}
      </Text>
      <Text>{copy.description}</Text>
      <TextInput
        accessibilityLabel={copy.placeholder}
        editable={state.status !== 'loading'}
        maxLength={240}
        onChangeText={setQuery}
        placeholder={copy.placeholder}
        testID="external-evidence-query"
        value={query}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: consented }}
        onPress={() => setConsented(value => !value)}
        testID="external-evidence-consent"
      >
        <Text>
          {consented ? '☑' : '☐'} {copy.consent}
        </Text>
      </Pressable>
      <Button
        disabled={!consented || !query.trim() || state.status === 'loading'}
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
        <Text accessibilityRole="alert">{copy.unavailable}</Text>
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
  card: {
    borderColor: '#C9D4D1',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
});
