import { useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import { isPublicWebReference } from '../externalMedicalEvidence/publicWebSources';
import { PublicWebSourceLinks } from '../externalMedicalEvidence/PublicWebSourceLinks';

/** Compact links leave room for other record categories while retaining every exact citation. */
export function EvidenceLinks({
  title,
  references,
  onOpenSource,
}: {
  readonly title: string;
  readonly references: readonly EvidenceReference[];
  readonly onOpenSource: (reference: EvidenceReference) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [linkError, setLinkError] = useState(false);
  if (references.length === 0) return null;
  return (
    <View style={styles.section}>
      <AppText style={styles.label}>{title}</AppText>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.links}
      >
        {(expanded ? references : references.slice(0, 2)).map(
          (reference, index) => {
            if (isPublicWebReference(reference))
              return (
                <PublicWebSourceLinks
                  key={`${reference.evidenceId}:${index}`}
                  reference={reference}
                  linkStyle={styles.link}
                  onLinkError={() => setLinkError(true)}
                />
              );
            const external = reference.sourceKind === 'external_medical';
            const label = external
              ? 'Europe PMC 의학 문헌'
              : reference.sourceKind === 'reviewed_memory'
                ? '검토한 메모'
                : '건강 기록';
            const date = reference.effectiveTime?.slice(0, 10);
            return (
              <Pressable
                key={`${reference.sourceId}:${reference.evidenceId}:${index}`}
                accessibilityRole="button"
                accessibilityLabel={`원문 근거 열기 · ${label}${date ? ` · ${date}` : ''}`}
                style={styles.link}
                onPress={() => {
                  if (!external) {
                    onOpenSource(reference);
                    return;
                  }
                  const locator = reference.locator as Record<
                    string,
                    unknown
                  > | null;
                  const url =
                    typeof locator?.originalUrl === 'string'
                      ? locator.originalUrl
                      : '';
                  if (!isSafeEuropePmcArticleUrl(url)) {
                    setLinkError(true);
                    return;
                  }
                  Linking.openURL(url).catch(() => setLinkError(true));
                }}
              >
                <AppSymbol
                  name={external ? 'book' : 'doc.text'}
                  size={16}
                  color={appColors.primaryText}
                />
                <AppText numberOfLines={1}>
                  {label}
                  {date ? ` · ${date}` : ''}
                </AppText>
              </Pressable>
            );
          },
        )}
        {!expanded && references.length > 2 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`근거 ${references.length - 2}개 더 보기`}
            style={styles.link}
            onPress={() => setExpanded(true)}
          >
            <AppText>+{references.length - 2}</AppText>
          </Pressable>
        ) : null}
      </ScrollView>
      {linkError ? (
        <AppText accessibilityRole="alert">
          출처를 열지 못했어요. 다시 시도해 주세요.
        </AppText>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  section: { gap: 4 },
  label: { fontWeight: '700', marginTop: 4 },
  links: { gap: 8 },
  link: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
