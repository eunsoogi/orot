import XCTest

/// Uses restored synthetic turns to observe independent foreground and real-scene resize boundaries.
@MainActor
enum SyntheticProfileBackdropUITestConditions {
    static func run(_ testCase: XCTestCase, rotation: Bool) throws {
        let session = UUID().uuidString
        let app = XCUIApplication()
        let originalOrientation = XCUIDevice.shared.orientation
        defer {
            if rotation {
                XCUIDevice.shared.orientation = originalOrientation
            }
        }
        if rotation {
            XCUIDevice.shared.orientation = .portrait
        }
        app.launchArguments = ["-OROT_TEST_SCENARIO", "conversation-visual", "-OROT_TEST_LONG_CONVERSATION_VISUAL", "YES", "-AppleLanguages", "(ko)", "-AppleLocale", "ko_KR"]
        // Only the resize case mounts the native scene request control; foreground has no probe overlay.
        if rotation {
            app.launchArguments += ["-OROT_TEST_UI_GEOMETRY", "YES", "-OROT_TEST_ROTATION_GEOMETRY_SESSION", session]
        }
        app.launch()
        defer { UITestConditions.terminateStandaloneApp(app) }
        let star = UITestConditions.element(app, "별")
        let screen = UITestConditions.element(app, "rag-conversation-screen")
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in star.exists || screen.exists }, object: nil)
        XCTAssertEqual(UITestConditions.wait(for: [ready]), .completed)
        if star.exists {
            NavigationForegroundUITestConditions.prepareFreshAppearance(app)
        }
        let history = UITestConditions.element(app, "rag-conversation-history")
        let profile = UITestConditions.element(app, "assistant-floating-overlay")
        XCTAssertTrue(UITestConditions.exists(history) && UITestConditions.exists(profile))
        let lastAnswer = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "합성 답변 24")).firstMatch
        let markers = (1 ... 23).map { number in
            app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "합성 답변 \(number):")).firstMatch
        }
        XCTAssertTrue(UITestConditions.exists(lastAnswer) && lastAnswer.isHittable)
        let before = lastAnswer.frame
        let visibleBefore = markers.map { $0.exists && $0.isHittable }
        let beforeImage = XCTAttachment(screenshot: app.screenshot())
        beforeImage.name = "synthetic-profile-before-scroll"
        beforeImage.lifetime = .keepAlways
        testCase.add(beforeImage)
        history.swipeDown()
        let after = lastAnswer.exists ? lastAnswer.frame : .null
        let newlyVisible = markers.enumerated().compactMap { index, marker in
            !visibleBefore[index] && marker.exists && marker.isHittable ? index + 1 : nil
        }
        XCTAssertTrue((lastAnswer.exists && after.minY > before.minY) || !newlyVisible.isEmpty, "The gesture must move restored transcript content")
        let rail = UITestConditions.element(app, "navigation-root-tabs-glass-backdrop")
        XCTAssertTrue(rail.exists)
        let frames = XCTAttachment(string: "profile=\(profile.frame), history=\(history.frame), rail=\(rail.frame), app=\(app.frame), lastBefore=\(before), lastAfter=\(after), newlyVisible=\(newlyVisible)")
        frames.name = "synthetic-profile-history-frames"
        frames.lifetime = .keepAlways
        testCase.add(frames)
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "synthetic-scrolled-profile"
        screenshot.lifetime = .keepAlways
        testCase.add(screenshot)
        if rotation {
            let beforeWidth = history.frame.width
            _ = try NavigationRotationUITestConditions.rotateObservedScene(app, session: session, landscape: true, scrollID: "rag-conversation-history")
            XCTAssertTrue(history.exists && profile.exists && rail.exists)
            XCTAssertGreaterThan(abs(history.frame.width - beforeWidth), 0.5, "The transcript viewport must actually resize")
            let geometry = XCTAttachment(string: "profile=\(profile.frame), history=\(history.frame), rail=\(rail.frame), app=\(app.frame)")
            geometry.name = "synthetic-profile-after-resize-frames"
            geometry.lifetime = .keepAlways
            testCase.add(geometry)
            let image = XCTAttachment(screenshot: app.screenshot())
            image.name = "synthetic-profile-after-resize"
            image.lifetime = .keepAlways
            testCase.add(image)
            return
        }
        XCUIDevice.shared.press(.home)
        let background = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            app.state == .runningBackground || app.state == .runningBackgroundSuspended
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [background], timeout: 10), .completed)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(history.exists && profile.exists && rail.exists)
        let restoredFrames = XCTAttachment(string: "profile=\(profile.frame), history=\(history.frame), rail=\(rail.frame), app=\(app.frame)")
        restoredFrames.name = "synthetic-profile-after-foreground-frames"
        restoredFrames.lifetime = .keepAlways
        testCase.add(restoredFrames)
        let restoredImage = XCTAttachment(screenshot: app.screenshot())
        restoredImage.name = "synthetic-profile-after-foreground"
        restoredImage.lifetime = .keepAlways
        testCase.add(restoredImage)
    }
}
