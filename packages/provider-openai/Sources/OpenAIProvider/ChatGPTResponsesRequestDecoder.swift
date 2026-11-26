import Foundation

public enum ChatGPTResponsesRequestDecoder {
    /// Documented image-input models only. A listed model still needs the account's
    /// direct Plan grant and can be refused by the service; do not infer from suffixes.
    public static func supportsDirectPhotoModel(_ model: String) -> Bool {
        ["gpt-6.2-sol", "gpt-6.2-astra"].contains(model)
    }

    /// Limit encoded input before allocating decoded data; the builder also validates JPEG framing.
    private static func decodePhoto(_ base64: String) throws -> Data {
        guard base64.utf8.count <= 4 * ((2 * 1024 * 1024 + 2) / 3),
              let jpeg = Data(base64Encoded: base64),
              jpeg.count <= 2 * 1024 * 1024
        else { throw ResponsesRequestValidationDiagnostics.failure(.messageShape) }
        return jpeg
    }

    public static func decode(_ payload: NSDictionary, allowDirectPhoto: Bool = false) throws -> ChatGPTResponsesRequest {
        guard let value = payload as? [String: Any],
              let model = value["model"] as? String else { throw ResponsesRequestValidationDiagnostics.failure(.decoderEnvelope) }
        // The dedicated image entry accepts only an exact image envelope; the
        // ordinary text/steering/public-search entry never accepts that field.
        if allowDirectPhoto {
            guard supportsDirectPhotoModel(model), Set(value.keys) == ["model", "directPhoto"],
                  let photo = value["directPhoto"] as? [String: Any],
                  let question = photo["text"] as? String, question.utf16.count <= 4000
            else { throw ResponsesRequestValidationDiagnostics.failure(.messageShape) }
            if Set(photo.keys) == ["text", "jpegBase64"], let base64 = photo["jpegBase64"] as? String {
                return try ChatGPTResponsesRequest(model: model, messages: [.userPhoto(text: question, normalizedJPEG: decodePhoto(base64))])
            }
            guard Set(photo.keys) == ["text", "jpegBase64s"],
                  let encoded = photo["jpegBase64s"] as? [String], (2 ... 3).contains(encoded.count)
            else { throw ResponsesRequestValidationDiagnostics.failure(.messageShape) }
            let images = try encoded.map(decodePhoto)
            guard images.reduce(0, { $0 + $1.count }) <= 4 * 1024 * 1024
            else { throw ResponsesRequestValidationDiagnostics.failure(.messageShape) }
            return ChatGPTResponsesRequest(model: model, messages: [.userPhotoGroup(text: question, normalizedJPEGs: images)])
        }
        guard value["directPhoto"] == nil else { throw ResponsesRequestValidationDiagnostics.failure(.messageShape) }
        // Public searches have no conversation/history channel, even if a caller adds one.
        if value["publicWebQuery"] != nil {
            guard Set(value.keys) == ["model", "publicWebQuery"],
                  let query = value["publicWebQuery"] as? String,
                  ResponsesPublicWebSearch.validQuery(query)
            else { throw ResponsesRequestValidationDiagnostics.failure(.publicSearchEnvelope) }
            return ChatGPTResponsesRequest(model: model, messages: [], publicWebQuery: query)
        }
        guard
            let rawMessages = value["messages"] as? [[String: Any]],
            !rawMessages.isEmpty else { throw ResponsesRequestValidationDiagnostics.failure(.messageList) }

        let messages = try rawMessages.map { message -> ChatGPTResponsesMessage in
            if let type = message["type"] as? String {
                switch type {
                case "function_call":
                    guard let callID = message["callID"] as? String,
                          let name = message["name"] as? String,
                          let arguments = message["arguments"] as? String
                    else {
                        throw ResponsesRequestValidationDiagnostics.failure(.functionCall)
                    }
                    return .functionCall(callID: callID, name: name, argumentsJSON: arguments)
                case "function_call_output":
                    guard let callID = message["callID"] as? String,
                          let output = message["output"] as? String
                    else {
                        throw ResponsesRequestValidationDiagnostics.failure(.functionOutput)
                    }
                    return .functionCallOutput(callID: callID, output: output)
                case "continuation_item":
                    guard let json = message["json"] as? String else {
                        throw ResponsesRequestValidationDiagnostics.failure(.continuationItem)
                    }
                    return .continuationItem(json: json)
                default:
                    throw ChatGPTResponsesError.unsupportedCapability("hosted tools")
                }
            }

            guard let role = message["role"] as? String,
                  let content = message["content"] as? String
            else {
                throw ResponsesRequestValidationDiagnostics.failure(.messageShape)
            }
            switch role {
            case "system": return .system(content)
            case "user": return .user(content)
            case "assistant": return .assistant(content)
            default: throw ResponsesRequestValidationDiagnostics.failure(.messageRole)
            }
        }

        let rawTools = value["tools"] as? [[String: Any]] ?? []
        if value["tools"] != nil, !(value["tools"] is [[String: Any]]) {
            throw ResponsesRequestValidationDiagnostics.failure(.toolList)
        }
        let tools = try rawTools.map { tool -> ChatGPTResponsesToolDefinition in
            guard let type = tool["type"] as? String else { throw ResponsesRequestValidationDiagnostics.failure(.toolDefinition) }
            guard type == "function" else { throw ChatGPTResponsesError.unsupportedCapability("hosted tools") }
            guard let name = tool["name"] as? String,
                  let parameters = tool["parameters"] as? [String: Any],
                  let strict = tool["strict"] as? Bool,
                  strict == false,
                  let parameterData = try? JSONSerialization.data(withJSONObject: parameters, options: [.sortedKeys]),
                  let parametersJSON = String(data: parameterData, encoding: .utf8)
            else {
                throw ResponsesRequestValidationDiagnostics.failure(.toolDefinition)
            }
            let description = tool["description"] as? String
            if tool["description"] != nil, description == nil {
                throw ResponsesRequestValidationDiagnostics.failure(.toolDescription)
            }
            return ChatGPTResponsesToolDefinition(
                name: name,
                description: description,
                parametersJSON: parametersJSON,
                strict: strict,
            )
        }
        let toolChoice = value["toolChoice"] as? String
        if value["toolChoice"] != nil, toolChoice != "required" || tools.isEmpty {
            throw ResponsesRequestValidationDiagnostics.failure(.toolChoice)
        }
        let scope = value["transportScope"] as? String
        if value["transportScope"] != nil,
           scope == nil || scope!.isEmpty || scope!.utf8.count > 128 || scope!.contains(where: { !$0.isASCII || $0.isWhitespace })
        {
            throw ResponsesRequestValidationDiagnostics.failure(.transportScope)
        }
        return ChatGPTResponsesRequest(model: model, messages: messages, tools: tools, toolChoice: toolChoice, transportScope: scope)
    }
}
