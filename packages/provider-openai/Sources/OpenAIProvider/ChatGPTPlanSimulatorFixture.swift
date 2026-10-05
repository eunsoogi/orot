#if DEBUG
    import Foundation

    public final class ChatGPTPlanSimulatorFixture: @unchecked Sendable {
        public static var issuedClientID: String {
            ChatGPTStoredAccount.syntheticKeychainFixture().issuedClientID
        }

        public enum Scenario: String, Sendable {
            case completed
            case usageLimit
            case cancellable
        }

        public let issuedClientID: String
        public let client: ChatGPTOAuthClient
        private let credentialStore: KeychainChatGPTCredentialStore

        public init(scenario: Scenario) throws {
            let account = ChatGPTStoredAccount.syntheticKeychainFixture()
            issuedClientID = account.issuedClientID
            credentialStore = KeychainChatGPTCredentialStore(service: "com.orot.provider.openai.simulator-fixture")
            try credentialStore.saveAccount(account)

            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            configuration.protocolClasses = [ChatGPTPlanFixtureURLProtocol.self]
            client = ChatGPTOAuthClient(
                session: URLSession(configuration: configuration),
                credentialStore: credentialStore,
            )
            ChatGPTPlanFixtureState.shared.activate(scenario)
        }

        public func select(_ scenario: Scenario) {
            ChatGPTPlanFixtureState.shared.activate(scenario)
        }

        public func remove() throws {
            ChatGPTPlanFixtureState.shared.deactivate()
            try credentialStore.removeAccount(issuedClientID: issuedClientID)
        }
    }

    private final class ChatGPTPlanFixtureURLProtocol: URLProtocol {
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
            guard validPlanRequest(request) else {
                return respond(status: 400, body: #"{"error":{"code":"invalid_plan_request"}}"#)
            }
            switch ChatGPTPlanFixtureState.shared.scenario {
            case .completed:
                deliverSSE([Self.delta("안녕"), Self.delta("하세요"), Self.completed("안녕하세요")], finish: true)
            case .usageLimit:
                deliverSSE([Self.delta("일부"), Self.failure], finish: true)
            case .cancellable:
                deliverSSE([Self.delta("취소 대기")], finish: false, delay: 0.15)
            }
        }

        override func stopLoading() {
            lock.lock()
            stopped = true
            pendingWork?.cancel()
            pendingWork = nil
            lock.unlock()
        }

        private func validPlanRequest(_ request: URLRequest) -> Bool {
            let body = request.httpBody.flatMap { $0.isEmpty ? nil : $0 } ?? Self.read(request.httpBodyStream)
            guard let data = body,
                  let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
            return request["model"] as? String == "gpt-synthetic"
                && request["store"] as? Bool == false
                && request["stream"] as? Bool == true
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

        private static func event(_ name: String, _ payload: [String: Any]) -> Data {
            let json = try! JSONSerialization.data(withJSONObject: payload)
            var data = Data("event: \(name)\r\ndata: ".utf8)
            data.append(json)
            data.append(Data("\r\n\r\n".utf8))
            return data
        }

        private static func delta(_ text: String) -> Data {
            event("response.output_text.delta", ["type": "response.output_text.delta", "delta": text])
        }

        private static func completed(_ text: String) -> Data {
            event("response.completed", [
                "type": "response.completed",
                "response": ["status": "completed", "output_text": text],
            ])
        }

        private static let failure = event("error", [
            "type": "error",
            "code": "subscription_sharing_usage_limit_exceeded",
            "message": "The ChatGPT plan usage limit was reached.",
            "param": "model",
        ])
    }

    private final class ChatGPTPlanFixtureState: @unchecked Sendable {
        static let shared = ChatGPTPlanFixtureState()
        private let lock = NSLock()
        private var active = false
        private var currentScenario: ChatGPTPlanSimulatorFixture.Scenario = .completed

        var isActive: Bool {
            lock.lock()
            defer { lock.unlock() }
            return active
        }

        var scenario: ChatGPTPlanSimulatorFixture.Scenario {
            lock.lock()
            defer { lock.unlock() }
            return currentScenario
        }

        func activate(_ scenario: ChatGPTPlanSimulatorFixture.Scenario) {
            lock.lock()
            currentScenario = scenario
            active = true
            lock.unlock()
        }

        func deactivate() {
            lock.lock()
            active = false
            lock.unlock()
        }
    }
#endif
