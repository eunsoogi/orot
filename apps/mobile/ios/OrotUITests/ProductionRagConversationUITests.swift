import Darwin
import XCTest

/// Opt-in observation of an existing production installation. No fixture state or consent is injected.
@MainActor
final class ProductionRagConversationUITests: XCTestCase {
    /// The opt-in probe never enters the conversation path or submits a question.
    func testProductionCancellationBeforeSend() async throws {
        let environment = ProcessInfo.processInfo.environment
        guard let rawPort = environment["OROT_PRODUCTION_CANCEL_PORT"],
              let port = UInt16(rawPort), port > 0,
              let token = environment["OROT_PRODUCTION_CANCEL_TOKEN"], UUID(uuidString: token) != nil
        else { throw failure("cancellation_probe_configuration_missing") }
        let app = XCUIApplication(bundleIdentifier: "com.orot.mobile")
        app.launchArguments = ["-OROT_PROVIDER_DIAGNOSTICS", "-OROT_NATIVE_TOOL_TRACE"]
        app.launch()
        defer { app.terminate() }
        // Complete a real AX query before announcing readiness without recording its contents.
        _ = try app.windows.firstMatch.snapshot()
        try await holdCancellationProbe(port: port, token: token)
    }

    /// Keep the socket read off the main actor. EOF or unexpected data always fails the probe.
    private func holdCancellationProbe(port: UInt16, token: String) async throws -> Never {
        try await withCheckedThrowingContinuation { continuation in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let connection = socket(AF_INET, SOCK_STREAM, 0)
                    guard connection >= 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                    defer { close(connection) }
                    var noSignal: Int32 = 1
                    guard setsockopt(connection, SOL_SOCKET, SO_NOSIGPIPE, &noSignal, socklen_t(MemoryLayout<Int32>.size)) == 0 else {
                        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno))
                    }
                    var address = sockaddr_in()
                    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    address.sin_family = sa_family_t(AF_INET)
                    address.sin_port = port.bigEndian
                    address.sin_addr.s_addr = inet_addr("127.0.0.1")
                    let connected = withUnsafePointer(to: &address) {
                        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                            connect(connection, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
                        }
                    }
                    guard connected == 0 else { throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno)) }
                    let frame = Array("v1 ready \(token) \(getpid())\n".utf8)
                    let sent = frame.withUnsafeBytes { bytes in send(connection, bytes.baseAddress, bytes.count, 0) }
                    guard sent == frame.count else { throw NSError(domain: "ProductionCancellationProbe", code: 1) }
                    var byte: UInt8 = 0
                    _ = read(connection, &byte, 1)
                    // No host response can release the probe into the ordinary conversation test.
                    throw NSError(domain: "ProductionCancellationProbe", code: 2)
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    func testProductionConversation() throws {
        continueAfterFailure = false
        let app = XCUIApplication(bundleIdentifier: "com.orot.mobile")
        app.launchArguments = ["-OROT_PROVIDER_DIAGNOSTICS", "-OROT_NATIVE_TOOL_TRACE"]
        app.launch()
        defer { app.terminate() }
        stage("harness_launched")

        try NavigationUITestConditions.openTab(app, "ai", markers: ["ai-features-screen"])
        try tap(app, "ai-feature-rag-conversation")
        guard UITestConditions.exists(node(app, "rag-conversation-screen")) else { throw failure("conversation_unavailable") }
        try tap(app, "ai-feature-select-provider")
        guard UITestConditions.exists(node(app, "provider-selection-screen")) else { throw failure("provider_selection_unavailable") }
        let apple = node(app, "provider-option-0")
        guard apple.exists, apple.isEnabled, apple.label.contains("Apple Intelligence") else {
            throw failure("apple_intelligence_unavailable_or_unknown")
        }
        apple.tap()
        try tap(app, "provider-selection-confirm")
        guard UITestConditions.exists(node(app, "rag-conversation-screen")) else { throw failure("provider_return_unavailable") }
        let selected = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            self.node(app, "ai-feature-select-provider").label.contains("Apple Intelligence")
        }, object: nil)
        guard UITestConditions.wait(for: [selected]) == .completed else {
            throw failure("apple_selection_not_confirmed")
        }
        stage("apple_intelligence_selected")

        // A new conversation preserves existing sessions and prevents old citations from satisfying this run.
        try tap(app, "rag-conversation-new-session")
        let question = "내 증상 기록을 요약해줘"
        let sourceLists = app.descendants(matching: .any).matching(identifier: "rag-conversation-sources")
        guard sourceLists.count == 0 else { throw failure("new_conversation_not_empty") }
        let input = node(app, "rag-conversation-input")
        guard input.exists, input.isHittable else { throw failure("input_unavailable") }
        input.tap()
        input.typeText(question)
        // Never submit an incomplete or altered clinical question, even after an XCTest assertion fails.
        guard (try? input.snapshot().value as? String) == question else { throw failure("input_mismatch_not_submitted") }
        stage("exact_input_verified")
        try tap(app, "rag-conversation-send")
        stage("submitted_once")

        // Citations appear only on a completed grounded response, not on streamed draft text.
        let failures = [
            ("이 질문에 답할 만한 저장된 근거를 찾지 못했어요.", "no_evidence"),
            ("근거가 부족하거나 서로 맞지 않아 답을 만들지 않았어요.", "insufficient_evidence"),
            ("답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.", "answer_unavailable"),
            ("선택한 AI 서비스의 계정 연결을 확인한 뒤 다시 시도해 주세요.", "provider_authentication"),
            ("AI 서비스가 요청을 잠시 제한했어요. 잠시 후 다시 시도해 주세요.", "provider_rate_limited"),
            ("선택한 AI 서비스 설정을 확인하거나 다른 제공자를 선택해 주세요.", "provider_configuration"),
            ("선택한 AI 서비스가 이 요청에 답하지 않았어요. 질문을 바꿔 다시 시도해 주세요.", "provider_refused"),
            ("선택한 AI 서비스를 사용할 수 없어요. 계정이나 연결 상태를 확인한 뒤 다시 시도해 주세요.", "provider_unavailable"),
            ("이 요청에 필요한 처리 동의를 확인한 뒤 다시 시도해 주세요.", "consent_required"),
            ("답변 생성을 중지했어요. 초안을 다시 보내면 이어서 시도할 수 있어요.", "cancelled"),
            ("저장된 기록을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.", "retrieval_failed"),
            ("답변을 확인하지 못해 표시하지 않았어요. 질문을 바꾸거나 다시 시도해 주세요.", "validation_failed"),
            ("기록이 변경되어 답변을 확인하지 못했어요. 다시 시도해 주세요.", "stale_evidence"),
            ("질문을 한 번에 처리하지 못했어요. 질문을 나누어 다시 시도해 주세요.", "budget_exceeded"),
        ]
        let newSources = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            sourceLists.count > 0 || self.node(app, "inference-disclosure-sheet").exists ||
                failures.contains { app.staticTexts[$0.0].exists }
        }, object: nil)
        guard UITestConditions.wait(for: [newSources]) == .completed else { throw failure("validated_citations_unavailable") }
        if node(app, "inference-disclosure-sheet").exists {
            throw failure("consent_required")
        }
        let error = node(app, "rag-conversation-error")
        if error.exists, UITestConditions.text(error) == failures.first(where: { $0.1 == "validation_failed" })?.0 {
            stage("validation_failure_visible")
            let partial = node(app, "rag-conversation-incomplete-activity")
            if partial.exists {
                guard UITestConditions.text(partial) == UITestConditions.text(error) else { throw failure("partial_failure_copy_mismatch") }
                stage("incomplete_partial_validation_visible")
            } else {
                stage("no_incomplete_partial_visible")
            }
            guard (try? input.snapshot().value as? String) == question else { throw failure("retry_draft_mismatch") }
            guard sourceLists.count == 0 else { throw failure("failed_turn_has_citations") }
            stage("failed_draft_restored")
            // Retry the same restored turn once; never submit a replacement question.
            try tap(app, "rag-conversation-send")
            stage("same_turn_retried_once")
            let cleared = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in !error.exists }, object: nil)
            guard UITestConditions.wait(for: [cleared]) == .completed else { throw failure("retry_not_started") }
            let retryFinished = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
                sourceLists.count > 0 || error.exists || self.node(app, "inference-disclosure-sheet").exists ||
                    failures.prefix(2).contains { app.staticTexts[$0.0].exists }
            }, object: nil)
            guard UITestConditions.wait(for: [retryFinished]) == .completed else { throw failure("retry_result_unavailable") }
            if node(app, "inference-disclosure-sheet").exists {
                throw failure("retry_consent_required")
            }
            if error.exists {
                let retryError = UITestConditions.text(error)
                let status = failures.first { $0.0 == retryError }?.1 ?? "unknown_failure"
                throw failure("retry_\(status)")
            }
        } else {
            for (text, status) in failures where app.staticTexts[text].exists {
                throw failure(status)
            }
        }
        guard sourceLists.count > 0 else { throw failure("validated_citations_unavailable") }
        // Citations do not prove that the completed assistant body itself is displayed.
        let answerBody = node(app, "rag-conversation-answer-body")
        let history = node(app, "rag-conversation-history")
        guard answerBody.exists, history.exists else { throw failure("assistant_answer_body_unavailable") }
        let answerText = UITestConditions.text(answerBody).trimmingCharacters(in: .whitespacesAndNewlines)
        let visibleAnswerFrame = answerBody.frame.intersection(history.frame)
        guard !answerText.isEmpty,
              !visibleAnswerFrame.isNull,
              visibleAnswerFrame.width > 0,
              visibleAnswerFrame.height > 0
        else { throw failure("assistant_answer_body_not_visible") }
        stage("assistant_answer_body_visible")
        let sources = sourceLists.firstMatch
        stage("validated_citations_visible")
        let source = sources.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "원문 근거 열기")).firstMatch
        guard source.exists, source.isHittable else { throw failure("source_action_unavailable") }
        source.tap()
        guard UITestConditions.exists(node(app, "ai-feature-source-detail")) else { throw failure("source_navigation_unavailable") }
        stage("source_navigation_visible")
    }

    @MainActor
    private func node(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        UITestConditions.element(app, id)
    }

    @MainActor
    private func tap(_ app: XCUIApplication, _ id: String) throws {
        let element = node(app, id)
        guard element.exists, element.isHittable, element.isEnabled else { throw failure("control_unavailable_\(id)") }
        element.tap()
    }

    private func failure(_ stage: String) -> NSError {
        self.stage(stage)
        return NSError(domain: "ProductionConversation", code: 1, userInfo: [NSLocalizedDescriptionKey: stage])
    }

    private func stage(_ name: String) {
        let attachment = XCTAttachment(string: name)
        attachment.name = "production-conversation-stage"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
