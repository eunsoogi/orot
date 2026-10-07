import Foundation

struct ResponsesEventNormalizer {
    private struct FunctionCallState {
        let callID: String
        let name: String
        var arguments: String
    }

    let requestID: String?
    private(set) var accumulatedText = ""
    private(set) var completed = false
    private var functionCallsByItemID = [String: FunctionCallState]()
    private var emittedFunctionCalls = [String: ChatGPTResponsesFunctionCall]()

    /// Creates a normalizer while preserving the request identifier for diagnostics.
    ///
    /// Private stream state makes the synthesized memberwise initializer private.
    init(requestID: String?) {
        self.requestID = requestID
    }

    mutating func consume(_ frame: ResponsesSSEFrame) throws -> ChatGPTResponsesEvent? {
        guard !completed else { return nil }
        if frame.data == "[DONE]" {
            return nil
        }
        guard let data = frame.data.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String ?? frame.event
        else {
            throw ChatGPTResponsesError.malformedEvent
        }
        if let frameEvent = frame.event, frameEvent != type {
            throw ChatGPTResponsesError.malformedEvent
        }

        switch type {
        case "response.output_text.delta", "response.refusal.delta":
            guard let delta = object["delta"] as? String else { throw ChatGPTResponsesError.malformedEvent }
            accumulatedText.append(delta)
            return delta.isEmpty ? nil : .textDelta(delta)
        case "response.output_item.added":
            try recordFunctionCallItem(object["item"] as? [String: Any])
            return nil
        case "response.function_call_arguments.delta":
            guard let itemID = object["item_id"] as? String,
                  let delta = object["delta"] as? String,
                  var call = functionCallsByItemID[itemID]
            else {
                throw ChatGPTResponsesError.malformedEvent
            }
            call.arguments.append(delta)
            functionCallsByItemID[itemID] = call
            return nil
        case "response.function_call_arguments.done":
            guard let itemID = object["item_id"] as? String,
                  let arguments = object["arguments"] as? String,
                  var call = functionCallsByItemID[itemID],
                  call.arguments.isEmpty || call.arguments == arguments,
                  Self.isJSONObject(arguments)
            else {
                throw ChatGPTResponsesError.malformedEvent
            }
            call.arguments = arguments
            functionCallsByItemID[itemID] = call
            let normalized = ChatGPTResponsesFunctionCall(id: call.callID, name: call.name, argumentsJSON: arguments)
            guard emittedFunctionCalls[call.callID] == nil else { throw ChatGPTResponsesError.malformedEvent }
            emittedFunctionCalls[call.callID] = normalized
            return .toolCall(normalized)
        case "response.completed":
            guard let response = object["response"] as? [String: Any],
                  response["status"] as? String == "completed"
            else {
                throw ChatGPTResponsesError.malformedEvent
            }
            let finalText = try Self.responseText(response, fallback: accumulatedText)
            guard finalText == accumulatedText else { throw ChatGPTResponsesError.malformedEvent }
            let output = try Self.responseOutput(response)
            let functionCalls = try Self.functionCalls(in: output)
            guard Self.emittedCallsMatch(emittedFunctionCalls, final: functionCalls),
                  Self.functionCallItemsMatch(functionCallsByItemID, final: functionCalls)
            else {
                throw ChatGPTResponsesError.malformedEvent
            }
            // Keep opaque provider context that cannot be reconstructed from normalized calls.
            let continuationItems = try output.map(Self.serialize)
            completed = true
            return .completed(ChatGPTResponsesResult(
                text: finalText,
                toolCalls: functionCalls,
                continuationItems: continuationItems,
            ))
        case "response.incomplete":
            let response = object["response"] as? [String: Any]
            let details = response?["incomplete_details"] as? [String: Any]
            throw ChatGPTResponsesError.incomplete(
                ChatGPTResponsesDiagnostics(requestID: requestID, reason: details?["reason"] as? String),
            )
        case "response.failed", "error":
            let response = object["response"] as? [String: Any]
            let error = (response?["error"] as? [String: Any]) ?? (object["error"] as? [String: Any])
            let code = error?["code"] as? String ?? (type == "error" ? object["code"] as? String : nil)
            let parameter = error?["param"] as? String ?? (type == "error" ? object["param"] as? String : nil)
            throw ChatGPTResponsesError.responseFailure(
                ChatGPTResponsesDiagnostics(
                    bodyShape: error == nil ? "error_event" : "error_object",
                    code: code,
                    parameter: parameter,
                    requestID: requestID,
                ),
            )
        default:
            return nil
        }
    }

