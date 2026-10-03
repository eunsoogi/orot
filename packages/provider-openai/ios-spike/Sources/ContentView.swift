import OpenAIProvider
import SwiftUI
import UIKit

@MainActor
private final class SpikeViewModel: ObservableObject {
    @Published var status = "ChatGPT 로그인을 검증할 준비가 되었습니다."
    @Published var lifecycleEvents: [String] = []
    @Published var models: [ListedChatGPTModel] = []
    @Published var grantedDirectPlanScope = false
    @Published var isSigningIn = false

    private let oauth = ChatGPTOAuthClient(agentName: "Orot 로그인 검증")
    private let hostIdentifierStore = UserDefaultsHostIdentifierStore(
        key: "com.orot.oauth-spike.ext-agent-host-id"
    )
    private var callbackServer: LoopbackCallbackServer?
    private var signInTask: Task<Void, Never>?

    func recordLifecycle(_ phase: ScenePhase) {
        let label: String
        switch phase {
        case .active: label = "활성"
        case .inactive: label = "비활성"
        case .background: label = "백그라운드"
        @unknown default: label = "알 수 없음"
        }
        let time = Date.now.formatted(date: .omitted, time: .standard)
        lifecycleEvents.insert("\(time): \(label)", at: 0)
        lifecycleEvents = Array(lifecycleEvents.prefix(12))
    }

    func signIn() {
        guard !isSigningIn else { return }
        isSigningIn = true
        models = []
        grantedDirectPlanScope = false
        status = "127.0.0.1 콜백 리스너를 시작합니다…"

        signInTask = Task {
            defer {
                callbackServer?.stop()
                callbackServer = nil
                signInTask = nil
                isSigningIn = false
            }

            do {
                try Task.checkCancellation()
                let server = LoopbackCallbackServer()
                callbackServer = server
                let redirectURI = try await server.start()
                try Task.checkCancellation()
                let pending = try await oauth.prepareAuthorization(
                    hostIdentifier: hostIdentifierStore.loadOrCreate(),
                    redirectURI: redirectURI
                )
                try Task.checkCancellation()

                status = "Safari가 열렸습니다. 로그인을 마친 뒤 이 앱으로 돌아오세요."
                let callbackTask = Task { try await server.waitForCallback() }
                let opened = await openInSystemBrowser(pending.authorizationURL)
                guard opened else {
                    callbackTask.cancel()
                    throw SpikeError.browserUnavailable
                }

                let callbackURL = try await callbackTask.value
                status = "콜백을 받았습니다. state를 확인하고 인가 코드를 교환합니다…"
                let access = try await oauth.completeAuthorization(
                    callbackURL: callbackURL,
                    pending: pending
                )
                grantedDirectPlanScope = access.hasDirectPlanAccess
                guard grantedDirectPlanScope else {
                    throw ChatGPTOAuthError.planPermissionMissing
                }

                status = "필요한 권한을 받았습니다. ChatGPT 모델 목록을 요청합니다…"
                models = try await oauth.listModels(for: access)
                status = "실제 /v1/models 응답을 확인했습니다. 공개 모델 \(models.count)개를 받았습니다."
            } catch is CancellationError {
                status = "로그인이 취소되었습니다. 인증 정보는 저장하지 않았습니다."
            } catch {
                status = error.localizedDescription
            }
        }
    }

    func cancel() {
        signInTask?.cancel()
        callbackServer?.stop()
        status = "로그인을 취소했습니다. 인증 정보는 저장하지 않았습니다."
    }

    private func openInSystemBrowser(_ url: URL) async -> Bool {
        await withCheckedContinuation { continuation in
            UIApplication.shared.open(url, options: [:]) { opened in
                continuation.resume(returning: opened)
            }
        }
    }
}

private enum SpikeError: LocalizedError {
    case browserUnavailable

    var errorDescription: String? {
        "시스템 브라우저에서 로그인 페이지를 열지 못했습니다."
    }
}

@MainActor
struct ContentView: View {
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var model = SpikeViewModel()

    var body: some View {
        NavigationView {
            List {
                Section("로그인 상태") {
                    Text(model.status)
                        .accessibilityIdentifier("oauth-status")
                    if model.grantedDirectPlanScope {
                        Label("chatgpt.tokens.use.direct 권한을 받았습니다", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                    if !model.isSigningIn {
                        Button("ChatGPT 로그인 시작", action: model.signIn)
                            .accessibilityIdentifier("start-chatgpt-sign-in")
                    } else {
                        Button("로그인 취소", role: .cancel, action: model.cancel)
                            .accessibilityIdentifier("cancel-chatgpt-sign-in")
                    }
                }

                Section("iOS 앱 상태 변화") {
                    Text("브라우저로 전환하면 이 앱은 백그라운드로 이동합니다. 상태 전환을 기록하지만, 다른 앱이 활성화되면 iOS가 리스너를 일시 중단할 수 있습니다.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    if model.lifecycleEvents.isEmpty {
                        Text("기록된 앱 상태 변화가 없습니다.")
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(Array(model.lifecycleEvents.enumerated()), id: \.offset) { _, event in
                            Text(event).font(.caption.monospaced())
                        }
                    }
                }

                if !model.models.isEmpty {
                    Section("ChatGPT 모델 목록") {
                        ForEach(model.models, id: \.slug) { item in
                            VStack(alignment: .leading) {
                                Text(item.displayName)
                                Text(item.slug).font(.caption.monospaced()).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("ChatGPT 로그인 검증")
            .onChange(of: scenePhase, perform: model.recordLifecycle)
        }
    }
}
