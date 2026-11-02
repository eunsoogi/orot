import { SourceRecordSchema } from '@orot/domain';
import type { SourceRecord } from '@orot/domain';
import { requireLiveCheckpointSource } from '@orot/storage';
import type { RecordRepository } from '@orot/storage';
import type { SqliteCheckpointSaver } from '@orot/agent-runtime';
import { readHealthReviewPending } from './pending';
import type { createHealthReviewDraftStorage } from './draftStorage';
import type { HealthReviewSafetyDraft } from './safetyInput';

export const healthReviewRequestSystem = 'orot.health-review-request';
export const healthReviewCheckpointKey = (sourceId: string) => ({
  configurable: { thread_id: 'health-review:' + encodeURIComponent(sourceId) },
});

/** Request notes own a graph lifecycle; their titles are neither evidence nor prompts. */
export function isHealthReviewRequest(
  source: SourceRecord | null,
): source is SourceRecord {
  return Boolean(
    source &&
    source.sourceKind === 'user_note' &&
    source.provenance.origin === 'user_reported' &&
    source.provenance.sourceRecordIds.length === 0 &&
    source.provenance.source?.system === healthReviewRequestSystem &&
    source.title?.trim(),
  );
}

function secureRequestId(): string {
  const crypto = (
    globalThis as unknown as {
      crypto?: { getRandomValues?: (bytes: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (!crypto?.getRandomValues)
    throw new Error('Secure randomness unavailable.');
  return (
    'health-review-' +
    Array.from(crypto.getRandomValues(new Uint8Array(16)), byte =>
      byte.toString(16).padStart(2, '0'),
    ).join('')
  );
}

export function createHealthReviewRequests(
  repository: RecordRepository,
  saver: Pick<SqliteCheckpointSaver, 'getTuple'>,
  options: {
    createId?: () => string;
    now?: () => string;
    drafts?: ReturnType<typeof createHealthReviewDraftStorage>;
  } = {},
) {
  const live = (sourceId: string) =>
    repository.transaction(async (writer, sql) => {
      if (!sql) throw new Error('Canonical request storage required.');
      await requireLiveCheckpointSource(sql, sourceId);
      const source = await writer.get('source_record', sourceId);
      if (!isHealthReviewRequest(source))
        throw new Error('Review request unavailable.');
      return source;
    });
  return {
    live,
    async saveDraft(sourceId: string, draft: HealthReviewSafetyDraft) {
      await live(sourceId);
      if (!options.drafts) throw new Error('Review draft storage unavailable.');
      await options.drafts.save(sourceId, draft);
    },
    async create(name: string) {
      const title = name.trim();
      if (!title) throw new Error('A review request name is required.');
      const now = (options.now ?? (() => new Date().toISOString()))();
      const source = SourceRecordSchema.parse({
        id: (options.createId ?? secureRequestId)(),
        sourceKind: 'user_note',
        title,
        effectiveAt: now,
        recordedAt: now,
        ingestedAt: now,
        reviewState: { status: 'unreviewed' },
        provenance: {
          origin: 'user_reported',
          sourceRecordIds: [],
          source: { system: healthReviewRequestSystem },
        },
      });
      await repository.transaction(async writer => {
        if (await writer.get('source_record', source.id))
          throw new Error('Review ID already exists.');
        await writer.put('source_record', source);
      });
      return source;
    },
    async pending(sourceId: string) {
      await live(sourceId);
      const tuple = await saver.getTuple(healthReviewCheckpointKey(sourceId));
      await live(sourceId);
      return readHealthReviewPending(tuple, sourceId);
    },
    async list() {
      const sources = (await repository.list('source_record')).filter(
        isHealthReviewRequest,
      );
      const result: Array<{
        source: SourceRecord;
        pending: ReturnType<typeof readHealthReviewPending>;
        draft?: HealthReviewSafetyDraft;
      }> = [];
      for (const source of sources) {
        try {
          await live(source.id);
          const tuple = await saver.getTuple(
            healthReviewCheckpointKey(source.id),
          );
          await live(source.id);
          const draft = await options.drafts?.read(source.id);
          await live(source.id);
          result.push({
            source,
            pending: readHealthReviewPending(tuple, source.id),
            draft,
          });
        } catch (error) {
          // Only concurrent deletion is benign; corrupted drafts must surface as storage errors.
          try {
            await live(source.id);
          } catch {
            continue;
          }
          throw error;
        }
      }
      return result;
    },
  };
}
