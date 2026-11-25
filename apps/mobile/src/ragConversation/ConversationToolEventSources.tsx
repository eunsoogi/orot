import { beginSourceOpenTiming } from '../providers/sourceOpenDiagnostic';
import { waitForPublicSourcePresentation } from './publicSourcePresentation';
import {
  PublicToolSourceSheet,
  type PublicToolSourceChoice,
  type PublicToolSourceSheetState,
} from './PublicToolSourceSheet';
import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import type {
  ConversationToolEvent,
  EvidenceReference,
  ToolSourceReference,
} from '@orot/agent-runtime';
import type { ToolCallScope } from '../aiFeatures/integration/toolReferenceIndex';
import { verifiedPublicToolSourceChoices } from './verifiedPublicToolSourceChoices';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import {
  sourceKey,
  sourceKindLabel,
} from './ConversationToolEventPresentation';

function withoutSourceKey(current: ReadonlySet<string>, key: string) {
  const next = new Set(current);
  next.delete(key);
  return next;
}

export type ResolveConversationToolSource = (
  reference: ToolSourceReference,
  signal: AbortSignal,
  scope: ToolCallScope,
) => Promise<EvidenceReference | undefined>;

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
  const [sheet, setSheet] = useState<PublicToolSourceSheetState | null>(null);
  const publicOperation = useRef<AbortController | null>(null);
  const close = () => {
    publicOperation.current?.abort();
    publicOperation.current = null;
    sheet?.timing?.retire();
    if (sheet) setResolving(current => withoutSourceKey(current, sheet.key));
    setSheet(null);
  };
  const activeControllers = useRef(new Set<AbortController>());

  const sourceIdentity = JSON.stringify(event.sources);
  useEffect(() => {
    const controllers = activeControllers.current;
    setSheet(null);
    setResolving(new Set());
    return () => {
      // A hidden row or changed session cannot finish an old source navigation.
      controllers.forEach(controller => controller.abort());
      controllers.clear();
      publicOperation.current = null;
    };
  }, [
    allowSourceActions,
    sessionId,
    event.operationRunId,
    event.callId,
    durableMessageId,
    sourceIdentity,
  ]);

  const openSource = async (
    source: ToolSourceReference,
    selectedWebSource?: PublicToolSourceChoice,
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
    const external = source.sourceKind === 'external_medical';
    if (external && publicOperation.current) return;
    const timing = !selectedWebSource
      ? beginSourceOpenTiming(
          controller.signal,
          external ? 'source_open_public_tap' : 'source_open_local_tap',
        )
      : undefined;
    const presentation =
      external && !selectedWebSource
        ? waitForPublicSourcePresentation(controller.signal)
        : undefined;
    if (external) {
      // A second press cannot start another lookup before React disables the chip.
      publicOperation.current = controller;
      setSheet(current =>
        selectedWebSource && current?.key === key
          ? { ...current, opening: true }
          : { key, timing, onPresented: presentation?.shown },
      );
    }
    activeControllers.current.add(controller);
    setResolving(current => new Set(current).add(key));
    setErrors(current => withoutSourceKey(current, key));
    try {
      // Leave the tap free to commit the empty, cancellable sheet before a
      // resolver can do synchronous validation on the shared JS thread.
      if (presentation && !(await presentation.ready)) return;
      if (controller.signal.aborted) return;
      const verified = await resolveToolSource(source, controller.signal, {
        sessionId,
        operationRunId: event.operationRunId,
        callId: event.callId,
      });
      if (controller.signal.aborted) return;
      if (!verified) throw new Error('Source validation failed.');

      if (external) {
        const choices = verifiedPublicToolSourceChoices(verified);
        if (!choices?.length)
          throw new Error('Public source validation failed.');
        timing?.mark('source_open_public_proof');
        if (selectedWebSource) {
          const current = choices.find(
            choice =>
              choice.title === selectedWebSource.title &&
              choice.url === selectedWebSource.url,
          );
          if (!current) throw new Error('Public source changed.');
          await Linking.openURL(current.url);
        }
        if (!controller.signal.aborted)
          setSheet(current => ({ key, choices, timing: current?.timing }));
      } else {
        timing?.mark('source_open_local_admission');
        onOpenSource(verified);
      }
    } catch {
      if (!controller.signal.aborted) {
        if (external)
          setSheet(current => ({
            key,
            failed: true,
            timing: current?.timing,
          }));
        else {
          setErrors(current => new Set(current).add(key));
          onLinkError();
        }
      }
    } finally {
      activeControllers.current.delete(controller);
      if (publicOperation.current === controller)
        publicOperation.current = null;
      if (!controller.signal.aborted)
        setResolving(current => withoutSourceKey(current, key));
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
                  accessibilityLabel={`${t('ragConversation.tool.openSource')} · ${sourceKindLabel(source.sourceKind, event.toolName)}`}
                  accessibilityState={{ busy, disabled: busy }}
                  disabled={busy}
                  onPress={() => {
                    openSource(source);
                  }}
                  style={styles.toolEventSource}
                >
                  <Text style={styles.sourceText}>
                    {sourceKindLabel(source.sourceKind, event.toolName)} ·{' '}
                    {busy
                      ? t('ragConversation.tool.verifyingSource')
                      : t('ragConversation.tool.openSource')}
                  </Text>
                </Pressable>
              ) : (
                <Text style={styles.toolEventValue}>
                  {sourceKindLabel(source.sourceKind, event.toolName)}
                </Text>
              )}
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
      {sheet ? (
        <PublicToolSourceSheet
          state={sheet}
          destination={sourceKindLabel('external_medical', event.toolName)}
          // Public web already includes “source” in its accessible name.
          showSourceSuffix={event.toolName !== 'public-web-search'}
          close={close}
          open={choice => {
            const source = event.sources.find(
              item => sourceKey(item) === sheet.key,
            );
            if (source) openSource(source, choice);
          }}
        />
      ) : null}
    </View>
  );
}
