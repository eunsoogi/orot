import type {
  RegistryEntry,
  LocalEvidenceReferenceRegistry,
} from './evidenceRegistry';
import type { EvidenceSourceReadResult } from './evidenceSourceDocument';
import { validationContext } from './evidenceValidationContext';
import { periodCaptureReaders } from './periodCaptureReaders';
import type { CapturePeriodReads } from './conversationPeriodReadLease';

/** The live registry algorithm is unchanged; only issued period calculations may
 * use an explicitly supplied capture context. No context is installed globally. */
export async function readRegistrySource(
  registry: LocalEvidenceReferenceRegistry,
  entry: RegistryEntry | undefined,
  signal: AbortSignal,
  scope?: CapturePeriodReads,
): Promise<EvidenceSourceReadResult> {
  if (!entry || signal.aborted) return { status: 'unavailable' };
  try {
    const readers = () => periodCaptureReaders(registry, entry, scope);
    const current = await readers().readSource(signal);
    if (current.status !== 'available') return current;
    if (signal.aborted) return { status: 'unavailable' };
    if (!(await readers().validate(signal, validationContext()))) {
      const latest = await readers().readSource(signal);
      return latest.status === 'missing' || latest.status === 'unavailable'
        ? latest
        : { status: 'changed' };
    }
    return current;
  } catch {
    return { status: 'unavailable' };
  }
}
