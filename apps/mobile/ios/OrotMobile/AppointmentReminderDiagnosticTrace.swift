#if OROT_TESTS
    import Foundation

    /// Test-only trace fields stay allowlisted; request metadata and NSError userInfo never enter the file.
    enum AppointmentReminderDiagnosticTrace {
        enum OwnErrorCase: String, Codable {
            case invalidInput
            case permissionDenied
            case expired
            case other
        }

        enum ErrorDomain: String, Codable {
            case userNotifications = "UNErrorDomain"
            case cocoa = "NSCocoaErrorDomain"
            case posix = "NSPOSIXErrorDomain"
            case url = "NSURLErrorDomain"
            case other

            init(domain: String) {
                self = Self(rawValue: domain) ?? .other
            }
        }

        struct Event: Encodable {
            let runID: String
            let processID: Int32
            let callSequence: Int
            let operationSequence: Int?
            let monotonicNanoseconds: String
            let stage: AppointmentReminderDiagnosticStage
            let nullPlan: Bool?
            let authorization: AppointmentReminderDiagnosticAuthorization?
            let ownErrorCase: OwnErrorCase?
            let errorDomain: ErrorDomain?
            let errorCode: Int?

            init(
                runID: String,
                processID: Int32,
                callSequence: Int,
                monotonicNanoseconds: String,
                stage: AppointmentReminderDiagnosticStage,
                operationSequence: Int? = nil,
                nullPlan: Bool? = nil,
                authorization: AppointmentReminderDiagnosticAuthorization? = nil,
                error: Error? = nil,
            ) {
                self.runID = runID
                self.processID = processID
                self.callSequence = callSequence
                self.monotonicNanoseconds = monotonicNanoseconds
                self.stage = stage
                self.operationSequence = operationSequence
                self.nullPlan = nullPlan
                self.authorization = authorization
                if let error {
                    let nativeError = error as NSError
                    errorDomain = ErrorDomain(domain: nativeError.domain)
                    errorCode = nativeError.code
                    switch error as? AppointmentReminderError {
                    case .invalidInput: ownErrorCase = .invalidInput
                    case .permissionDenied: ownErrorCase = .permissionDenied
                    case .expired: ownErrorCase = .expired
                    case nil: ownErrorCase = .other
                    }
                } else {
                    errorDomain = nil
                    errorCode = nil
                    ownErrorCase = nil
                }
            }

            func jsonLine() throws -> Data {
                let encoder = JSONEncoder()
                encoder.outputFormatting = [.sortedKeys]
                var data = try encoder.encode(self)
                data.append(0x0A)
                return data
            }
        }

        private static let fileName = "appointment-reminder-diagnostic.jsonl"
        private static let maximumBytes = 64 * 1024
        private static let lock = NSLock()
        private static var callSequence = 0
        private static var nextOperation = 0
        private static var writerFailed = false
        private static var healthSequence = 0
        @TaskLocal static var operationSequence: Int?

        /// Child Tasks inherit this opaque bridge invocation; it is not a link to a JS action.
        static func withOperation(_ operation: () async -> Void) async {
            guard enabledRunID != nil else { await operation(); return }
            let sequence = lock.withLock { nextOperation += 1; return nextOperation }
            await $operationSequence.withValue(sequence, operation: operation)
        }

        private static var enabledRunID: String? {
            let environment = ProcessInfo.processInfo.environment
            guard environment["OROT_TEST_REMINDER_DIAGNOSTICS"] == "YES",
                  let runID = environment["OROT_TEST_REMINDER_DIAGNOSTIC_RUN_ID"],
                  UUID(uuidString: runID) != nil
            else { return nil }
            return runID.lowercased()
        }

        private static var fileURL: URL? {
            FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first?
                .appendingPathComponent(fileName)
        }

        /// Observe the original add exactly once; recording a rejection never replaces its error identity.
        static func aroundAdd(
            emit: (AppointmentReminderDiagnosticStage, Error?) -> Void = { stage, error in record(stage, error: error) },
            enabled: Bool? = nil,
            operation: () async throws -> Void,
        ) async throws {
            guard enabled ?? (enabledRunID != nil) else {
                try await operation()
                return
            }
            emit(.centerAddEnter, nil)
            do {
                try await operation()
                emit(.centerAddResolve, nil)
            } catch {
                emit(.centerAddReject, error)
                throw error
            }
        }

        @discardableResult
        static func record(
            _ stage: AppointmentReminderDiagnosticStage,
            nullPlan: Bool? = nil,
            authorization: AppointmentReminderDiagnosticAuthorization? = nil,
            error: Error? = nil,
        ) -> Bool {
            guard let runID = enabledRunID, let url = fileURL else { return false }
            return lock.withLock {
                var wrote = false
                defer {
                    if !wrote {
                        writerFailed = true
                    }
                }
                let nextSequence = callSequence + 1
                let event = Event(
                    runID: runID,
                    processID: ProcessInfo.processInfo.processIdentifier,
                    callSequence: nextSequence,
                    monotonicNanoseconds: String(DispatchTime.now().uptimeNanoseconds),
                    stage: stage,
                    operationSequence: operationSequence,
                    nullPlan: nullPlan,
                    authorization: authorization,
                    error: error,
                )
                guard let data = try? event.jsonLine(), data.count <= maximumBytes else { return false }
                let manager = FileManager.default
                if !manager.fileExists(atPath: url.path),
                   !manager.createFile(atPath: url.path, contents: Data(), attributes: nil)
                {
                    return false
                }
                guard let attributes = try? manager.attributesOfItem(atPath: url.path),
                      let size = attributes[.size] as? NSNumber,
                      size.intValue + data.count <= maximumBytes
                else { return false }
                do {
                    let handle = try FileHandle(forWritingTo: url)
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
                    try handle.synchronize()
                    try handle.close()
                    callSequence = nextSequence
                    wrote = true
                    return true
                } catch {
                    return false
                }
            }
        }

        /// One process performs one write/readback through the same bounded writer and file.
        /// Gate and I/O failures expose a fixed status, never environment values or file errors.
        static let readiness: [String: Any] = {
            let environment = ProcessInfo.processInfo.environment
            var receipt: [String: Any] = [
                "status": "disabled", "processID": ProcessInfo.processInfo.processIdentifier,
                "monotonicNanoseconds": String(DispatchTime.now().uptimeNanoseconds),
                "sequence": 0,
            ]
            guard environment["OROT_TEST_REMINDER_DIAGNOSTICS"] == "YES" else { return receipt }
            guard let runID = enabledRunID else {
                receipt["status"] = "invalid-run-id"
                return receipt
            }
            receipt["runID"] = runID
            guard record(.diagnosticReady) else {
                receipt["status"] = "write-failed"
                return receipt
            }
            receipt["status"] = "readback-failed"
            return lock.withLock {
                guard let url = fileURL, let data = try? Data(contentsOf: url),
                      data.count <= maximumBytes, data.last == 0x0A,
                      let line = data.split(separator: 0x0A).last,
                      let value = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                      value["runID"] as? String == runID,
                      value["stage"] as? String == "diagnostic-ready",
                      value["processID"] as? Int32 == ProcessInfo.processInfo.processIdentifier,
                      value["callSequence"] as? Int == callSequence
                else { return receipt }
                receipt["status"] = "ready"
                receipt["sequence"] = callSequence
                return receipt
            }
        }()

        /// Readiness is a handshake, while later capacity/I/O failure remains a sticky diagnostic state.
        static func currentReadiness() -> [String: Any] {
            let initial = readiness
            return lock.withLock {
                var value = initial
                healthSequence += 1
                value["healthSequence"] = healthSequence
                if writerFailed {
                    value["status"] = "writer-failed"
                }
                return value
            }
        }
    }

#endif
