#if OROT_TESTS
    import Foundation

    /// Counts actual engine entry requests for this process. Tests cannot reset it or supply their own count.
    enum TestSpeechObservation {
        private static let lock = NSLock()
        private static var requests = 0
        private static let processInstance = UUID().uuidString

        static func recordRequest() {
            lock.lock()
            defer { lock.unlock() }
            requests += 1
        }

        static func snapshot() -> [String: Any] {
            lock.lock()
            defer { lock.unlock() }
            return ["processIdentifier": ProcessInfo.processInfo.processIdentifier,
                    "processInstance": processInstance, "speechRequests": requests]
        }
    }
#endif
