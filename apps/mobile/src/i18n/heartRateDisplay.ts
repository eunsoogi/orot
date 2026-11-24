import { formatNumber } from './index';

/** Canonical and known equivalent BPM display units, never a unit conversion. */
export function isHeartRateDisplayUnit(unit: string): boolean {
  return unit === 'count/min' || unit === 'bpm' || unit === 'BPM';
}

/** Presentation only; the stored precision and all chart/aggregate math stay intact. */
export function formatHeartRateBpm(value: number, includeUnit = true): string {
  const amount = formatNumber(Math.trunc(value), { maximumFractionDigits: 0 });
  return includeUnit ? `${amount} BPM` : amount;
}
