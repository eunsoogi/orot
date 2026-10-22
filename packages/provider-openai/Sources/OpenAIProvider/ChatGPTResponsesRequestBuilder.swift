import Foundation

enum ChatGPTResponsesRequestBuilder {
    static func build(_ input: ChatGPTResponsesRequest, accessToken: String) throws -> URLRequest {
        guard !input.model.isEmpty,
              input.model == input.model.trimmingCharacters(in: .whitespacesAndNewlines),
              !input.messages.isEmpty || input.publicWebQuery != nil,
              !accessToken.isEmpty
        else {
            throw ChatGPTResponsesError.invalidRequest
        }

        var instructions = [String]()
        var messages = [Any]()
        var inputMessages = input.messages
        if let query = input.publicWebQuery {
            guard inputMessages.isEmpty, input.tools.isEmpty, input.toolChoice == nil,
                  ResponsesPublicWebSearch.validQuery(query)
            else { throw ChatGPTResponsesError.invalidRequest }
            // This request contains only the explicitly reviewed public query. Never replay
            // private model messages, function results or opaque provider continuation items.
            inputMessages = [
                .system("Search public web sources and explain the findings concisely in Korean. Use at most two hosted web calls and cite sources for factual claims. Cite at most six sources and write at most 1500 characters. Do not diagnose an individual."),
                .user(query),
            ]
        }
        for message in inputMessages {
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
        if input.publicWebQuery != nil {
            body["tools"] = [["type": "web_search", "search_context_size": "low"]]
            body["tool_choice"] = "required"
        }
        // Preserve explicit first-search selection across the native HTTP boundary.
        if let choice = input.toolChoice {
            guard choice == "required", !input.tools.isEmpty else { throw ChatGPTResponsesError.invalidRequest }
            body["tool_choice"] = choice
        }
        if !input.tools.isEmpty {
            // The runtime accepts one tool call per turn, including continuations without a required choice.
            body["parallel_tool_calls"] = false
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
