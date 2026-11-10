import type { RecordRepository, RecordWriter } from '@orot/storage';
import { notifyLocalSourceDeleted } from '../storage/localDataClearEvents';

/** Invalidate retained reads once per committed transaction that removed local records. */
export async function commitHealthKitChanges(
  repository: Pick<RecordRepository, 'transaction'>,
  write: (writer: RecordWriter) => Promise<number>,
): Promise<number> {
  const deleted = await repository.transaction(write);
  if (deleted > 0) notifyLocalSourceDeleted('healthkit');
  return deleted;
}
