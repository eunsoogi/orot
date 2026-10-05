#if DEBUG
    import Foundation

    final class ChatGPTPlanFixtureURLProtocol: URLProtocol {
        private let lock = NSLock()
        private var stopped = false
        private var pendingWork: DispatchWorkItem?

        override class func canInit(with request: URLRequest) -> Bool {
            guard ChatGPTPlanFixtureState.shared.isActive,
                  let url = request.url,
                  url.host == "api.openai.com" else { return false }
            return url.path == "/v1/models" || url.path == "/v1/responses"
        }

        override class func canonicalRequest(for request: URLRequest) -> URLRequest {
            request
        }

        override func startLoading() {
            guard request.value(forHTTPHeaderField: "Authorization") == "Bearer synthetic-access-token" else {
                return respond(status: 401, body: #"{"error":{"code":"fixture_auth_required"}}"#)
            }
            guard let url = request.url else { return respond(status: 400, body: #"{"error":{"code":"invalid_request"}}"#) }
            if request.httpMethod == "GET", url.path == "/v1/models" {
                return respond(
                    status: 200,
                    body: #"{"models":[{"slug":"gpt-synthetic","display_name":"Synthetic model","visibility":"list"},{"slug":"hidden","display_name":"Hidden model","visibility":"private"}]}"#,
                )
            }
            guard request.httpMethod == "POST", url.path == "/v1/responses" else {
                return respond(status: 404, body: #"{"error":{"code":"not_found"}}"#)
            }
            guard let payload = requestPayload(request), validPlanRequest(payload) else {
                return respond(status: 400, body: #"{"error":{"code":"invalid_plan_request"}}"#)
            }
            switch ChatGPTPlanFixtureState.shared.scenario {
            case .completed:
                deliverSSE([ChatGPTPlanFixtureEvents.delta("안녕"), ChatGPTPlanFixtureEvents.delta("하세요"), ChatGPTPlanFixtureEvents.completed("안녕하세요")], finish: true)
            case .usageLimit:
                deliverSSE([ChatGPTPlanFixtureEvents.delta("일부"), ChatGPTPlanFixtureEvents.failure], finish: true)
            case .cancellable:
                deliverSSE([ChatGPTPlanFixtureEvents.delta("취소 대기")], finish: false, delay: 0.15)
            case .toolRoundTrip:
                guard Self.validToolRoundTripRequest(payload, returningResult: Self.hasToolResult(payload)) else {
                    return respond(status: 400, body: #"{"error":{"code":"invalid_tool_round_trip"}}"#)
                }
                if Self.hasToolResult(payload) {
                    deliverSSE([ChatGPTPlanFixtureEvents.delta("Source found."), ChatGPTPlanFixtureEvents.completedToolRoundTrip("Source found.")], finish: true)
                } else {
                    deliverSSE([
                        ChatGPTPlanFixtureEvents.functionCallAdded,
                        ChatGPTPlanFixtureEvents.functionCallArgumentsDelta,
                        ChatGPTPlanFixtureEvents.functionCallArgumentsDone,
                        ChatGPTPlanFixtureEvents.completedToolCall,
                    ], finish: true)
                }
            }
        }

        override func stopLoading() {
            lock.lock()
            stopped = true
            pendingWork?.cancel()
            pendingWork = nil
            lock.unlock()
        }

        private func requestPayload(_ request: URLRequest) -> [String: Any]? {
            let body = request.httpBody.flatMap { $0.isEmpty ? nil : $0 } ?? Self.read(request.httpBodyStream)
            guard let data = body,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
            return payload
        }

        private func validPlanRequest(_ request: [String: Any]) -> Bool {
            request["model"] as? String == "gpt-synthetic"
                && request["store"] as? Bool == false
                && request["stream"] as? Bool == true
                && request["include"] as? [String] == ["reasoning.encrypted_content"]
        }

        private static func hasToolResult(_ request: [String: Any]) -> Bool {
            (request["input"] as? [[String: Any]])?.contains { $0["type"] as? String == "function_call_output" } == true
        }

        private static func validToolRoundTripRequest(_ request: [String: Any], returningResult: Bool) -> Bool {
            guard let tools = request["tools"] as? [[String: Any]],
                  tools.count == 1,
                  tools[0]["type"] as? String == "function",
                  tools[0]["name"] as? String == "lookup_source",
                  tools[0]["strict"] as? Bool == false,
                  let parameters = tools[0]["parameters"] as? [String: Any],
                  let properties = parameters["properties"] as? [String: Any],
                  let sourceIDProperty = properties["sourceId"] as? [String: Any],
                  sourceIDProperty["type"] as? String == "string",
                  parameters["required"] as? [String] == ["sourceId"],
                  parameters["additionalProperties"] as? Bool == false,
                  let input = request["input"] as? [[String: Any]] else { return false }
            guard input.contains(where: {
                $0["role"] as? String == "user" && $0["content"] as? String == "Look up source-42."
            }) else { return false }
            let hasFunctionCall = input.contains { $0["type"] as? String == "function_call" }
            let hasReasoning = input.contains { $0["type"] as? String == "reasoning" }
            let hasOutput = input.contains { item in
                item["type"] as? String == "function_call_output"
                    && item["call_id"] as? String == "call_synthetic_source"
                    && item["output"] as? String == #"{"found":true,"sourceId":"source-42"}"#
            }
            return returningResult
                ? hasFunctionCall && hasReasoning && hasOutput
                : !hasFunctionCall && !hasReasoning && !hasOutput
        }

        private static func read(_ stream: InputStream?) -> Data? {
            guard let stream else { return nil }
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = buffer.withUnsafeMutableBufferPointer { pointer in
                    stream.read(pointer.baseAddress!, maxLength: pointer.count)
                }
                if count < 0 {
                    return nil
                }
                if count == 0 {
                    break
                }
                data.append(contentsOf: buffer.prefix(count))
            }
            return data
        }

        private func respond(status: Int, body: String) {
            let data = Data(body.utf8)
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json", "x-request-id": "req_synthetic_fixture"],
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }

        private func deliverSSE(_ events: [Data], finish: Bool, delay: TimeInterval = 0) {
            let response = HTTPURLResponse(
                url: request.url!,
                statusCode: 200,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/event-stream", "x-request-id": "req_synthetic_fixture"],
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            let data = events.reduce(into: Data()) { $0.append($1) }
            let work = DispatchWorkItem { [weak self] in
                guard let self, !self.isStopped else { return }
                for offset in stride(from: 0, to: data.count, by: 5) {
                    guard !isStopped else { return }
                    client?.urlProtocol(self, didLoad: data[offset ..< min(offset + 5, data.count)])
                }
                if finish, !isStopped {
                    client?.urlProtocolDidFinishLoading(self)
                }
            }
            if delay == 0 {
                DispatchQueue.global().async(execute: work)
            } else {
                lock.lock()
                pendingWork = work
                lock.unlock()
                DispatchQueue.global().asyncAfter(deadline: .now() + delay, execute: work)
            }
        }

        private var isStopped: Bool {
            lock.lock()
            defer { lock.unlock() }
            return stopped
        }
    }
#endif
