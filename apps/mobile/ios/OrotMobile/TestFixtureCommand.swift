#if OROT_TESTS && targetEnvironment(simulator)
    import Foundation

    enum TestFixtureCommand {
        /// A cold process performs the bounded operation before creating React, SQL handles, providers or an accessibility tree.
        static func runIfRequested() -> Bool {
            let arguments = ProcessInfo.processInfo.arguments
            guard let index = arguments.firstIndex(of: "--orot-fixture-command") else { return false }
            guard arguments.indices.contains(index + 2), UUID(uuidString: arguments[index + 2]) != nil else { return true }
            let action = arguments[index + 1]
            let token = arguments[index + 2]
            var receipt: [String: Any] = ["token": token, "action": action,
                                          "processIdentifier": ProcessInfo.processInfo.processIdentifier]
            do {
                receipt["before"] = try TestFixtureState.snapshot(token)
                switch action {
                case "reset": try TestFixtureState.reset(token)
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
            do {
                let folder = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
                    .appendingPathComponent("OrotFixtureReceipts", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                try JSONSerialization.data(withJSONObject: receipt).write(
                    to: folder.appendingPathComponent("\(token)-\(action).json"), options: .atomic,
                )
            } catch {
                // Absence of a receipt fails the host's bounded wait; never continue into the application after a reset failure.
                NSLog("OROT_FIXTURE_RECEIPT_FAILED %@", String(describing: error))
            }
            return true
        }
    }
#endif
