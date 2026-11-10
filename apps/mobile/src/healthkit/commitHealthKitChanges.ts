import type { RecordRepository, RecordWriter } from '@orot/storage';
import { notifyLocalSourceDeleted } from '../storage/localDataClearEvents';

/** Invalidate retained reads once per committed transaction that removed local records. */
export async function commitHealthKitChanges(
  repository: Pick<RecordRepository, 'transaction'>,
  write: (writer: RecordWriter) => Promise<number>,
): Promise<number> {
  const ids = new Set<string>();
  const deleted = await repository.transaction(writer =>
    write({
      ...writer,
      async delete(kind, id) {
        const removed = await writer.delete(kind, id);
        if (removed) ids.add(id);
        return removed;
      },
    }),
  );
  if (deleted > 0) notifyLocalSourceDeleted('healthkit', ids);
  return deleted;
}
