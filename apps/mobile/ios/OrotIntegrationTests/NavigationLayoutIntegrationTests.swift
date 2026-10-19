@testable import Orot
import UIKit
import XCTest

final class NavigationLayoutIntegrationTests: OrotFailFastTestCase {
    @MainActor
    func testContextualDisabledAccessibilityTracksUIKitStateWithoutTabSelection() throws {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: 386, height: 48))
        // Exercise the real UIKit constructor; custom traits must preserve disabled state without granting tab selection.
        for (disabled, selected) in [(true, false), (false, true), (true, true), (false, false)] {
            surface.actions = [[
                "id": "primary", "label": "Synthetic action", "testID": "synthetic-navigation-action",
                "accessibilityLabel": "Synthetic action", "primary": true,
                "disabled": disabled, "selected": selected,
            ]] as NSArray
            surface.layoutIfNeeded()
            let group = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIStackView }.first)
            let button = try XCTUnwrap(group.arrangedSubviews.compactMap { $0 as? UIButton }.first)
            XCTAssertEqual(button.isEnabled, !disabled)
            XCTAssertTrue(button.accessibilityTraits.contains(.button))
            XCTAssertEqual(button.accessibilityTraits.contains(.notEnabled), disabled)
            XCTAssertFalse(button.accessibilityTraits.contains(.selected))
        }
    }

    @MainActor
    func testRootTabAccessibilityKeepsDisabledAndSelectedTraitsTogether() throws {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: 386, height: 60))
        surface.actions = [
            [
                "id": "tab-home", "label": "Home", "testID": "navigation-tab-home",
                "accessibilityLabel": "Home tab", "systemImageName": "house.fill",
                "rootTab": true, "selected": true, "disabled": true,
            ],
            [
                "id": "tab-records", "label": "Records", "testID": "navigation-tab-records",
                "accessibilityLabel": "Records tab", "systemImageName": "doc.text",
                "rootTab": true, "selected": false, "disabled": false,
            ],
        ] as NSArray
        surface.layoutIfNeeded()

        let rootBar = try XCTUnwrap(surface.subviews.compactMap { $0 as? NavigationRootGlassBar }.first)
        rootBar.layoutIfNeeded()
        let stack = try XCTUnwrap(rootBar.contentView.subviews.compactMap { $0 as? UIStackView }.first)
        stack.layoutIfNeeded()
        let buttons = stack.arrangedSubviews.compactMap { $0 as? UIButton }
        XCTAssertEqual(rootBar.bounds.height, 60, accuracy: 0.5)
        XCTAssertEqual(buttons.count, 2)
        for button in buttons {
            XCTAssertEqual(button.bounds.height, 52, accuracy: 0.5)
            XCTAssertEqual(button.frame.minY, 4, accuracy: 0.5)
        }
        XCTAssertEqual(buttons[0].isEnabled, false)
        XCTAssertTrue(buttons[0].accessibilityTraits.contains(.notEnabled))
        XCTAssertTrue(buttons[0].accessibilityTraits.contains(.selected))
        XCTAssertEqual(buttons[1].isEnabled, true)
        XCTAssertFalse(buttons[1].accessibilityTraits.contains(.notEnabled))
        XCTAssertFalse(buttons[1].accessibilityTraits.contains(.selected))
    }

    @MainActor
    func testBackAndHomeNeverExposeRootTabSelectionToAccessibility() throws {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: 386, height: 60))
        surface.actions = [
            [
                "id": "back", "label": "Back", "testID": "navigation-back",
                "accessibilityLabel": "Back", "selected": true,
            ],
            [
                "id": "home", "label": "Home", "testID": "navigation-home",
                "accessibilityLabel": "Home", "systemImageName": "house.fill", "selected": true,
            ],
        ] as NSArray
        surface.layoutIfNeeded()

        let group = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIStackView }.first)
        let buttons = group.arrangedSubviews.compactMap { $0 as? UIButton }
        XCTAssertEqual(buttons.count, 2)
        for button in buttons {
            XCTAssertTrue(button.accessibilityTraits.contains(.button))
            XCTAssertFalse(button.accessibilityTraits.contains(.selected))
        }
    }

    @MainActor
    func testPrimaryNavigationActionsKeepTheirMinimumNativeTargetSize() throws {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: 386, height: 48))
        surface.actions = [
            [
                "id": "generate", "label": "Generate", "testID": "navigation-generate",
                "accessibilityLabel": "Generate", "primary": true,
            ],
            [
                "id": "cancel", "label": "Cancel", "testID": "navigation-cancel",
                "accessibilityLabel": "Cancel", "primary": true,
            ],
        ] as NSArray
        surface.layoutIfNeeded()

        let group = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIStackView }.first)
        let buttons = group.arrangedSubviews.compactMap { $0 as? UIButton }
        XCTAssertEqual(buttons.count, 2)
        for button in buttons {
            XCTAssertGreaterThanOrEqual(button.bounds.width, 88)
            XCTAssertEqual(button.bounds.height, 48, accuracy: 0.5)
        }
    }

    @MainActor
    func testProductionRootTabSymbolsAndLabelsFitTheirUIKitTouchTargets() async throws {
        let result = try await TestOperationBroker.shared.request("render-application")
        XCTAssertEqual(result["requested"] as? Bool, true)
        let routes = [
            ("home", ["welcome-title"]),
            ("records", ["records-title"]),
            ("schedule", ["calendar-title", "schedule-retry"]),
            ("ai", ["ai-features-screen"]),
            ("settings", ["settings-title"]),
        ]
        for (tab, markers) in routes {
            let identifier = "navigation-tab-\(tab)"
            let view = try await waitForView([identifier])
            let button = try XCTUnwrap(view as? UIButton)
            button.sendActions(for: .touchUpInside)
            _ = try await waitForView(markers)
            // A route switch can replace its toolbar, so measure the current selected control.
            let selectedView = try await waitForView([identifier])
            try verifyRootTab(XCTUnwrap(selectedView as? UIButton), identifier: identifier)
        }
    }

    @MainActor
    private func waitForView(_ identifiers: [String]) async throws -> UIView {
        while true {
            try Task.checkCancellation()
            for identifier in identifiers {
                if let view = visibleView(identifier) {
                    return view
                }
            }
            // Yield the main actor while React commits the requested route; never measure UIKit from a waiter thread.
            try await Task.sleep(for: .milliseconds(50))
        }
    }

    @MainActor
    func testContextualPrimaryActionPreservesButtonIdentityAcrossSaveStateUpdates() throws {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: 386, height: 48))
        let stack = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIStackView }.first)
        let action: (String, String, Bool) -> [String: Any] = { label, testID, disabled in
            ["id": "primary", "label": label, "accessibilityLabel": label, "testID": testID,
             "primary": true, "disabled": disabled]
        }
        var firstDispatchedID: String?
        var latestDispatchedID: String?
        surface.onAction = { firstDispatchedID = $0?["id"] as? String }
        surface.actions = [action("질문 저장", "next-visit-review-save", false)] as NSArray
        surface.layoutIfNeeded()
        let button = try XCTUnwrap(stack.arrangedSubviews.compactMap { $0 as? UIButton }.first)
        let attachedLayer = button.layer

        // One route action stays mounted while its save label and accessibility identity change.
        for (label, testID, disabled) in [
            ("저장 중", "next-visit-review-save", true),
            ("검토한 질문을 다시 수정합니다", "next-visit-saved-edit", false),
        ] {
            surface.actions = [action(label, testID, disabled)] as NSArray
            surface.layoutIfNeeded()
            let current = try XCTUnwrap(stack.arrangedSubviews.compactMap { $0 as? UIButton }.first)
            XCTAssertTrue(button === current)
            XCTAssertTrue(attachedLayer === current.layer)
            XCTAssertEqual(current.configuration?.title, label)
            XCTAssertEqual(current.accessibilityIdentifier, testID)
            XCTAssertEqual(current.accessibilityLabel, label)
            XCTAssertEqual(current.isEnabled, !disabled)
        }

        let minimumWidth = max(88, ("검토한 질문을 다시 수정합니다" as NSString).size(withAttributes: [.font: UIFont.systemFont(ofSize: 14)]).width + 24)
        let widthConstraint = try XCTUnwrap(button.constraints.first {
            $0.firstAttribute == .width && $0.relation == .greaterThanOrEqual && abs($0.constant - minimumWidth) < 0.5
        })
        XCTAssertTrue(widthConstraint.isActive)
        surface.onAction = { latestDispatchedID = $0?["id"] as? String }
        button.sendActions(for: .touchUpInside)
        XCTAssertNil(firstDispatchedID)
        XCTAssertEqual(latestDispatchedID, "primary")
        surface.actions = [] as NSArray
        XCTAssertTrue(stack.arrangedSubviews.compactMap { $0 as? UIButton }.isEmpty)
    }

    @MainActor
    private func verifyRootTab(_ button: UIButton, identifier: String) {
        // Inspect the actual UIKit children; accessibility snapshots omit these decorative views.
        let children = descendants(button)
        let icon = children.first { $0.accessibilityIdentifier == identifier + "-UIImageView" }
            ?? children.first { $0 is UIImageView }
        let label = children.first { $0.accessibilityIdentifier == identifier + "-UILabel" }
            ?? children.first { $0 is UILabel }
        guard let icon, let label else {
            return XCTFail("Root tab \(identifier) has no UIKit symbol or label")
        }
        let iconFrame = icon.convert(icon.bounds, to: button)
        let labelFrame = label.convert(label.bounds, to: button)
        XCTAssertGreaterThanOrEqual(button.bounds.width, 44)
        XCTAssertGreaterThanOrEqual(button.bounds.height, 52)
        XCTAssertLessThanOrEqual(iconFrame.width, 23)
        XCTAssertLessThanOrEqual(iconFrame.height, 23)
        XCTAssertGreaterThanOrEqual(iconFrame.minY, 3)
        XCTAssertGreaterThanOrEqual(button.bounds.width - iconFrame.maxX, 3)
        XCTAssertGreaterThanOrEqual(labelFrame.minY - iconFrame.maxY, 2)
        XCTAssertGreaterThanOrEqual(labelFrame.minX, 3)
        XCTAssertGreaterThanOrEqual(button.bounds.width - labelFrame.maxX, 3)
        XCTAssertGreaterThanOrEqual(button.bounds.height - labelFrame.maxY, 3)
        let report: [String: Any] = [
            "identifier": identifier,
            "button": frame(button.bounds),
            "icon": frame(iconFrame),
            "label": frame(labelFrame),
        ]
        do {
            let attachment = try XCTAttachment(data: JSONSerialization.data(withJSONObject: report), uniformTypeIdentifier: "public.json")
            attachment.name = "root-tab-layout-\(identifier)"
            attachment.lifetime = .keepAlways
            add(attachment)
        } catch { XCTFail("Could not preserve the measured layout: \(error)") }
    }

    private func frame(_ rectangle: CGRect) -> [String: Double] {
        ["x": Double(rectangle.minX), "y": Double(rectangle.minY),
         "width": Double(rectangle.width), "height": Double(rectangle.height)]
    }

    @MainActor
    private func visibleView(_ identifier: String) -> UIView? {
        let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
        return windows.flatMap { descendants($0) }.first { view in
            guard view.accessibilityIdentifier == identifier, let window = view.window,
                  !view.bounds.isEmpty else { return false }
            return view.convert(view.bounds, to: window).intersects(window.bounds)
        }
    }

    @MainActor
    private func descendants(_ root: UIView) -> [UIView] {
        // Retained navigation stacks can own hidden toolbars; inspect only the rendered window subtree.
        guard !root.isHidden, root.alpha > 0.01 else { return [] }
        return [root] + root.subviews.flatMap { descendants($0) }
    }
}
