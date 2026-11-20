import { useId, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import { styles } from './ConversationScreen.styles';
import { isPublicWebReference } from '../externalMedicalEvidence/publicWebSources';
import { PublicWebSourceLinks } from '../externalMedicalEvidence/PublicWebSourceLinks';
import { t } from '../i18n';

/** Project only static chip text; URLs, action handlers and their ownership are resolved at press time. */
function citationPresentation(reference: EvidenceReference) {
  if (isPublicWebReference(reference)) return undefined;
  const external = reference.sourceKind === 'external_medical';
  const locator = reference.locator as Record<string, unknown> | null;
  const title = external
    ? typeof locator?.title === 'string'
      ? locator.title
      : t('externalMedicalEvidence.source.literatureFallbackTitle')
    : reference.sourceKind === 'reviewed_memory'
      ? t('ragConversation.tool.sourceKind.reviewedMemory')
      : reference.sourceKind === 'generated_artifact'
        ? t('ragConversation.sourceKind.previousAiOutput')
        : t('ragConversation.sourceKind.healthRecord');
  const date = reference.effectiveTime?.slice(0, 10);
  const retrievedAt =
    typeof locator?.retrievedAt === 'string'
      ? locator.retrievedAt.slice(0, 10)
      : undefined;
  const provenance = external
    ? `${t('externalMedicalEvidence.source.provenance')}${retrievedAt ? t('externalMedicalEvidence.source.retrievedAtInline', { date: retrievedAt }) : ''}`
    : undefined;
  return {
    caption: external
      ? `${t('externalMedicalEvidence.source.providerCompact')}${retrievedAt ? t('externalMedicalEvidence.source.retrievedAtInline', { date: retrievedAt }) : ''}`
      : title + (date ? ` · ${date}` : ''),
    label: t('ragConversation.conversation.linkEvidenceSource', {
      title,
      provenance: provenance ? ` · ${provenance}` : '',
      date: date ? ` · ${date}` : '',
    }),
    hint: external ? t('externalMedicalEvidence.source.openHint') : undefined,
  };
}

/** Compact citations retain access to every actual source and its external provenance. */
export function ConversationSources({
  references,
  testIDPrefix,
  onOpenSource,
  onLinkError,
}: {
  readonly testIDPrefix?: string;
  readonly references: readonly EvidenceReference[];
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
}) {
  const instanceId = useId();
  // Scope repeated citations to their owning answer/section, never to translated labels.
  const identity = testIDPrefix ?? `rag-source-${instanceId}`;
  const [expanded, setExpanded] = useState(false);
  // Stream previews reuse immutable settled references; do not reformat their labels.
  // Only the fixed Korean UI catalog is used. No action or authorization is cached.
  const visible = useMemo(
    () =>
      (expanded ? references : references.slice(0, 2)).map(reference => ({
        reference,
        text: citationPresentation(reference),
      })),
    [expanded, references],
  );
  // An empty scroll view still creates a flex gap below the message or progress text.
  if (references.length === 0) return null;
  return (
    <ScrollView
      testID="rag-conversation-sources"
      horizontal
      // This nested scroller must pass the first tap to a citation while the composer is focused.
      keyboardShouldPersistTaps="handled"
      showsHorizontalScrollIndicator={false}
      style={styles.sourcesViewport}
      contentContainerStyle={styles.sources}
    >
      {visible.map(({ reference, text }, index) => {
        if (!text)
          return (
            <PublicWebSourceLinks
              key={`${reference.evidenceId}:${index}`}
              reference={reference}
              linkStyle={styles.source}
              textStyle={styles.sourceText}
              onLinkError={onLinkError}
            />
          );
        return (
          <Pressable
            key={`${reference.sourceId}:${reference.evidenceId}:${index}`}
            testID={`${identity}-citation-${index}`}
            accessibilityRole="button"
            accessibilityLabel={text.label}
            accessibilityHint={text.hint}
            style={styles.source}
            onPress={() => {
              if (reference.sourceKind !== 'external_medical') {
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
                onLinkError();
                return;
              }
              Linking.openURL(url).catch(onLinkError);
            }}
          >
            <AppSymbol
              name={
                reference.sourceKind === 'external_medical'
                  ? 'book'
                  : 'doc.text'
              }
              color={appColors.primaryText}
              size={18}
            />
            <Text numberOfLines={1} style={styles.sourceText}>
              {text.caption}
            </Text>
          </Pressable>
        );
      })}
      {!expanded && references.length > 2 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('ragConversation.conversation.moreEvidence', {
            count: references.length - 2,
          })}
          onPress={() => setExpanded(true)}
          style={styles.source}
        >
          <Text style={styles.sourceText}>+{references.length - 2}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
