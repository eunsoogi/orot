import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import { treatmentPublicSourceUrl } from '../aiFeatures/integration/treatmentPublicSourceUrl';
import { hypertensionEducation } from './hypertensionEducation';
import type { SafetyPolicyInput } from '@orot/domain';
import { t } from '../i18n';
import { dispatchExplicitTreatmentAction } from '../ragConversation/conversationVisitDispatch';
import { generalEducation, savedEducation } from './localTreatmentEvidence';
import { treatmentConversationSender } from './treatmentConversationSender';
import { openTreatmentDatabase } from './TreatmentLibraryChoices';
import {
  deleteSavedTreatment,
  prepareTreatmentRetention,
} from './treatmentSavedLibrary';
import type { SavedTreatmentChoice } from './treatmentSavedLibrary';
import type { TreatmentSourceChoice } from './treatmentSourceChoices';
import type { TreatmentRequestAction } from './treatmentRequestProducer';

import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { VerifiedTreatmentSource } from './treatmentSourceLinks';

/** Keeps the treatment interaction out of the composer and model history. */
export function useTreatmentConversationAction({
  ownership,
  sessionId,
  onOpenSource,
}: TreatmentActionProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    answer: string;
    verified: boolean;
    links?: readonly VerifiedTreatmentSource[];
    general?: readonly string[];
  } | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<'form' | 'sources' | 'saved'>('form');
  const [source, setSource] = useState<TreatmentSourceChoice | null>(null);
  const [saved, setSaved] = useState<SavedTreatmentChoice | null>(null);
  const [followUp, setFollowUp] = useState(false);
  const [publicTopic, setPublicTopic] = useState<'hypertension' | null>(null);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);

  const close = () => {
    active.current?.abort();
    active.current = null;
    setPending(false);
    setResult(null);
    setSource(null);
    setSaved(null);
    setFollowUp(false);
    setPublicTopic(null);
    setMode('form');
    setOpen(false);
  };

  const run = async (perform: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const operation = new AbortController();
    active.current = operation;
    // Unmount the form before processing. No raw input reaches screen state.
    setPending(true);
    setResult(null);
    try {
      await perform(operation.signal);
    } catch {
      if (!operation.signal.aborted)
        setResult({ answer: t('treatmentSafety.withheld'), verified: false });
    } finally {
      if (active.current === operation) {
        active.current = null;
        setPending(false);
      }
    }
  };

  const submit = (
    safetyInput: SafetyPolicyInput,
    skipEducation: boolean,
    save = false,
  ) =>
    run(async signal => {
      let lease = ownership.lease(sessionId);
      let links: readonly VerifiedTreatmentSource[] = [];
      let general: readonly string[] = [];
      const ownerIsCurrent = () => {
        if (!ownership.isActive(sessionId)) return false;
        const current = ownership.lease(sessionId);
        return (
          !lease ||
          (current?.id === lease.id && current.version === lease.version)
        );
      };
      const action: TreatmentRequestAction = saved
        ? followUp
          ? {
              kind: 'follow_up',
              artifactId: saved.id,
              sessionId: saved.sessionId,
              sessionVersion: lease?.version ?? -1,
              selection: { kind: 'source_question', index: 0 },
            }
          : {
              kind: 'reopen',
              artifactId: saved.id,
              sessionId: saved.sessionId,
              sessionVersion: lease?.version ?? -1,
            }
        : {
            kind: 'request',
            selection: source
              ? { kind: 'condition', index: 0 }
              : {
                  kind: publicTopic
                    ? 'hypertension_overview'
                    : 'general_options',
                },
          };
      const outcome = await dispatchExplicitTreatmentAction(
        treatmentConversationSender({
          database: openTreatmentDatabase,
          action,
          request:
            source?.request ??
            (saved
              ? savedEducation
              : publicTopic
                ? hypertensionEducation
                : generalEducation),
          safetyInput,
          skipEducation,
          presentation: {
            ownerIsCurrent: () =>
              ownerIsCurrent() && (!saved || lease?.id === saved.sessionId),
            onVerified: (verifiedLinks, verifiedGeneral) => {
              links = verifiedLinks;
              general = verifiedGeneral;
            },
          },
          ...(save
            ? {
                prepareRetention: async (_database, retentionSignal) => {
                  lease = await ownership.begin(sessionId, retentionSignal);
                  return prepareTreatmentRetention(lease, saved ?? undefined);
                },
                onSaved: item => {
                  if (!signal.aborted) setSaved(item);
                },
              }
            : {}),
        }),
        signal,
      );
      if (!signal.aborted)
        setResult({
          answer:
            outcome.status === 'answer'
              ? outcome.answer
              : t('treatmentSafety.withheld'),
          verified:
            outcome.status === 'answer' && outcome.completion === 'partial',
          links,
          general,
        });
    });

  const remove = (item: SavedTreatmentChoice) =>
    run(async signal => {
      const database = await openTreatmentDatabase();
      const lease = ownership.lease(sessionId);
      if (signal.aborted || !lease) return;
      await deleteSavedTreatment(database, item, lease);
      if (signal.aborted) return;
      setSaved(null);
      setFollowUp(false);
      setMode('saved');
    });

  const openSource = (link: VerifiedTreatmentSource) =>
    run(async signal => {
      try {
        const reference = await ownership.resolveSource?.(link, signal);
        if (signal.aborted || !ownership.isActive(sessionId)) return;
        if (!reference) throw new Error('Source is unavailable.');
        if (link.source.reference.sourceKind === 'external_medical') {
          // The verified citation is the only public destination this tap may open.
          const url = treatmentPublicSourceUrl(reference);
          if (
            !url ||
            stableJson(reference) !== stableJson(link.source.reference)
          )
            throw new Error('Public source changed.');
          await Linking.openURL(url);
          if (!signal.aborted) close();
          return;
        }
        close();
        onOpenSource(reference);
      } catch {
        if (!signal.aborted && ownership.isActive(sessionId))
          setResult({
            answer: t('ragConversation.conversation.sourceOpenFailed'),
            verified: false,
          });
      }
    });

  return {
    open,
    setOpen,
    result,
    pending,
    mode,
    setMode,
    source,
    setSource,
    saved,
    setSaved,
    followUp,
    setFollowUp,
    publicTopic,
    setPublicTopic,
    setResult,
    close,
    submit,
    remove,
    openSource,
  };
}

export interface TreatmentActionProps {
  readonly ownership: ConversationSessions['treatment'];
  readonly sessionId: number;
  readonly onOpenSource: (reference: EvidenceReference) => void;
}
