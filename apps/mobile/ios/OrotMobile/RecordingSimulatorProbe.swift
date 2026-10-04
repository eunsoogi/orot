#if DEBUG && targetEnvironment(simulator)
import AVFoundation
import Foundation
import React

extension RecordingModule {
  @objc(prepareSyntheticCapture:rejecter:)
  public func prepareSyntheticCapture(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    workQueue.async {
      guard self.status == .idle || self.status == .completed else {
        reject("RECORDING_ALREADY_ACTIVE", "Stop the current recording first.", nil)
        return
      }
      self.syntheticCaptureRequested = true
      resolve(true)
    }
  }

  @objc(simulateInterruption:resolver:rejecter:)
  public func simulateInterruption(
    _ phase: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    workQueue.async {
      let type: AVAudioSession.InterruptionType
      if phase == "began" && self.status == .recording {
        type = .began
      } else if phase == "ended" && self.status == .interrupted {
        type = .ended
      } else {
        reject("INVALID_INTERRUPTION_PROBE", "The recording is not in the expected state.", nil)
        return
      }
      NotificationCenter.default.post(
        name: AVAudioSession.interruptionNotification,
        object: AVAudioSession.sharedInstance(),
        userInfo: [AVAudioSessionInterruptionTypeKey: type.rawValue]
      )
      self.workQueue.async { resolve(nil) }
    }
  }
}
#endif
