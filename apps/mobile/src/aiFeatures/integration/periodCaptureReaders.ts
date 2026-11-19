import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import type {
  RegistryEntry,
  LocalEvidenceReferenceRegistry,
} from './evidenceRegistry';
import { ownsEvidenceRegistryReaders } from './evidenceRegistryReadOwner';
import {
  capturedPeriodReader,
  ownsCapturePeriodReads,
  type CapturePeriodReads,
} from './conversationPeriodReadLease';

type Readers = Pick<RegistryEntry, 'readSource' | 'validate'>;
const registrations = new WeakMap<
  Readers['readSource'],
  {
    registry: LocalEvidenceReferenceRegistry;
    current: () => boolean;
    fallback: HealthContextReader;
    issuance: ReturnType<typeof capturedPeriodReader>;
    validate: Readers['validate'];
    reader: HealthContextReader;
    create: (reader: HealthContextReader) => Readers;
  }
>();

/** Issued only by typed period registration, never inferred from an alias locator. */
export function registerPeriodCaptureReaders(
  readers: Readers,
  registry: LocalEvidenceReferenceRegistry,
  reader: HealthContextReader,
  create: (reader: HealthContextReader) => Readers,
  current: () => boolean,
  fallback: HealthContextReader,
) {
  registrations.set(readers.readSource, {
    registry,
    current,
    fallback,
    issuance: capturedPeriodReader(reader),
    validate: readers.validate,
    reader,
    create,
  });
}

/** Preserve custom callbacks and the registry's original read/validate/reread order. */
export function periodCaptureReaders(
  registry: LocalEvidenceReferenceRegistry,
  entry: Readers,
  scope?: CapturePeriodReads,
): Readers {
  const registration = registrations.get(entry.readSource);
  if (
    !scope ||
    !ownsCapturePeriodReads(scope) ||
    !ownsEvidenceRegistryReaders(registry) ||
    !registration ||
    registration.registry !== registry ||
    !registration.current() ||
    registration.validate !== entry.validate
  )
    return entry;
  // Resolve on every callback invocation: abort/disposal and late owner changes
  // cannot turn a previously selected calculation into lasting source authority.
  const read: HealthContextReader = (...args) => {
    // context.once schedules its load in a microtask. Recheck at the actual
    // calculation call as well, without replaying or skipping source callbacks.
    const current =
      ownsCapturePeriodReads(scope) &&
      ownsEvidenceRegistryReaders(registry) &&
      registration.current() &&
      registrations.get(entry.readSource) === registration &&
      registration.validate === entry.validate;
    return (
      current
        ? scope.forReader(registration.reader, registry, registration.issuance)
        : registration.fallback
    )(...args);
  };
  return registration.create(read);
}
