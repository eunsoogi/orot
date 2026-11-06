import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import type {
  ConversationToolEvent,
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type { ToolCallScope } from '../aiFeatures/integration/toolReferenceIndex';
import { isSafeEuropePmcArticleUrl } from '../aiFeatures/integration/articleLinks';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import {
  sourceKey,
  sourceKindLabel,
} from './ConversationToolEventPresentation';
import {
  isPublicWebReference,
  publicWebSources,
} from '../externalMedicalEvidence/publicWebSources';

export type ResolveConversationToolSource = (
  reference: ToolSourceReference,
  signal: AbortSignal,
  scope: ToolCallScope,
) => Promise<EvidenceReference | undefined>;

function locatorUrl(reference: EvidenceReference): string {
  const locator = reference.locator as Record<string, unknown> | null;
  return typeof locator?.originalUrl === 'string' ? locator.originalUrl : '';
}

/** Resolve persisted references at the user's action boundary before opening any source. */
export function ConversationToolEventSources({
  event,
  sessionId,
  durableMessageId,
  resolveToolSource,
  onOpenSource,
  onLinkError,
  allowSourceActions,
}: {
  readonly event: ConversationToolEvent;
  readonly sessionId: string | null;
  readonly durableMessageId: string | undefined;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly allowSourceActions: boolean;
}) {
  const [resolving, setResolving] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<ReadonlySet<string>>(new Set());
  const [webChoices, setWebChoices] = useState<
    Readonly<Record<string, readonly { title: string; url: string }[]>>
  >({});
  const activeControllers = useRef(new Set<AbortController>());

  useEffect(
    () => () => {
      // A hidden row or changed session cannot finish an old source navigation.
      activeControllers.current.forEach(controller => controller.abort());
      activeControllers.current.clear();
    },
    [sessionId, event.operationRunId, event.callId],
  );

  const openSource = async (
    source: ToolSourceReference,
    selectedWebSource?: { title: string; url: string },
  ) => {
    if (
      !allowSourceActions ||
      !sessionId ||
      !durableMessageId ||
      !resolveToolSource
    )
      return;
    const key = sourceKey(source);
    const controller = new AbortController();
    activeControllers.current.add(controller);
    setResolving(current => new Set(current).add(key));
    setErrors(current => {
      const next = new Set(current);
      next.delete(key);
      return next;
    });
    try {
      const verified = await resolveToolSource(source, controller.signal, {
        sessionId,
        operationRunId: event.operationRunId,
        callId: event.callId,
      });
      if (controller.signal.aborted) return;
      if (!verified) throw new Error('Source validation failed.');

      if (isPublicWebReference(verified)) {
        const currentSources = publicWebSources(verified);
        if (!currentSources) throw new Error('Web source validation failed.');
        if (selectedWebSource) {
          const current = currentSources.find(
            sourceValue =>
              sourceValue.title === selectedWebSource.title &&
              sourceValue.url === selectedWebSource.url,
          );
          if (!current) throw new Error('Web source changed.');
          await Linking.openURL(current.url);
        } else if (currentSources.length > 1) {
          setWebChoices(current => ({ ...current, [key]: currentSources }));
        } else {
          await Linking.openURL(currentSources[0]!.url);
        }
      } else if (verified.sourceKind === 'external_medical') {
        const url = locatorUrl(verified);
        if (!isSafeEuropePmcArticleUrl(url))
          throw new Error('Publication URL validation failed.');
        await Linking.openURL(url);
      } else {
        onOpenSource(verified);
      }
    } catch {
      if (!controller.signal.aborted) {
        setErrors(current => new Set(current).add(key));
        onLinkError();
      }
    } finally {
      activeControllers.current.delete(controller);
      if (!controller.signal.aborted)
        setResolving(current => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
    }
  };

  return (
    <View style={styles.toolEventSection}>
      <Text style={styles.toolEventSectionLabel}>
        {t('ragConversation.tool.sources')}
      </Text>
      {event.sources.length ? (
        event.sources.map(source => {
          const key = sourceKey(source);
          const busy = resolving.has(key);
          const choices = webChoices[key] ?? [];
          const canOpen =
            allowSourceActions &&
            !!sessionId &&
            !!durableMessageId &&
            !!resolveToolSource;
          return (
            <View key={key} style={styles.toolEventSourceGroup}>
              {canOpen ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${t('ragConversation.tool.openSource')} · ${sourceKindLabel(source.sourceKind)}`}
                  accessibilityState={{ busy, disabled: busy }}
                  disabled={busy}
                  onPress={() => {
                    openSource(source);
                  }}
                  style={styles.toolEventSource}
                >
                  <Text style={styles.sourceText}>
                    {sourceKindLabel(source.sourceKind)} ·{' '}
                    {busy
                      ? t('ragConversation.tool.verifyingSource')
                      : t('ragConversation.tool.openSource')}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.toolEventValue}>
                  {sourceKindLabel(source.sourceKind)}
                </Text>
              )}
              {choices.map(choice => (
                <Pressable
                  accessibilityRole="link"
                  accessibilityLabel={t('ragConversation.tool.openWebSource', {
                    title: choice.title,
                  })}
                  key={`${choice.title}:${choice.url}`}
                  onPress={() => {
                    openSource(source, choice);
                  }}
                  style={styles.toolEventSource}
                >
                  <Text numberOfLines={2} style={styles.sourceText}>
                    {choice.title}
                  </Text>
                </Pressable>
              ))}
              {errors.has(key) ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {t('ragConversation.tool.sourceUnavailable')}
                </Text>
              ) : null}
            </View>
          );
        })
      ) : (
        <Text style={styles.toolEventValue}>
          {t('ragConversation.tool.sourcesUnavailable')}
        </Text>
      )}
    </View>
  );
}
