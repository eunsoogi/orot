import { useState } from 'react';
import { Linking, Pressable, ScrollView } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import { styles } from './ConversationScreen.styles';

/** Compact citations retain access to every actual source and its external provenance. */
export function ConversationSources({
  references,
  onOpenSource,
  onLinkError,
}: {
  readonly references: readonly EvidenceReference[];
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  // An empty scroll view still creates a flex gap below the message or progress text.
  if (references.length === 0) return null;
  const visible = expanded ? references : references.slice(0, 2);
  return (
    <ScrollView
      testID="rag-conversation-sources"
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.sourcesViewport}
      contentContainerStyle={styles.sources}
    >
      {visible.map((reference, index) => {
        const external = reference.sourceKind === 'external_medical';
        const locator = reference.locator as Record<string, unknown> | null;
        const title = external
          ? typeof locator?.title === 'string'
            ? locator.title
            : 'Europe PMC 문헌'
          : reference.sourceKind === 'reviewed_memory'
            ? '검토한 메모'
            : '건강 기록';
        const date = reference.effectiveTime?.slice(0, 10);
        const retrievedAt =
          typeof locator?.retrievedAt === 'string'
            ? locator.retrievedAt.slice(0, 10)
            : undefined;
        const provenance = external
          ? `Europe PMC · 공개 의학 문헌${retrievedAt ? ` · 조회 ${retrievedAt}` : ''}`
          : undefined;
        const compactTitle =
          external && title.length > 22 ? `${title.slice(0, 21)}…` : title;
        return (
          <Pressable
            key={`${reference.sourceId}:${reference.evidenceId}:${index}`}
            accessibilityRole="button"
            accessibilityLabel={`원문 근거 열기 · ${title}${provenance ? ` · ${provenance}` : ''}${date ? ` · ${date}` : ''}`}
            accessibilityHint={external ? '문헌 원문 열기' : undefined}
            style={styles.source}
            onPress={() => {
              if (!external) {
                onOpenSource(reference);
                return;
              }
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
              name={external ? 'book' : 'doc.text'}
              color={appColors.primaryText}
              size={18}
            />
            <Text numberOfLines={1} style={styles.sourceText}>
              {external
                ? `Europe PMC${retrievedAt ? ` · 조회 ${retrievedAt}` : ''}`
                : compactTitle}
              {!external && date ? ` · ${date}` : ''}
            </Text>
          </Pressable>
        );
      })}
      {!expanded && references.length > 2 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`근거 ${references.length - 2}개 더 보기`}
          onPress={() => setExpanded(true)}
          style={styles.source}
        >
          <Text style={styles.sourceText}>+{references.length - 2}</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}
