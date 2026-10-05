import Foundation

enum ChatGPTResponsesRequestBuilder {
    static func build(_ input: ChatGPTResponsesRequest, accessToken: String) throws -> URLRequest {
        guard !input.model.isEmpty,
              input.model == input.model.trimmingCharacters(in: .whitespacesAndNewlines),
              !input.messages.isEmpty,
              !accessToken.isEmpty
        else {
            throw ChatGPTResponsesError.invalidRequest
        }

        var instructions = [String]()
        var messages = [Any]()
        for message in input.messages {
            switch message {
            case let .system(text): instructions.append(text)
            case let .user(text): messages.append(["role": "user", "content": text])
            case let .assistant(text): messages.append(["role": "assistant", "content": text])
            case let .functionCall(callID, name, argumentsJSON):
                guard !callID.isEmpty, !name.isEmpty,
                      Self.jsonObject(argumentsJSON) != nil
                else {
                    throw ChatGPTResponsesError.invalidRequest
                }
                messages.append([
                    "type": "function_call",
                    "call_id": callID,
                    "name": name,
                    "arguments": argumentsJSON,
                ])
            case let .functionCallOutput(callID, output):
                guard !callID.isEmpty else { throw ChatGPTResponsesError.invalidRequest }
                messages.append(["type": "function_call_output", "call_id": callID, "output": output])
            case let .continuationItem(json):
                guard let item = Self.jsonObject(json),
                      Self.isSupportedContinuationItem(item)
                else {
                    throw ChatGPTResponsesError.invalidRequest
                }
                messages.append(item)
            }
        }

        var body: [String: Any] = [
            "model": input.model,
            "input": messages,
            "include": ["reasoning.encrypted_content"],
            "store": false,
            "stream": true,
        ]
        if !input.tools.isEmpty {
            body["tools"] = try input.tools.map { tool -> [String: Any] in
                guard !tool.name.isEmpty,
                      let parameters = Self.jsonObject(tool.parametersJSON),
                      !tool.strict
                else {
                    throw ChatGPTResponsesError.invalidRequest
                }
                var definition: [String: Any] = [
                    "type": "function",
                    "name": tool.name,
                    "parameters": parameters,
                    "strict": false,
                ]
                if let description = tool.description {
                    definition["description"] = description
                }
                return definition
            }
        }
        if !instructions.isEmpty {
            body["instructions"] = instructions.joined(separator: "\n\n")
        }
        let encoded = try JSONSerialization.data(withJSONObject: body)
        guard encoded.count <= 1_048_576 else { throw ChatGPTResponsesError.invalidRequest }

        var request = URLRequest(url: URL(string: "\(ChatGPTOAuthConstants.resource)/responses")!)
        request.httpMethod = "POST"
        request.timeoutInterval = 180
        request.httpBody = encoded
        request.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        return request
    }

    private static func jsonObject(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8),
              let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        else {
            return nil
        }
        return value as? [String: Any]
    }

    private static func isSupportedContinuationItem(_ item: [String: Any]) -> Bool {
        switch item["type"] as? String {
        case "message", "reasoning":
            return true
        case "function_call":
            guard let id = item["id"] as? String, !id.isEmpty,
                  let callID = item["call_id"] as? String, !callID.isEmpty,
                  let name = item["name"] as? String, !name.isEmpty,
                  let arguments = item["arguments"] as? String else { return false }
            return jsonObject(arguments) != nil
        default:
            return false
        }
    }
}
