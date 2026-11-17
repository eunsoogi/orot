import Foundation

public enum ChatGPTSteerableEvent: Equatable, Sendable {
    case ready
    case response(ChatGPTResponsesEvent)
    case textSnapshot(String)
    case steering(submissionID: String, status: String, steerID: String?)
}

/// One connection owns one initial response and at most one automatic successor.
/// Acceptance is not application; tools are never run or replayed by this transport.
struct ResponsesSteeringState {
    private var activeID: String?
    private var targetID: String?
    private var submissionID: String?
    private var steerID: String?
    private var accepted = false
    private var submissionUsed = false
    private var successor = false
    private var predecessorEnded = false
    private var originalResult: ChatGPTResponsesResult?
    private var normalizer = ResponsesEventNormalizer(requestID: nil)
    private var originalUsage: ChatGPTResponsesUsage?
    private(set) var finished = false

    mutating func prepareSteer(submissionID: String, text: String) throws -> Data {
        guard !finished, let activeID, !submissionUsed,
              !submissionID.isEmpty, submissionID.utf8.count <= 128,
              !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              text.utf8.count <= 16384
        else { throw ChatGPTResponsesError.invalidRequest }
        self.submissionID = submissionID
        submissionUsed = true
        targetID = activeID
        return try JSONSerialization.data(withJSONObject: [
            "type": "response.steer", "previous_response_id": activeID, "input": text,
        ])
    }

    mutating func consume(_ data: Data) throws -> [ChatGPTSteerableEvent] {
        guard !finished, data.count <= 1_048_576,
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String,
              let text = String(data: data, encoding: .utf8)
        else { throw ResponsesMalformedDiagnostics.failure(.steeringFrameShape) }
        if type == "response.created" {
            guard let response = object["response"] as? [String: Any],
                  let id = response["id"] as? String, !id.isEmpty else { throw ResponsesMalformedDiagnostics.failure(.steeringCreatedIdentity) }
            if activeID == nil {
                let started = try normalizer.consume(ResponsesSSEFrame(event: nil, data: text))
                activeID = id
                return [.ready] + (started.map { [.response($0)] } ?? [])
            }
            guard accepted, predecessorEnded, !successor, id != activeID else { throw ResponsesMalformedDiagnostics.failure(.steeringSuccessorOrder) }
            if let previous = response["previous_response_id"] as? String, previous != targetID {
                throw ResponsesMalformedDiagnostics.failure(.steeringPredecessorIdentity)
            }
            successor = true
            activeID = id
            normalizer = ResponsesEventNormalizer(requestID: nil)
            _ = try normalizer.consume(ResponsesSSEFrame(event: nil, data: text))
            return [.steering(submissionID: submissionID!, status: "applied", steerID: steerID), .textSnapshot("")]
        }
        if type.hasPrefix("response.steer.") {
            return try steeringEvent(object, type: type)
        }
        guard activeID != nil || type == "codex.response.metadata" else {
            throw ResponsesSteeringDiagnostics.beforeActiveFailure(object, type: type)
        }
        if let id = object["response_id"] as? String, id != activeID {
            throw ResponsesMalformedDiagnostics.failure(.steeringResponseIdentity)
        }
        if let response = object["response"] as? [String: Any], let id = response["id"] as? String, id != activeID {
            throw ResponsesMalformedDiagnostics.failure(.steeringNestedIdentity)
        }
        // The public Codex WebSocket client treats this exact event as connection
        // metadata, not response creation. Reuse refusal and identity validation,
        // but do not expose headers, bind readiness, execute tools or retain state.
        if type == "codex.response.metadata" {
            try normalizer.validateConnectionMetadata(object)
            return []
        }
        if type == "response.incomplete", let response = object["response"] as? [String: Any],
           let detail = response["incomplete_details"] as? [String: Any], detail["reason"] as? String == "steered"
        {
            guard submissionID != nil, !successor else { throw ResponsesMalformedDiagnostics.failure(.steeringIncompleteOrder) }
            predecessorEnded = true
            originalUsage = try ChatGPTResponsesUsage.decode(response["usage"])
            return []
        }
        guard let event = try normalizer.consume(ResponsesSSEFrame(event: nil, data: text)) else { return [] }
        if case let .completed(result) = event {
            if submissionID != nil, !successor {
                predecessorEnded = true
                originalResult = result
                originalUsage = result.usage
                // Await acceptance/failure or pending, even if completion raced the steer acknowledgement.
                return []
            }
            finished = true
            return try [.response(.completed(combinedUsage(result)))]
        }
        if case .toolCall = event {
            return []
        } // Tools are released only with the validated terminal result.
        return [.response(event)]
    }

    private mutating func steeringEvent(_ object: [String: Any], type: String) throws -> [ChatGPTSteerableEvent] {
        guard let submissionID, let targetID,
              let steer = object["steer"] as? [String: Any],
              steer["previous_response_id"] as? String == targetID,
              let id = steer["id"] as? String, !id.isEmpty,
              steerID == nil || steerID == id else { throw ResponsesMalformedDiagnostics.failure(.steeringAcknowledgmentIdentity) }
        steerID = id
        switch type {
        case "response.steer.accepted":
            guard !accepted else { throw ResponsesMalformedDiagnostics.failure(.steeringDuplicateAccepted) }
            accepted = true
            return [.steering(submissionID: submissionID, status: "accepted", steerID: id)]
        case "response.steer.pending":
            guard accepted, !successor, let result = originalResult else { throw ResponsesMalformedDiagnostics.failure(.steeringPendingOrder) }
            // The graph owns tool/approval execution. Closing this socket cannot preserve pending steering.
            finished = true
            return [.steering(submissionID: submissionID, status: "pending", steerID: id), .response(.completed(result))]
        case "response.steer.failed":
            guard !successor else { throw ResponsesMalformedDiagnostics.failure(.steeringFailureOrder) }
            var events: [ChatGPTSteerableEvent] = [.steering(submissionID: submissionID, status: "failed", steerID: id)]
            if let result = originalResult {
                finished = true; events.append(.response(.completed(result)))
            } else {
                self.submissionID = nil; targetIDReset()
            }
            return events
        default: throw ResponsesMalformedDiagnostics.failure(.steeringUnknownEvent)
        }
    }

    private mutating func targetIDReset() {
        targetID = nil
        accepted = false
        // A failed steer still consumes the single transport submission allowance.
        submissionID = nil
    }

    private func combinedUsage(_ result: ChatGPTResponsesResult) throws -> ChatGPTResponsesResult {
        guard let originalUsage, let usage = result.usage else { return result }
        let input = originalUsage.inputTokens + usage.inputTokens
        let output = originalUsage.outputTokens + usage.outputTokens
        let total = originalUsage.totalTokens + usage.totalTokens
        guard max(input, output, total) <= 9_007_199_254_740_991 else { throw ResponsesMalformedDiagnostics.failure(.steeringUsageSum) }
        return ChatGPTResponsesResult(text: result.text, toolCalls: result.toolCalls,
                                      continuationItems: result.continuationItems, webSearch: result.webSearch,
                                      usage: ChatGPTResponsesUsage(inputTokens: input, outputTokens: output, totalTokens: total))
    }
}
