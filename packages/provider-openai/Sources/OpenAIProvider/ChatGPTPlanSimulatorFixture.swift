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
            case toolRoundTrip
        }

        public let issuedClientID: String
        public let client: ChatGPTOAuthClient
        private let credentialStore: KeychainChatGPTCredentialStore

        public init(scenario: Scenario) throws {
            let account = ChatGPTStoredAccount.syntheticKeychainFixture()
            issuedClientID = account.issuedClientID
            credentialStore = KeychainChatGPTCredentialStore(service: "com.orot.provider.openai.simulator-fixture")
            // Preserve cleared credentials when a Simulator app process reopens the fixture.
            if try credentialStore.loadAccount(issuedClientID: issuedClientID) == nil {
                try credentialStore.saveAccount(account)
            }

            let configuration = URLSessionConfiguration.ephemeral
            configuration.urlCache = nil
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            configuration.protocolClasses = [
                ChatGPTPlanFixtureURLProtocol.self,
                ChatGPTSignOutFixtureURLProtocol.self,
            ]
            client = ChatGPTOAuthClient(
                session: URLSession(configuration: configuration),
                credentialStore: credentialStore,
            )
            ChatGPTPlanFixtureState.shared.activate(scenario)
        }

        public func select(_ scenario: Scenario) {
            ChatGPTPlanFixtureState.shared.activate(scenario)
        }

        public func restoreSyntheticAccountForSignIn() throws {
            try credentialStore.saveAccount(.syntheticKeychainFixture())
        }

        public func remove() throws {
            ChatGPTPlanFixtureState.shared.deactivate()
            try credentialStore.removeAccount(issuedClientID: issuedClientID)
        }
    }

    final class ChatGPTPlanFixtureState: @unchecked Sendable {
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
