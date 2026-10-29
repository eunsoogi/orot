import { StyleSheet, View } from 'react-native';
import type { ExternalMedicalPublication } from './europePmc';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { getExternalMedicalEvidenceCopy } from './copy';
import { appColors } from '../layout/appColors';

interface ExternalMedicalEvidenceSelectedSourceProps {
  readonly copy: ReturnType<typeof getExternalMedicalEvidenceCopy>;
  readonly publication: ExternalMedicalPublication;
  readonly onOpenArticle: (publication: ExternalMedicalPublication) => void;
}

/** Presents the selected result's provenance, metadata, abstract, and explicit link action. */
export function ExternalMedicalEvidenceSelectedSource({
  copy,
  publication,
  onOpenArticle,
}: ExternalMedicalEvidenceSelectedSourceProps) {
  return (
    <View style={styles.details} testID="external-evidence-selected-source">
      <Text accessibilityRole="header" style={styles.title}>
        {publication.title}
      </Text>
      <Text>{publication.authors ?? copy.authorUnknown}</Text>
      <Text>{publication.journal ?? ''}</Text>
      <Text>
        {copy.publicationDate(publication.publicationDate ?? copy.unknownDate)}
      </Text>
      <Text>
        {copy.updatedDate(publication.updatedDate ?? copy.unknownDate)}
      </Text>
      <Text>{copy.retrievedAt(publication.retrievedAt)}</Text>
      <Text>{copy.source(publication.provider)}</Text>
      <Text selectable>{publication.originalUrl}</Text>
      {publication.abstract ? <Text>{publication.abstract}</Text> : null}
      <Button
        onPress={() => onOpenArticle(publication)}
        testID="external-evidence-open-selected-source"
        title={copy.open}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // A divider separates provenance from the list without introducing another card or viewport.
  details: {
    gap: 8,
    borderTopColor: appColors.border,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
});
