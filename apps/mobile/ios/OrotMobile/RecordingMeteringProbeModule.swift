#if (OROT_RECORDING_METERING_SIMULATOR_TEST || OROT_TESTS) && targetEnvironment(simulator)
    import AVFoundation
    import Foundation
    import React
    import UIKit

    /// A separate native instance has no recording identifier, save, export, or transcription operation.
    @objc(RecordingMeteringProbeModule)
    final class RecordingMeteringProbeModule: RCTEventEmitter, AVAudioRecorderDelegate {
        private let queue = DispatchQueue(label: "com.orot.mobile.metering-probe")
        private var recorder: AVAudioRecorder?
        private var file: RecordingMeteringProbeFile?
        private var timer: DispatchSourceTimer?
        private var deadline: DispatchWorkItem?
        // Permission readiness belongs to the main queue; audio and file state remain on the probe queue.
        private var permission: RecordingMeteringPermission?
        private var observers: [NSObjectProtocol] = []
        private var status = "idle"
        private var reason = "none"
        private var stage = "idle"
        private var durationMs = 0
        private var ticks = 0
        private var cleanupComplete = true
        private var captureBeganAt: TimeInterval?
        private var interruptionOrigin = "none"
        private var interruptionType: UInt?

        /// Queue delivery may follow recorder preparation. A pre-capture permission-sheet event cannot interrupt a capture that did not yet exist.
        static func interruptionApplies(observedAt: TimeInterval, captureBeganAt: TimeInterval?) -> Bool {
            guard let captureBeganAt else { return false }
            return observedAt >= captureBeganAt
        }

        override static func requiresMainQueueSetup() -> Bool {
            false
        }

        override func supportedEvents() -> [String]! {
            ["RecordingMeteringProbeChanged"]
        }

        override init() {
            super.init()
            for name in [UIApplication.willResignActiveNotification, AVAudioSession.interruptionNotification] {
                observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] notification in
                    let observedAt = ProcessInfo.processInfo.systemUptime
                    let type = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
                    self?.queue.async { [weak self] in
                        guard let self, status == "recording" || status == "paused",
                              Self.interruptionApplies(observedAt: observedAt, captureBeganAt: captureBeganAt) else { return }
                        // Fixed notification identity and type diagnose the permission boundary without exposing audio or arbitrary userInfo.
                        interruptionOrigin = name == UIApplication.willResignActiveNotification ? "application-inactive" : "audio-session"
                        interruptionType = type
                        finishSession(reason: "interruption")
                    }
                })
            }
        }

        deinit {
            observers.forEach(NotificationCenter.default.removeObserver)
            timer?.cancel()
            deadline?.cancel()
            recorder?.stop()
            _ = file?.cleanup()
        }

        @objc(start:resolver:rejecter:)
        func start(_ consent: Bool, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            queue.async {
                guard consent else { reject("METERING_CONSENT_REQUIRED", "Acknowledge real microphone capture first.", nil); return }
                guard self.status == "idle" else { reject("METERING_ALREADY_STARTED", "This bounded probe can run once per launch.", nil); return }
                self.status = "permission"
                DispatchQueue.main.async {
                    let permission = RecordingMeteringPermission()
                    self.permission = permission
                    permission.request { granted in
                        self.queue.async {
                            guard self.status == "permission" else {
                                reject("METERING_CANCELED", "The microphone probe was stopped before permission returned.", nil)
                                return
                            }
                            guard granted else {
                                self.finishSession(reason: "permission-denied")
                                reject("METERING_PERMISSION_DENIED", "Microphone permission was not granted.", nil)
                                return
                            }
                            do {
                                try self.begin()
                                resolve(self.snapshot())
                            } catch {
                                self.finishSession(reason: "start-failed")
                                // Underlying file/AV errors can include paths: expose only a fixed error code.
                                reject("METERING_START_FAILED", "The unlinked microphone probe could not start.", nil)
                            }
                        }
                    }
                }
            }
        }

        private func begin() throws {
            stage = "temporary-directory"
            let ownedFile = try RecordingMeteringProbeFile()
            file = ownedFile
            cleanupComplete = false
            let session = AVAudioSession.sharedInstance()
            stage = "audio-session"
            try session.setCategory(.record, mode: .default, options: [])
            try session.setActive(true)
            stage = "recorder-initialization"
            let capture = try AVAudioRecorder(url: ownedFile.url, settings: [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 44100,
                AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000,
                AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
            ])
            recorder = capture
            capture.delegate = self
            capture.isMeteringEnabled = true
            stage = "recorder-preparation"
            guard capture.prepareToRecord() else { throw RecordingMeteringProbeError.prepare }
            stage = "secure-unlink"
            try ownedFile.secureAndUnlink()
            stage = "recorder-start"
            guard capture.record() else { throw RecordingMeteringProbeError.record }
            captureBeganAt = ProcessInfo.processInfo.systemUptime
            stage = "verify-unlinked"
            try ownedFile.assertUnlinked()
            stage = "started"
            status = "recording"
            startTimer()
            // Wall-clock lifetime includes pauses, so repeated pause/resume cannot extend audio capture.
            let stop = DispatchWorkItem { [weak self] in self?.finishSession(reason: "timeout") }
            deadline = stop
            queue.asyncAfter(deadline: .now() + 25, execute: stop)
            emit()
        }

        private func startTimer() {
            timer?.cancel()
            let source = RecordingMetering.timer(queue: queue)
            source.setEventHandler { [weak self] in
                guard let self, status == "recording" else { return }
                do { try file?.assertUnlinked() } catch { finishSession(reason: "file-boundary"); return }
                ticks += 1
                durationMs = max(0, Int((recorder?.currentTime ?? 0) * 1000))
                emit()
            }
            timer = source
            source.resume()
        }

        @objc(pause:rejecter:)
        func pause(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            queue.async {
                guard self.status == "recording" else { reject("METERING_STATE", "Recording is not active.", nil); return }
                self.recorder?.pause()
                self.timer?.cancel()
                self.timer = nil
                self.status = "paused"
                self.emit()
                resolve(self.snapshot())
            }
        }

        @objc(resume:rejecter:)
        func resume(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
            queue.async {
                guard self.status == "paused", self.recorder?.record() == true else {
                    reject("METERING_STATE", "The paused recorder could not resume.", nil)
                    self.finishSession(reason: "resume-failed")
                    return
                }
                do { try self.file?.assertUnlinked() } catch {
                    self.finishSession(reason: "file-boundary")
                    reject("METERING_FILE_BOUNDARY", "The diagnostic file boundary failed.", nil)
                    return
                }
                self.status = "recording"
                self.startTimer()
                self.emit()
                resolve(self.snapshot())
            }
        }

        @objc(finish:rejecter:)
        func finish(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
            queue.async { self.finishSession(reason: "explicit-stop"); resolve(self.snapshot()) }
        }

        @objc(getState:rejecter:)
        func getState(_ resolve: @escaping RCTPromiseResolveBlock, rejecter _: @escaping RCTPromiseRejectBlock) {
            queue.async { resolve(self.snapshot()) }
        }

        private func finishSession(reason: String) {
            // Ending while the permission sheet is closing must not leave a future activation able to start capture.
            DispatchQueue.main.async { [weak self] in
                self?.permission?.cancel()
                self?.permission = nil
            }
            timer?.cancel()
            timer = nil
            deadline?.cancel()
            deadline = nil
            recorder?.stop()
            recorder = nil
            cleanupComplete = file?.cleanup() ?? true
            status = "completed"
            self.reason = cleanupComplete ? reason : "cleanup-failed"
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            emit()
        }

        private func snapshot() -> NSDictionary {
            ["status": status, "reason": reason, "stage": stage, "durationMs": durationMs,
             "amplitude": RecordingMetering.amplitude(recorder: recorder, recording: status == "recording"),
             "ticks": ticks, "cleanupComplete": cleanupComplete,
             "fileProtection": file?.protection ?? "unverified",
             "excludedFromBackup": file?.excludedFromBackup ?? false,
             "unlinked": file?.unlinked ?? false,
             "interruptionOrigin": interruptionOrigin,
             "interruptionType": interruptionType.map { $0 as Any } ?? NSNull()] as NSDictionary
        }

        private func emit() {
            let value = snapshot()
            DispatchQueue.main.async { [weak self] in self?.sendEvent(withName: "RecordingMeteringProbeChanged", body: value) }
        }

        func audioRecorderEncodeErrorDidOccur(_: AVAudioRecorder, error _: Error?) {
            queue.async { self.finishSession(reason: "encode-failed") }
        }
    }
#endif
