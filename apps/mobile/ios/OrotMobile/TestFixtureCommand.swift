#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation

    enum TestFixtureCommand {
        private(set) static var isolationReset: [String: Any]?

        /// The native Isolation case owns preparation and its receipt in this process, before React or a database can open.
        static func prepareIsolationIfRequested() -> Bool {
            guard let token = ProcessInfo.processInfo.environment["OROT_FIXTURE_TOKEN"] else { return true }
            guard UUID(uuidString: token) != nil,
                  ProcessInfo.processInfo.arguments.contains("-OROT_TEST_HOST") else { return false }
            do {
                try TestFixtureState.preparePreferences(token)
            } catch {
                isolationReset = ["ok": false, "error": String(describing: error)]
                return false
            }
            isolationReset = execute("reset", token: token)
            return isolationReset?["ok"] as? Bool == true
        }

        /// A cold process performs the bounded operation before creating React, SQL handles, providers or an accessibility tree.
        static func runIfRequested() -> Bool {
            let arguments = ProcessInfo.processInfo.arguments
            guard let index = arguments.firstIndex(of: "--orot-fixture-command") else { return false }
            guard arguments.indices.contains(index + 2), UUID(uuidString: arguments[index + 2]) != nil else { return true }
            let action = arguments[index + 1]
            let token = arguments[index + 2]
            let receipt = execute(action, token: token)
            do {
                let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent("OrotFixtureReceipts", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try JSONSerialization.data(withJSONObject: receipt).write(
                    to: folder.appendingPathComponent("\(token)-\(action).json"), options: .atomic,
                )
            } catch {
                // A missing receipt fails the host; never continue into React after a fixture command.
                NSLog("OROT_FIXTURE_RECEIPT_FAILED %@", String(describing: error))
            }
            return true
        }

        private static func execute(_ action: String, token: String) -> [String: Any] {
            // Native tests consume this dictionary directly; normalize the PID to the same Int used by decoded JSON receipts.
            var receipt: [String: Any] = ["token": token, "action": action,
                                          "processIdentifier": Int(ProcessInfo.processInfo.processIdentifier)]
            do {
                receipt["before"] = try TestFixtureState.snapshot(token)
                switch action {
                case "reset":
                    // Preserve bounded synthetic input evidence before clearing this owned fixture.
                    receipt["inputObservation"] = TestTextInputObservation.consume()
                    try TestFixtureState.reset(token)
                case "seed": try TestFixtureState.seedPollution(token)
                case "inspect": break
                default: throw NSError(domain: "OrotFixtureCommand", code: 1)
                }
                receipt["state"] = try TestFixtureState.snapshot(token)
                receipt["ok"] = true
            } catch {
                receipt["ok"] = false
                receipt["error"] = String(describing: error)
            }
            return receipt
        }
    }
#endif
