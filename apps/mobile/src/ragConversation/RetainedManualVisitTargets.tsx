import { Fragment, useEffect, useRef, useState } from 'react';
import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServiceTypes';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { ManualVisitRecords } from './ManualVisitRecords';
import { ConversationSavedRecaps } from './ConversationSavedRecaps';
import type { SqlDatabase } from '@orot/storage';
import type { ManualVisitDrafts } from './useManualVisitDraft';

/** Restores only exact visits from source-validated turns of the currently active durable session. */
export function RetainedManualVisitTargets({
  sessionId,
  discover,
  drafts,
  excluded,
  loadRecapDatabase,
}: {
  readonly sessionId: string;
  readonly discover: AiFeatureServices['conversationArtifacts'];
  readonly drafts?: ManualVisitDrafts;
  readonly excluded: string;
  readonly loadRecapDatabase?: () => Promise<SqlDatabase>;
}) {
  const [targets, setTargets] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => {
    const invalidate = () => {
      active.current?.abort();
      setTargets([]);
      setError(false);
      setRevision(value => value + 1);
    };
    const clear = subscribeLocalDataClear(invalidate);
    const source = subscribeLocalSourceDeletion(invalidate);
    return () => {
      clear();
      source();
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    active.current = controller;
    setTargets([]);
    setError(false);
    async function read() {
      const discovery = await discover();
      if (!discovery) throw new Error('Conversation discovery is unavailable.');
      if (controller.signal.aborted) return;
      const version = await discovery.activeSessionVersion(sessionId);
      if (version === null) throw new Error('Conversation is unavailable.');
      const turns: Awaited<
        ReturnType<typeof discovery.readSession>
      >['items'][number][] = [];
      let cursor:
        { readonly createdAt: string; readonly id: string } | undefined;
      do {
        const page = await discovery.readSession({
          sessionId,
          ...(cursor ? { cursor } : {}),
          signal: controller.signal,
        });
        if (page.unavailableCount)
          throw new Error('Conversation source is unavailable.');
        turns.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor && !controller.signal.aborted);
      if (
        controller.signal.aborted ||
        !(await discovery.revalidateSession(
          sessionId,
          version,
          turns,
          controller.signal,
        ))
      )
        return;
      const existing = new Set(JSON.parse(excluded) as string[]);
      setTargets(
        [
          ...new Set(
            turns.flatMap(turn =>
              turn.visitQuestions ? [turn.visitQuestions.appointmentId] : [],
            ),
          ),
        ].filter(id => !existing.has(id)),
      );
    }
    read().catch(() => {
      if (!controller.signal.aborted) {
        setTargets([]);
        setError(true);
      }
    });
    return () => {
      controller.abort();
    };
  }, [sessionId, discover, excluded, revision]);
  return (
    <>
      {targets.map(id => (
        <Fragment key={id}>
          <ConversationSavedRecaps
            appointmentId={id}
            loadDatabase={loadRecapDatabase}
          />
          <ManualVisitRecords appointmentId={id} drafts={drafts} />
        </Fragment>
      ))}
      {error ? (
        <>
          <Text accessibilityRole="alert">
            {t('visitQuestions.retained.loadError')}
          </Text>
          <Button
            title={t('visitQuestions.retained.retry')}
            onPress={() => setRevision(value => value + 1)}
          />
        </>
      ) : null}
    </>
  );
}
