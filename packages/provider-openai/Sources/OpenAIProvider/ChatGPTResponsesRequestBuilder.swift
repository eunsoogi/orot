import Foundation

enum ChatGPTResponsesRequestBuilder {
    static func build(_ input: ChatGPTResponsesRequest, accessToken: String) throws -> URLRequest {
        guard !input.model.isEmpty,
              input.model == input.model.trimmingCharacters(in: .whitespacesAndNewlines),
              !input.messages.isEmpty,
              !accessToken.isEmpty else {
            throw ChatGPTResponsesError.invalidRequest
        }

        var instructions = [String]()
        var messages = [[String: String]]()
        for message in input.messages {
            switch message {
            case .system(let text): instructions.append(text)
            case .user(let text): messages.append(["role": "user", "content": text])
            case .assistant(let text): messages.append(["role": "assistant", "content": text])
            }
        }

        var body: [String: Any] = [
            "model": input.model,
            "input": messages,
            "store": false,
            "stream": true,
        ]
        if !instructions.isEmpty { body["instructions"] = instructions.joined(separator: "\n\n") }
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
}
