import Foundation

/// Simulator-only opt-in lifecycle evidence. Never log prompts, arguments, results,
/// credentials, or source content; correlation IDs below belong to the bridge, not the SDK.
enum AppleNativeToolTrace {
    static func record(_ event: String, generation: AppleNativeToolGeneration, bytes: Int? = nil) {
        #if targetEnvironment(simulator)
            guard ProcessInfo.processInfo.arguments.contains("-OROT_NATIVE_TOOL_TRACE") else { return }
            var value: [String: Any] = [
                "event": event, "requestId": generation.requestId,
                "bridgeCallId": generation.callId, "identityOrigin": "bridge",
                "sdkCallId": "unavailable", "time": Date().timeIntervalSince1970,
            ]
            if let bytes {
                value["bytes"] = bytes
            }
            guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
                  let text = String(data: data, encoding: .utf8) else { return }
            NSLog("[OROT_NATIVE_TOOL] %@", text)
        #endif
    }
}
