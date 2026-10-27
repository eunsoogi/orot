import Foundation

/// Never forward the original NSError to RN: it may contain clinical text or request metadata.
/// Ordinary builds and launches without diagnostics retain the original nil-error rejection payload.
func appointmentReminderFailureOriginCarrier() -> NSError? {
    #if OROT_TESTS
        guard let runID = AppointmentReminderDiagnosticTrace.enabledRunID,
              let sequence = AppointmentReminderDiagnosticTrace.operationSequence else { return nil }
        return AppointmentReminderFailureOrigin.carrier(runID: runID, sequence: sequence)
    #else
        return nil
    #endif
}

#if OROT_TESTS
    enum AppointmentReminderFailureOrigin {
        static var controlEnabled: Bool {
            AppointmentReminderDiagnosticTrace.enabledRunID != nil &&
                ProcessInfo.processInfo.environment["OROT_TEST_REMINDER_ORIGIN_CONTROL"] == "YES" &&
                UserDefaults.standard.string(forKey: "OROT_TEST_REMINDER_ORIGIN_CONTROL") == "YES"
        }

        private static let controlLock = NSLock()
        private static var controlOrigins: [String: [String: Any]] = [:]
        static var controlExpected: [String: [String: Any]] {
            controlLock.withLock { controlOrigins }
        }

        /// Fail inside the actual bridge's existing catch, before any OS mutation. This ensures
        /// the control falsifies an omitted carrier at that catch, not just an observer endpoint.
        static func failControlReplaceIfEnabled() throws {
            guard controlEnabled else { return }
            if let runID = AppointmentReminderDiagnosticTrace.enabledRunID,
               let sequence = AppointmentReminderDiagnosticTrace.operationSequence
            {
                controlLock.withLock {
                    let roles = ["selected", "cleanup", "reconcile", "reconcile-cleanup"]
                    guard controlOrigins.count < roles.count else { return }
                    controlOrigins[roles[controlOrigins.count]] = ["runID": runID, "operationSequence": sequence]
                }
            }
            throw NSError(domain: "private-control-sentinel", code: 47, userInfo: [
                NSLocalizedDescriptionKey: "private-control-text", "private-control-key": "private-control-value",
            ])
        }

        /// The carrier contains only opaque correlation fields, with no underlying error reference.
        static func carrier(runID: String, sequence: Int) -> NSError {
            NSError(domain: "OrotReminderDiagnosticOrigin", code: 0, userInfo: [
                "orotReminderOrigin": ["runID": runID, "operationSequence": sequence],
            ])
        }
    }
#endif
