import { createDailyReportIdentity } from '@orot/domain';

/** The delivery instant does not establish the timezone at delivery. */
export interface DailyReminderEntry {
  readonly kind: 'daily_report';
  readonly entryKey: string;
  readonly deliveredAt: string;
  readonly observedTimeZone: string;
  readonly dateInObservedTimeZone: string;
  readonly deliveryTimeZone: 'unknown';
}

/**
 * The destination must reject an unresolvable date and deduplicate entryKey across
 * restarts: navigation and acknowledgement are not atomic. An observed timezone
 * is evidence for display, not proof of the timezone when delivery occurred.
 */
export type DailyReminderConsumer = (entry: DailyReminderEntry) => boolean;
let consumer: DailyReminderConsumer | undefined;

/** Register only while the destination can synchronously accept an entry. */
export function registerDailyReminderConsumer(
  next: DailyReminderConsumer,
): () => void {
  consumer = next;
  return () => {
    if (consumer === next) consumer = undefined;
  };
}

export function parseDailyReminderEntry(
  value: unknown,
): DailyReminderEntry | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (
    data.kind !== 'daily_report' ||
    typeof data.deliveryTimestamp !== 'string' ||
    !/^\d+(\.\d+)?$/.test(data.deliveryTimestamp)
  )
    return null;
  const instant = new Date(Number(data.deliveryTimestamp) * 1000);
  if (!Number.isFinite(instant.getTime()) || instant.getTime() > Date.now())
    return null;
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const part = (type: string) =>
      parts.find(item => item.type === type)?.value;
    const identity = createDailyReportIdentity(
      `${part('year')}-${part('month')}-${part('day')}`,
      zone,
    );
    return {
      kind: 'daily_report',
      entryKey: `daily-reminder:${data.deliveryTimestamp}`,
      deliveredAt: instant.toISOString(),
      observedTimeZone: identity.timeZone,
      dateInObservedTimeZone: identity.localDate,
      deliveryTimeZone: 'unknown',
    };
  } catch {
    return null;
  }
}

/** Retain a tap while navigation is busy; a missing consumer is not success. */
export function createDailyReminderDelivery(port: {
  consume(): Promise<unknown>;
  acknowledge(timestamp: string): Promise<void>;
  confirm(): Promise<'approved' | 'declined' | 'busy'>;
  unavailable(): void;
}) {
  let lastOpened: string | null = null;
  let queue = Promise.resolve();
  return () => {
    const next = queue.then(async () => {
      while (true) {
        const raw = await port.consume();
        if (raw === null) return;
        const timestamp = (raw as { deliveryTimestamp?: unknown })
          ?.deliveryTimestamp;
        if (typeof timestamp !== 'string') {
          port.unavailable();
          return;
        }
        const parsed = parseDailyReminderEntry(raw);
        if (!parsed) {
          port.unavailable();
          await port.acknowledge(timestamp);
          continue;
        }
        if (parsed.entryKey !== lastOpened) {
          const destination = consumer;
          if (!destination) {
            port.unavailable();
          } else {
            const decision = await port.confirm();
            if (decision === 'busy') return;
            if (decision === 'approved') {
              // A leave prompt can outlive the registered destination.
              if (consumer !== destination || !destination(parsed))
                port.unavailable();
              else lastOpened = parsed.entryKey;
            }
          }
        }
        await port.acknowledge(timestamp);
      }
    });
    queue = next.catch(() => undefined);
    return next;
  };
}
