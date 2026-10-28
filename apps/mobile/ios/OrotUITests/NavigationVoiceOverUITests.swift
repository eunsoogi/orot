import XCTest

extension RootNavigationUITests {
    /// Uses real VoiceOver speech and touch activation; AX labels alone cannot prove focus or activation.
    @MainActor
    func testVoiceOverReadsAndActivatesRightRailNavigation() throws {
        guard #available(iOS 27.0, *) else {
            XCTFail("The registered Duo VoiceOver journey requires the public iOS 27 service")
            return
        }
        let app = XCUIApplication()
        let service = XCUIDevice.shared.voiceOverService
        let originallyEnabled = service.isEnabled
        // Register cleanup before launch or enablement so errors cannot leave this owned Simulator changed.
        addTeardownBlock { @MainActor in
            defer { UITestConditions.terminateStandaloneApp(app) }
            do {
                if service.isEnabled != originallyEnabled {
                    if originallyEnabled {
                        try service.enable()
                    } else {
                        try service.disable()
                    }
                }
                self.voiceOverAttachment("restoration", ["originallyEnabled": originallyEnabled, "enabled": service.isEnabled])
                XCTAssertEqual(service.isEnabled, originallyEnabled)
            } catch {
                self.voiceOverError(error, phase: "restoration")
                throw error
            }
        }
        app.launchArguments = [
            "-OROT_TEST_PROFILE", "core", "-OROT_TEST_UI_GEOMETRY", "YES",
            "-OROT_TEST_NAVIGATION_OBSERVATION", "YES", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR",
        ]
        do {
            try service.enable()
            XCTAssertTrue(service.isEnabled)
            app.launch()
            NavigationUITestConditions.route(app, markers: ["welcome-title"])
            let home = try NavigationUITestConditions.navigationAction(app, "navigation-tab-home").control
            try focusWithVoiceOver(home, expected: "홈 탭", service: service)
            // The five existing root actions form a single ordered navigation group in both Duo states.
            for label in ["기록 탭", "일정 탭", "AI 탭", "설정 탭"] {
                try assertVoiceOverSpeech("root-forward-\(label)", expected: label) { try service.moveForward() }
            }
            let settings = try NavigationUITestConditions.navigationAction(app, "navigation-tab-settings").control
            settings.doubleTap()
            NavigationUITestConditions.route(app, markers: ["settings-title"])
            XCTAssertTrue(settings.isSelected)
            try NavigationGeometryUITestConditions.captureBoundary(app, navigationID: "navigation-tab-settings", name: "voiceover-settings-activation", testCase: self)

            let health = UITestConditions.element(app, "settings-open-health-data")
            try focusWithVoiceOver(health, expected: "건강 데이터", service: service)
            health.doubleTap()
            NavigationUITestConditions.route(app, markers: ["health-data-title"])
            let back = try NavigationUITestConditions.navigationAction(app, "navigation-back").control
            try focusWithVoiceOver(back, expected: "이전 화면으로 돌아가기", service: service)
            back.doubleTap()
            NavigationUITestConditions.route(app, markers: ["settings-title"])

            try focusWithVoiceOver(health, expected: "건강 데이터", service: service)
            health.doubleTap()
            NavigationUITestConditions.route(app, markers: ["health-data-title"])
            try focusWithVoiceOver(back, expected: "이전 화면으로 돌아가기", service: service)
            try assertVoiceOverSpeech("context-forward-home", expected: "홈 화면으로 이동") { try service.moveForward() }
            try NavigationUITestConditions.navigationAction(app, "navigation-home").control.doubleTap()
            NavigationUITestConditions.route(app, markers: ["welcome-title"])
            XCTAssertTrue(service.isEnabled)
        } catch {
            voiceOverError(error, phase: "journey")
            throw error
        }
    }

    @available(iOS 27.0, *)
    @MainActor
    private func focusWithVoiceOver(_ control: XCUIElement, expected: String, service: XCUIVoiceOverService) throws {
        XCTAssertTrue(UITestConditions.exists(control) && control.isHittable)
        // Require actual service speech after one touch before sending the separate activation gesture.
        control.tap()
        try assertVoiceOverSpeech("focus-\(expected)", expected: expected) { try service.currentSpeech() }
    }

    @available(iOS 27.0, *)
    @MainActor
    private func assertVoiceOverSpeech(_ phase: String, expected: String, read: () throws -> XCUIVoiceOverService.Output) throws {
        let output = try read()
        voiceOverAttachment(phase, ["utterance": output.utterance, "expected": expected])
        XCTAssertTrue(output.utterance.contains(expected), "Unexpected actual VoiceOver utterance: \(output.utterance)")
    }

    @MainActor
    private func voiceOverError(_ error: Error, phase: String) {
        let nativeError = error as NSError
        voiceOverAttachment("\(phase)-error", ["domain": nativeError.domain, "code": nativeError.code, "description": String(reflecting: error)])
    }

    @MainActor
    private func voiceOverAttachment(_ phase: String, _ payload: [String: Any]) {
        let data = (try? JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])) ?? Data()
        let attachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
        attachment.name = "voiceover-\(phase)"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
