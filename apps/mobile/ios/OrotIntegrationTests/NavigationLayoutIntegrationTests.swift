@testable import Orot
import UIKit
import XCTest

final class NavigationLayoutIntegrationTests: OrotFailFastTestCase {
    @MainActor
    func testDisabledAccessibilityTracksUIKitStateAndPreservesSelectionAcrossUpdates() throws {
        let surface = NavigationGlassSurfaceView(frame: CGRect(x: 0, y: 0, width: 386, height: 48))
        // Exercise the real production constructor without a fabricated AX snapshot or a JS-only disabled assertion.
        for (disabled, selected) in [(true, false), (false, true), (true, true), (false, false)] {
            surface.actions = [[
                "id": "primary", "label": "Synthetic action", "testID": "synthetic-navigation-action",
                "accessibilityLabel": "Synthetic action", "primary": true,
                "disabled": disabled, "selected": selected,
            ]] as NSArray
            let toolbar = try XCTUnwrap(surface.subviews.compactMap { $0 as? UIToolbar }.first)
            let group = try XCTUnwrap(toolbar.items?.compactMap(\.customView).compactMap { $0 as? UIStackView }.first)
            let button = try XCTUnwrap(group.arrangedSubviews.compactMap { $0 as? UIButton }.first)
            XCTAssertEqual(button.isEnabled, !disabled)
            XCTAssertTrue(button.accessibilityTraits.contains(.button))
            XCTAssertEqual(button.accessibilityTraits.contains(.notEnabled), disabled)
            XCTAssertEqual(button.accessibilityTraits.contains(.selected), selected)
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
        XCTAssertGreaterThanOrEqual(button.bounds.height, 44)
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