    private mutating func recordFunctionCallItem(_ item: [String: Any]?) throws {
        guard let item, let type = item["type"] as? String else { throw ChatGPTResponsesError.malformedEvent }
        switch type {
        case "message", "reasoning":
            return
        case "function_call":
            guard let itemID = item["id"] as? String, !itemID.isEmpty,
                  let callID = item["call_id"] as? String, !callID.isEmpty,
                  let name = item["name"] as? String, !name.isEmpty,
                  let arguments = item["arguments"] as? String,
                  functionCallsByItemID[itemID] == nil,
                  !functionCallsByItemID.values.contains(where: { $0.callID == callID })
            else {
                throw ChatGPTResponsesError.malformedEvent
            }
            functionCallsByItemID[itemID] = FunctionCallState(callID: callID, name: name, arguments: arguments)
        default:
            throw ChatGPTResponsesError.unsupportedCapability("hosted tools")
        }
    }

    private static func responseOutput(_ response: [String: Any]) throws -> [[String: Any]] {
        guard let rawOutput = response["output"] else { return [] }
        guard let output = rawOutput as? [[String: Any]] else { throw ChatGPTResponsesError.malformedEvent }
        for item in output {
            guard let type = item["type"] as? String else { throw ChatGPTResponsesError.malformedEvent }
            guard ["function_call", "message", "reasoning"].contains(type) else {
                throw ChatGPTResponsesError.unsupportedCapability("hosted tools")
            }
        }
        return output
    }

    private static func functionCalls(in output: [[String: Any]]) throws -> [ChatGPTResponsesFunctionCall] {
        var calls = [ChatGPTResponsesFunctionCall]()
        var seen = Set<String>()
        for item in output where item["type"] as? String == "function_call" {
            guard let itemID = item["id"] as? String, !itemID.isEmpty,
                  let callID = item["call_id"] as? String, !callID.isEmpty,
                  let name = item["name"] as? String, !name.isEmpty,
                  let arguments = item["arguments"] as? String,
                  isJSONObject(arguments), seen.insert(callID).inserted
            else {
                throw ChatGPTResponsesError.malformedEvent
            }
            calls.append(ChatGPTResponsesFunctionCall(id: callID, name: name, argumentsJSON: arguments))
        }
        return calls
    }

    private static func emittedCallsMatch(
        _ emitted: [String: ChatGPTResponsesFunctionCall],
        final: [ChatGPTResponsesFunctionCall],
    ) -> Bool {
        guard emitted.count <= final.count else { return false }
        return emitted.values.allSatisfy { call in final.contains(call) }
    }

    private static func functionCallItemsMatch(
        _ items: [String: FunctionCallState],
        final: [ChatGPTResponsesFunctionCall],
    ) -> Bool {
        guard items.count <= final.count else { return false }
        return items.values.allSatisfy { item in
            guard let call = final.first(where: { $0.id == item.callID }) else { return false }
            return item.name == call.name && (item.arguments.isEmpty || item.arguments == call.argumentsJSON)
        }
    }

    private static func responseText(_ response: [String: Any], fallback: String) throws -> String {
        if let outputText = response["output_text"] as? String {
            return outputText
        }
        guard let output = response["output"] as? [[String: Any]] else { return fallback }

        var parts = [String]()
        for item in output {
            guard let content = item["content"] as? [[String: Any]] else { continue }
            for part in content {
                if part["type"] as? String == "output_text", let text = part["text"] as? String {
                    parts.append(text)
                } else if part["type"] as? String == "refusal", let refusal = part["refusal"] as? String {
                    parts.append(refusal)
                }
            }
        }
        return parts.joined()
    }

    private static func isJSONObject(_ json: String) -> Bool {
        guard let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else { return false }
        return value is [String: Any]
    }

    private static func serialize(_ item: [String: Any]) throws -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: item, options: [.sortedKeys]),
              let value = String(data: data, encoding: .utf8)
        else {
            throw ChatGPTResponsesError.malformedEvent
        }
        return value
    }
}
