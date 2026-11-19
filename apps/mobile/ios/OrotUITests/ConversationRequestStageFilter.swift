import Foundation

/// Restrict synthetic diagnostic stages to native receipts from the current tap.
enum ConversationRequestStageFilter {
    static let allowed: Set<String> = ["dispatch", "dispatch-rejected", "preflight-started", "preflight-stopped", "preflight-ready", "preflight-error", "request-accepted", "request-rejected", "sender-invoked", "selection-required", "provider-configuration", "other-outcome"]
    static let terminal: Set<String> = ["dispatch-rejected", "preflight-stopped", "preflight-error", "request-rejected", "provider-configuration", "other-outcome"]

    static func stages(_ events: [[String: Any]], since tapStartedAt: Double) -> [String] {
        guard tapStartedAt.isFinite else { return [] }
        return events.compactMap { event in
            guard event["event"] as? String == "synthetic-conversation-request",
                  let received = event["receivedAtMs"] as? Double, received.isFinite, received >= tapStartedAt,
                  let stage = event["stage"] as? String, allowed.contains(stage) else { return nil }
            return stage
        }
    }
}
