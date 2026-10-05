import Foundation

public enum ChatGPTResponsesRequestDecoder {
    public static func decode(_ payload: NSDictionary) throws -> ChatGPTResponsesRequest {
        guard let value = payload as? [String: Any],
              let model = value["model"] as? String,
              let rawMessages = value["messages"] as? [[String: Any]],
              !rawMessages.isEmpty else { throw ChatGPTResponsesError.invalidRequest }

        let messages = try rawMessages.map { message -> ChatGPTResponsesMessage in
            if let type = message["type"] as? String {
                switch type {
                case "function_call":
                    guard let callID = message["callID"] as? String,
                          let name = message["name"] as? String,
                          let arguments = message["arguments"] as? String
                    else {
                        throw ChatGPTResponsesError.invalidRequest
                    }
                    return .functionCall(callID: callID, name: name, argumentsJSON: arguments)
                case "function_call_output":
                    guard let callID = message["callID"] as? String,
                          let output = message["output"] as? String
                    else {
                        throw ChatGPTResponsesError.invalidRequest
                    }
                    return .functionCallOutput(callID: callID, output: output)
                case "continuation_item":
                    guard let json = message["json"] as? String else {
                        throw ChatGPTResponsesError.invalidRequest
                    }
                    return .continuationItem(json: json)
                default:
                    throw ChatGPTResponsesError.unsupportedCapability("hosted tools")
                }
            }

            guard let role = message["role"] as? String,
                  let content = message["content"] as? String
            else {
                throw ChatGPTResponsesError.invalidRequest
            }
            switch role {
            case "system": return .system(content)
            case "user": return .user(content)
            case "assistant": return .assistant(content)
            default: throw ChatGPTResponsesError.invalidRequest
            }
        }

        let rawTools = value["tools"] as? [[String: Any]] ?? []
        if value["tools"] != nil, !(value["tools"] is [[String: Any]]) {
            throw ChatGPTResponsesError.invalidRequest
        }
        let tools = try rawTools.map { tool -> ChatGPTResponsesToolDefinition in
            guard let type = tool["type"] as? String else { throw ChatGPTResponsesError.invalidRequest }
            guard type == "function" else { throw ChatGPTResponsesError.unsupportedCapability("hosted tools") }
            guard let name = tool["name"] as? String,
                  let parameters = tool["parameters"] as? [String: Any],
                  let strict = tool["strict"] as? Bool,
                  strict == false,
                  let parameterData = try? JSONSerialization.data(withJSONObject: parameters, options: [.sortedKeys]),
                  let parametersJSON = String(data: parameterData, encoding: .utf8)
            else {
                throw ChatGPTResponsesError.invalidRequest
            }
            let description = tool["description"] as? String
            if tool["description"] != nil, description == nil {
                throw ChatGPTResponsesError.invalidRequest
            }
            return ChatGPTResponsesToolDefinition(
                name: name,
                description: description,
                parametersJSON: parametersJSON,
                strict: strict,
            )
        }
        return ChatGPTResponsesRequest(model: model, messages: messages, tools: tools)
    }
}
