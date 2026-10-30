import XCTest

/// Opt-in observation of an existing production installation. No fixture state or consent is injected.
@MainActor
final class ProductionRagConversationUITests: XCTestCase {
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
        ]
        let newSources = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            sourceLists.count > 0 || self.node(app, "inference-disclosure-sheet").exists ||
                failures.contains { app.staticTexts[$0.0].exists }
        }, object: nil)
        guard UITestConditions.wait(for: [newSources]) == .completed else { throw failure("validated_citations_unavailable") }
        if node(app, "inference-disclosure-sheet").exists {
            throw failure("consent_required")
        }
        for (text, status) in failures where app.staticTexts[text].exists {
            throw failure(status)
        }
        guard sourceLists.count > 0 else { throw failure("validated_citations_unavailable") }
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
