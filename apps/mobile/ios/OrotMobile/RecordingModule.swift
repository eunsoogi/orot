import AVFoundation
import Foundation
import React
import UIKit

@objc(RecordingModule)
public final class RecordingModule: RCTEventEmitter, AVAudioRecorderDelegate {
  enum Status: String {
    case idle
    case recording
    case paused
    case interrupted
    case completed
  }

  let workQueue = DispatchQueue(label: "com.orot.mobile.recording")
  var status = Status.idle
  var startInProgress = false
  var consentAcknowledged = false
  var recorder: AVAudioRecorder?
  var recordingID: String?
  var recordingURL: URL?
  var startedAt: Date?
  var lastDurationMs = 0
  var wasInterrupted = false
  var timer: DispatchSourceTimer?
  var lastStateEvent = Date.distantPast
  var observers: [NSObjectProtocol] = []
  #if DEBUG && targetEnvironment(simulator)
  var syntheticCapture: RecordingSyntheticCapture?
  var syntheticCaptureRequested = false
  #endif

  @objc override public static func requiresMainQueueSetup() -> Bool { false }
  override public func supportedEvents() -> [String]! { ["RecordingStateChanged"] }

  override init() {
    super.init()
    observers.append(NotificationCenter.default.addObserver(
      forName: AVAudioSession.interruptionNotification,
      object: nil,
      queue: nil
    ) { [weak self] notification in
      guard
        let rawValue = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
        let interruption = AVAudioSession.InterruptionType(rawValue: rawValue)
      else { return }
      self?.workQueue.async { [weak self] in self?.handle(interruption) }
    })
    observers.append(NotificationCenter.default.addObserver(
      forName: UIApplication.willResignActiveNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.workQueue.async { [weak self] in self?.pauseForBackgrounding() }
    })
  }

  deinit {
    observers.forEach(NotificationCenter.default.removeObserver)
    timer?.cancel()
  }

  func handle(_ interruption: AVAudioSession.InterruptionType) {
    switch interruption {
    case .began:
      guard status == .recording else { return }
      recorder?.pause()
      deactivateAudioSession()
      stopTimer()
      wasInterrupted = true
      status = .interrupted
      emitState()
    case .ended:
      guard wasInterrupted && status == .interrupted else { return }
      wasInterrupted = false
      status = .paused
      emitState()
    @unknown default:
      break
    }
  }

  func pauseForBackgrounding() {
    guard status == .recording else { return }
    recorder?.pause()
    deactivateAudioSession()
    stopTimer()
    status = .paused
    emitState()
  }

  func startTimer() {
    stopTimer()
    let source = DispatchSource.makeTimerSource(queue: workQueue)
    source.schedule(deadline: .now(), repeating: .milliseconds(100))
    source.setEventHandler { [weak self] in
      guard let self, self.status == .recording else { return }
      #if DEBUG && targetEnvironment(simulator)
      if let capture = self.syntheticCapture {
        do {
          try capture.appendSyntheticAudio()
          self.lastDurationMs = capture.durationMs
        } catch {
          self.recorder?.pause()
          self.deactivateAudioSession()
          self.status = .paused
          self.stopTimer()
          self.emitState()
          return
        }
      } else {
        self.lastDurationMs = self.currentDurationMs()
      }
      #else
      self.lastDurationMs = self.currentDurationMs()
      #endif
      if Date().timeIntervalSince(self.lastStateEvent) >= 1 {
        self.lastStateEvent = Date()
        self.emitState()
      }
    }
    timer = source
    source.resume()
  }

  func stopTimer() {
    timer?.cancel()
    timer = nil
  }

  func deactivateAudioSession() {
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  func currentDurationMs() -> Int {
    #if DEBUG && targetEnvironment(simulator)
    if let syntheticCapture { return syntheticCapture.durationMs }
    #endif
    return max(0, Int((recorder?.currentTime ?? Double(lastDurationMs) / 1_000) * 1_000))
  }

  func snapshot() -> NSDictionary {
    [
      "status": status.rawValue,
      "id": recordingID as Any? ?? NSNull(),
      "durationMs": currentDurationMs(),
      "consentAcknowledged": consentAcknowledged,
    ] as NSDictionary
  }

  func emitState() {
    let value = snapshot()
    DispatchQueue.main.async { [weak self] in
      self?.sendEvent(withName: "RecordingStateChanged", body: value)
    }
  }

  func rejectStart(_ error: Error, reject: RCTPromiseRejectBlock) {
    stopTimer()
    recorder?.stop()
    recorder = nil
    #if DEBUG && targetEnvironment(simulator)
    syntheticCapture?.close()
    syntheticCapture = nil
    syntheticCaptureRequested = false
    #endif
    if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
    recordingID = nil
    recordingURL = nil
    startedAt = nil
    lastDurationMs = 0
    startInProgress = false
    consentAcknowledged = false
    wasInterrupted = false
    status = .idle
    emitState()
    deactivateAudioSession()
    reject("RECORDING_START_FAILED", error.localizedDescription, error as NSError)
  }

  func resetAfterFailure() {
    recorder = nil
    consentAcknowledged = false
    status = .idle
    startInProgress = false
    recordingID = nil
    recordingURL = nil
    startedAt = nil
    lastDurationMs = 0
    wasInterrupted = false
    stopTimer()
    deactivateAudioSession()
    emitState()
  }

  static func timestamp(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
  }
}

enum RecordingModuleError: LocalizedError {
  case prepareFailed
  case startFailed

  var errorDescription: String? {
    switch self {
    case .prepareFailed: return "The audio recorder could not prepare its local file."
    case .startFailed: return "The audio recorder could not start."
    }
  }
}
