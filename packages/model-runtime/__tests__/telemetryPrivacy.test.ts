import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { createExternalTelemetrySink, sanitizeTelemetryEvent, type TelemetryEvent } from '../src';

const safeEvent: TelemetryEvent = {
  operation: 'language-model.generate',
  outcome: 'success',
  durationMs: 12,
};

afterEach(() => jest.restoreAllMocks());

describe('external telemetry privacy boundary', () => {
  it('keeps external telemetry disabled when no explicit opt-in is supplied', () => {
    const record = jest.fn();
    const telemetry = createExternalTelemetrySink({ sink: { record } });

    telemetry.record(safeEvent);

    expect(record).not.toHaveBeenCalled();
  });

  it('forwards only the closed metadata contract after explicit opt-in', () => {
    const record = jest.fn();
    const telemetry = createExternalTelemetrySink({
      enabled: true,
      sink: { record },
    });

    telemetry.record(safeEvent);

    expect(record).toHaveBeenCalledWith(safeEvent);
    expect(Object.keys(record.mock.calls[0]![0] as object).sort()).toEqual([
      'durationMs',
      'operation',
      'outcome',
    ]);
  });

  it('rejects source text, health values, memory, secrets, and identifiers as extra fields', () => {
    const sentinel = {
      ...safeEvent,
      sourceText: 'SENTINEL_SOURCE_TEXT',
      healthValue: 'SENTINEL_HEALTH_VALUE',
      memoryContents: 'SENTINEL_MEMORY_CONTENT',
      accessToken: 'SENTINEL_OAUTH_SECRET',
      sourceId: 'SENTINEL_SOURCE_ID',
      providerId: 'SENTINEL_ACCOUNT_ID',
    } as TelemetryEvent;
    const logs = [
      jest.spyOn(console, 'debug').mockImplementation(() => undefined),
      jest.spyOn(console, 'error').mockImplementation(() => undefined),
      jest.spyOn(console, 'info').mockImplementation(() => undefined),
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];
    const record = jest.fn();
    const telemetry = createExternalTelemetrySink({
      enabled: true,
      sink: { record },
    });

    expect(sanitizeTelemetryEvent(sentinel)).toBeUndefined();
    telemetry.record(sentinel);

    expect(record).not.toHaveBeenCalled();
    const capturedLogs = JSON.stringify(logs.flatMap((log) => log.mock.calls));
    for (const value of [
      'SENTINEL_SOURCE_TEXT',
      'SENTINEL_HEALTH_VALUE',
      'SENTINEL_MEMORY_CONTENT',
      'SENTINEL_OAUTH_SECRET',
      'SENTINEL_SOURCE_ID',
      'SENTINEL_ACCOUNT_ID',
    ]) {
      expect(capturedLogs).not.toContain(value);
    }
  });

  it('rejects malformed events and fails closed when opt-in has no sink', () => {
    const record = jest.fn();
    const telemetry = createExternalTelemetrySink({ enabled: true });

    expect(sanitizeTelemetryEvent({ ...safeEvent, durationMs: Number.NaN })).toBeUndefined();
    expect(sanitizeTelemetryEvent({ ...safeEvent, errorCode: 'secret message' })).toBeUndefined();
    telemetry.record(safeEvent);

    expect(record).not.toHaveBeenCalled();
  });

  it('does not let sink failures escape or write the rejected payload to logs', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const sinkFailure = new Error('SENTINEL_SINK_FAILURE');
    const telemetry = createExternalTelemetrySink({
      enabled: true,
      sink: { record: () => Promise.reject(sinkFailure) },
    });

    expect(() => telemetry.record(safeEvent)).not.toThrow();
    await Promise.resolve();

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
