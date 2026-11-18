import type { HealthContextReader } from '../../healthEvidence/healthContext/reader';
import { capturedHealthContextReadOwner } from '../../healthEvidence/healthContext/healthContextReadOperation';

type Lease = { read: HealthContextReader; dispose(): void };
type Issuance = {
  key: object;
  current(): boolean;
  open(signal: AbortSignal): Lease | undefined;
};
const issued = new WeakMap<
  object,
  {
    reader: HealthContextReader;
    key: object;
    current: Issuance['current'];
    open: Issuance['open'];
  }
>();
const scopes = new WeakMap<object, { read: unknown; dispose: unknown }>();
const proxies = new WeakMap<HealthContextReader, Issuance>();

/** Only the conversation adapter issues this separate capability for its own proxy.
 * It is not registration as a database reader and never lends a hydration cache. */
export function registerConversationPeriodReadLease(
  proxy: HealthContextReader,
  key: object,
  current: () => boolean,
  open: (signal: AbortSignal) => Lease | undefined,
) {
  proxies.set(proxy, { key, current, open });
}

/** Resolve only at typed source registration, so later owner replacement cannot
 * manufacture new authority for an already-registered source. */
export function capturedPeriodReader(reader: HealthContextReader) {
  const proxy = proxies.get(reader);
  const source = proxy ?? capturedHealthContextReadOwner(reader);
  const issuance = source && {
    key: source.key,
    current: () =>
      (!proxy || proxies.get(reader) === proxy) && source.current(),
    open: source.open,
  };
  if (issuance) issued.set(issuance, { reader, ...issuance });
  return issuance;
}

/** A request owns fresh per-reader calculations, never source results or validity. */
export function createCapturePeriodReads(signal: AbortSignal) {
  const leases = new Map<object, Lease>();
  let registryOwner: object | undefined;
  let active = !signal.aborted;
  const dispose = () => {
    active = false;
    for (const lease of leases.values()) lease.dispose();
    leases.clear();
    registryOwner = undefined;
    signal.removeEventListener('abort', dispose);
  };
  signal.addEventListener('abort', dispose, { once: true });
  const scope = {
    forReader(
      reader: HealthContextReader,
      registry: object,
      issuance?: Issuance,
    ): HealthContextReader {
      const provenance = issuance && issued.get(issuance);
      const current = () =>
        Boolean(
          active &&
          issuance &&
          provenance &&
          provenance.reader === reader &&
          provenance.key === issuance.key &&
          provenance.current === issuance.current &&
          provenance.open === issuance.open &&
          issuance.current() &&
          ownsCapturePeriodReads(scope) &&
          (!registryOwner || registryOwner === registry),
        );
      if (!current() || !issuance) return reader;
      registryOwner = registry;
      let lease = leases.get(issuance.key);
      if (!lease) {
        lease = issuance.open(signal);
        if (!lease) return reader;
        leases.set(issuance.key, lease);
      }
      const captured = lease;
      return (...args) =>
        current() ? captured.read(...args) : reader(...args);
    },
    dispose,
  };
  scopes.set(scope, { read: scope.forReader, dispose: scope.dispose });
  return scope;
}

/** Structural lookalikes and late method replacement never gain calculation authority. */
export function ownsCapturePeriodReads(scope: CapturePeriodReads) {
  const original = scopes.get(scope);
  return (
    original !== undefined &&
    original.read === scope.forReader &&
    original?.dispose === scope.dispose
  );
}
export type CapturePeriodReads = ReturnType<typeof createCapturePeriodReads>;
