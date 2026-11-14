import { NativeModules, Platform } from 'react-native';
import { hasRealtimeVoiceRuntime } from '../voiceRuntimeCapability';

const original = NativeModules.VoiceRealtimeModule;
const os = Platform.OS;
afterEach(() => {
  NativeModules.VoiceRealtimeModule = original;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
});
it('requires the complete native surface without invoking it', () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  NativeModules.VoiceRealtimeModule = undefined;
  expect(hasRealtimeVoiceRuntime()).toBe(false);
  const openRealtimeCall = jest.fn();
  NativeModules.VoiceRealtimeModule = { openRealtimeCall };
  expect(hasRealtimeVoiceRuntime()).toBe(false);
  const stopRealtimeCall = jest.fn();
  const interruptRealtimeOutput = jest.fn();
  NativeModules.VoiceRealtimeModule = {
    openRealtimeCall,
    stopRealtimeCall,
    interruptRealtimeOutput,
  };
  expect(hasRealtimeVoiceRuntime()).toBe(false);
  const pauseRealtimeCall = jest.fn();
  const resumeRealtimeCall = jest.fn();
  NativeModules.VoiceRealtimeModule.pauseRealtimeCall = pauseRealtimeCall;
  expect(hasRealtimeVoiceRuntime()).toBe(false);
  NativeModules.VoiceRealtimeModule.resumeRealtimeCall = resumeRealtimeCall;
  expect(hasRealtimeVoiceRuntime()).toBe(true);
  expect(pauseRealtimeCall).not.toHaveBeenCalled();
  expect(resumeRealtimeCall).not.toHaveBeenCalled();
  expect(openRealtimeCall).not.toHaveBeenCalled();
  expect(stopRealtimeCall).not.toHaveBeenCalled();
  expect(interruptRealtimeOutput).not.toHaveBeenCalled();
  Object.defineProperty(Platform, 'OS', {
    value: 'android',
    configurable: true,
  });
  expect(hasRealtimeVoiceRuntime()).toBe(false);
});
