import { providerDiagnostic } from '../providers/diagnostics';

type DatabaseOwner = 'healthkit' | 'memory';

/** Called inside the transaction callback, not while queued; no record data enters this sink. */
export async function observeDatabaseOwner<T>(
  owner: DatabaseOwner,
  work: () => Promise<T>,
): Promise<T> {
  const report = (event: 'started' | 'completed' | 'failed') => {
    try {
      providerDiagnostic('storage', `transaction_${owner}`, event);
    } catch {
      // Diagnostics must preserve the owning transaction's result and rollback behavior.
    }
  };
  report('started');
  try {
    const value = await work();
    // Callback completion precedes the driver's commit; it is not a durable-write claim.
    report('completed');
    return value;
  } catch (error) {
    report('failed');
    throw error;
  }
}
