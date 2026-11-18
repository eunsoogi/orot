import type { RealtimeTranscript } from '../nativeRealtimeVoice';

// Native event ownership is explicit so tests can retain old listeners across rerenders.
export const realtimeEvents = {
  transcript: (_event: RealtimeTranscript) => {},
  systemCall: (_id: string, _active: boolean) => {},
};
export const mockNative = {
  open: jest.fn(async (_id: string) => {}),
  stop: jest.fn(async () => {}),
  pause: jest.fn(async () => {}),
  resume: jest.fn(async () => {}),
  interrupt: jest.fn(async () => {}),
  onSystemCall: (listener: typeof realtimeEvents.systemCall) => {
    realtimeEvents.systemCall = listener;
    return () => {};
  },
  onState: jest.fn(() => () => {}),
  onTranscript: jest.fn((listener: (event: RealtimeTranscript) => void) => {
    realtimeEvents.transcript = listener;
    return () => {};
  }),
  onInterrupted: jest.fn(() => () => {}),
};
