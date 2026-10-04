import AVFoundation
import Foundation
import React

extension RecordingModule {
  public func audioRecorderEncodeErrorDidOccur(_ recorder: AVAudioRecorder, error: Error?) {
    workQueue.async {
      guard self.recorder === recorder && self.status == .recording else { return }
      recorder.pause()
      self.deactivateAudioSession()
      self.status = .paused
      self.stopTimer()
      self.emitState()
    }
  }

  func startMicrophoneRecording(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) throws {
    let identifier = UUID().uuidString.lowercased()
    let url = try RecordingFileSecurity.fileURL(id: identifier, extension: "m4a")
    recordingID = identifier
    recordingURL = url
    startedAt = Date()
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .default, options: [])
    try session.setActive(true)
    let recorder = try AVAudioRecorder(url: url, settings: [
      AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
      AVSampleRateKey: 44_100,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 64_000,
      AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
    ])
    recorder.delegate = self
    guard recorder.prepareToRecord() else { throw RecordingModuleError.prepareFailed }
    _ = try RecordingFileSecurity.protect(url)
    guard recorder.record() else { throw RecordingModuleError.startFailed }
    self.recorder = recorder
    beginSession(identifier: identifier, url: url)
    resolve(snapshot())
  }

  #if DEBUG && targetEnvironment(simulator)
  func startSyntheticRecording(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) throws {
    let identifier = UUID().uuidString.lowercased()
    let url = try RecordingFileSecurity.fileURL(
      id: identifier,
      extension: "caf",
      allowUnverifiedProtectionForSimulator: true
    )
    recordingID = identifier
    recordingURL = url
    startedAt = Date()
    let capture = try RecordingSyntheticCapture(url: url)
    _ = try RecordingFileSecurity.protect(url, allowUnverifiedProtectionForSimulator: true)
    syntheticCapture = capture
    beginSession(identifier: identifier, url: url)
    resolve(snapshot())
  }
  #endif

  func beginSession(identifier: String, url: URL) {
    recordingID = identifier
    recordingURL = url
    startedAt = Date()
    startInProgress = false
    lastDurationMs = 0
    status = .recording
    lastStateEvent = Date.distantPast
    startTimer()
    emitState()
  }

  func requestMicrophonePermission(_ completion: @escaping (Bool) -> Void) {
    DispatchQueue.main.async {
      if #available(iOS 17.0, *) {
        AVAudioApplication.requestRecordPermission(completionHandler: completion)
      } else {
        AVAudioSession.sharedInstance().requestRecordPermission(completion)
      }
    }
  }

}
