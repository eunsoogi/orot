import Foundation

#if OROT_TESTS && targetEnvironment(simulator)
    /// Content-free, bounded test receipts use the same monotonic clock as UIKit and SQLite.
    enum ActiveTabBoundaryObservation {
        private static let lock = NSLock()
        private static var events: [[String: String]] = []
        private static var overflow = false
        private static let allowed: Set<String> = [
            "overview-read-requested", "overview-direct-requested", "overview-direct-settled",
            "overview-requested", "overview-admitted", "overview-settled-ok", "overview-settled-failed",
            "overview-load-ok", "overview-load-failed", "overview-injected-failure",
            "records-direct-requested", "records-direct-settled",
            "appointments-direct-requested", "appointments-direct-settled",
        ]

        static func record(_ event: String) -> String {
            let parts = event.split(separator: ":", omittingEmptySubsequences: false)
            guard parts.count == 2, let operation = UInt64(parts[1]), operation > 0,
                  UserDefaults.standard.string(forKey: "OROT_TEST_SCENARIO") == "active-tab-workload",
                  let run = UserDefaults.standard.string(forKey: "OROT_WORKLOAD_SESSION"), UUID(uuidString: run) != nil,
                  allowed.contains(String(parts[0])) else { return "unavailable" }
            let tick = String(mach_absolute_time())
            lock.lock()
            defer { lock.unlock() }
            if events.count < 1024 {
                events.append(["run": run.lowercased(), "event": String(parts[0]), "operation": String(operation), "tick": tick])
            } else {
                overflow = true
            }
            return tick
        }

        static func snapshot() -> [String: Any] {
            lock.lock()
            defer { lock.unlock() }
            return ["events": events, "overflow": overflow]
        }
    }
#endif
