@testable import Orot
import UIKit
import XCTest

/// Keeps the acceptance target independent from the production value under test.
private enum CompactSymbolAcceptance {
    static let pointSize: CGFloat = 18
}

/// Captures UIKit symbol geometry and composer material policy while keeping touch targets larger than glyphs.
final class AppSymbolSizingIntegrationTests: OrotFailFastTestCase {
    @MainActor
    func testCompactSymbolsAndComposerGlassRespectNativeAppearanceAndTransparency() throws {
        ComposerGlassSurfaceTestAssertions.assertReduceTransparencyFallback()

        let symbols = ["plus", "sparkles", "pencil", "gearshape", "doc.text", "arrow.up", "stop.fill"]
        var sizesByAppearance: [String: [String: CGSize]] = [:]

        for appearance in [UIUserInterfaceStyle.light, .dark] {
            let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
            let previousKeyWindow = scene.windows.first(where: \.isKeyWindow)
            let window = UIWindow(windowScene: scene)
            window.frame = scene.effectiveGeometry.coordinateSpace.bounds
            window.overrideUserInterfaceStyle = appearance
            let controller = UIViewController()
            controller.view.backgroundColor = .systemBackground
            window.rootViewController = controller
            window.makeKeyAndVisible()
            defer {
                window.isHidden = true
                previousKeyWindow?.makeKey()
            }

            let bodyRow = UIStackView()
            bodyRow.axis = .horizontal
            bodyRow.alignment = .top
            bodyRow.spacing = 8
            var bodyIcons: [String: AppSymbolView] = [:]
            for name in symbols {
                let cell = UIStackView()
                cell.axis = .vertical
                cell.alignment = .center
                cell.spacing = 4
                let target = UIButton(type: .system)
                target.translatesAutoresizingMaskIntoConstraints = false
                target.accessibilityLabel = "\(name) example"
                target.backgroundColor = .secondarySystemBackground
                target.layer.cornerRadius = 12
                let icon = AppSymbolView()
                icon.symbolName = name
                icon.tintColor = .systemBlue
                icon.translatesAutoresizingMaskIntoConstraints = false
                target.addSubview(icon)
                NSLayoutConstraint.activate([
                    target.widthAnchor.constraint(equalToConstant: 44),
                    target.heightAnchor.constraint(equalToConstant: 44),
                    icon.widthAnchor.constraint(equalToConstant: CompactSymbolAcceptance.pointSize),
                    icon.heightAnchor.constraint(equalToConstant: CompactSymbolAcceptance.pointSize),
                    icon.centerXAnchor.constraint(equalTo: target.centerXAnchor),
                    icon.centerYAnchor.constraint(equalTo: target.centerYAnchor),
                ])
                let label = UILabel()
                label.text = name
                label.font = .systemFont(ofSize: 9)
                label.textColor = .secondaryLabel
                label.textAlignment = .center
                cell.addArrangedSubview(target)
                cell.addArrangedSubview(label)
                bodyRow.addArrangedSubview(cell)
                bodyIcons[name] = icon
                XCTAssertEqual(target.accessibilityLabel, "\(name) example")
                XCTAssertFalse(icon.isAccessibilityElement, "The parent control supplies the VoiceOver name")
            }

            let rootSurface = NavigationGlassSurfaceView(frame: .zero)
            rootSurface.actions = symbols.enumerated().map { index, symbol in
                [
                    "id": "tab-\(symbol)", "label": symbol,
                    "accessibilityLabel": "\(symbol) tab", "testID": "navigation-gallery-\(index)",
                    "systemImageName": symbol, "rootTab": true,
                    "selected": index == 0, "busy": symbol == "sparkles", "disabled": symbol == "gearshape",
                ] as [String: Any]
            } as NSArray
            let contextualSurface = NavigationGlassSurfaceView(frame: .zero)
            contextualSurface.actions = [
                ["id": "page:add", "label": "Add", "accessibilityLabel": "Add action", "testID": "navigation-add",
                 "systemImageName": "plus", "busy": true],
                ["id": "page:edit", "label": "Edit", "accessibilityLabel": "Edit action", "testID": "navigation-edit",
                 "systemImageName": "pencil", "disabled": true],
            ] as NSArray

            let page = UIStackView(arrangedSubviews: [bodyRow, rootSurface, contextualSurface])
            page.translatesAutoresizingMaskIntoConstraints = false
            page.axis = .vertical
            page.alignment = .center
            page.spacing = 18
            controller.view.addSubview(page)
            NSLayoutConstraint.activate([
                page.centerXAnchor.constraint(equalTo: controller.view.centerXAnchor),
                page.topAnchor.constraint(equalTo: controller.view.safeAreaLayoutGuide.topAnchor, constant: 24),
                bodyRow.widthAnchor.constraint(lessThanOrEqualTo: controller.view.widthAnchor, constant: -24),
                rootSurface.widthAnchor.constraint(equalTo: controller.view.widthAnchor, constant: -24),
                rootSurface.heightAnchor.constraint(equalToConstant: 60),
                contextualSurface.widthAnchor.constraint(equalTo: controller.view.widthAnchor, constant: -24),
                contextualSurface.heightAnchor.constraint(equalToConstant: 60),
            ])
            controller.view.layoutIfNeeded()
            page.layoutIfNeeded()

            XCTAssertEqual(window.traitCollection.userInterfaceStyle, appearance)
            let rootBar = try XCTUnwrap(rootSurface.subviews.compactMap { $0 as? NavigationRootGlassBar }.first)
            rootBar.layoutIfNeeded()
            let rootStack = try XCTUnwrap(rootBar.contentView.subviews.compactMap { $0 as? UIStackView }.first)
            let rootButtons = rootStack.arrangedSubviews.compactMap { $0 as? UIButton }
            XCTAssertEqual(rootButtons.count, symbols.count)
            let actionStack = try XCTUnwrap(contextualSurface.subviews.compactMap { $0 as? UIStackView }.first)
            let actionButtons = actionStack.arrangedSubviews.compactMap { $0 as? UIButton }
            XCTAssertEqual(actionButtons.count, 2)

            var appearanceSizes: [String: CGSize] = [:]
            var measurements: [String: [String: Double]] = [:]
            for (index, name) in symbols.enumerated() {
                let bodyIcon = try XCTUnwrap(bodyIcons[name])
                let rootButton = rootButtons[index]
                let rootIcon = try XCTUnwrap(AppSymbolSizingTestAssertions.firstImageView(in: rootButton))
                let target = try XCTUnwrap(bodyIcon.superview as? UIButton)
                XCTAssertEqual(bodyIcon.pointSize, NSNumber(value: Double(CompactSymbolAcceptance.pointSize)))
                XCTAssertGreaterThanOrEqual(target.bounds.width, 44)
                XCTAssertGreaterThanOrEqual(target.bounds.height, 44)
                XCTAssertGreaterThanOrEqual(rootButton.bounds.width, 44)
                XCTAssertEqual(rootButton.bounds.height, 52, accuracy: 0.5)
                XCTAssertEqual(rootButton.accessibilityLabel, "\(name) tab")
                XCTAssertTrue(rootButton.accessibilityTraits.contains(.button))
                XCTAssertEqual(rootButton.isSelected, index == 0)
                XCTAssertEqual(rootButton.accessibilityTraits.contains(.selected), index == 0)
                XCTAssertFalse(rootIcon.isAccessibilityElement)

                // A point-size request can differ from the rendered glyph mask; measure the pixels UIKit draws.
                let bodyBounds = try XCTUnwrap(AppSymbolSizingTestAssertions.visibleGlyphBounds(in: bodyIcon))
                let rootBounds = try XCTUnwrap(AppSymbolSizingTestAssertions.visibleGlyphBounds(in: rootIcon))
                XCTAssertGreaterThan(bodyBounds.width, 0, "UIKit did not draw \(name)")
                XCTAssertGreaterThan(bodyBounds.height, 0, "UIKit did not draw \(name)")
                XCTAssertLessThanOrEqual(bodyBounds.width, CompactSymbolAcceptance.pointSize + 0.5)
                XCTAssertLessThanOrEqual(bodyBounds.height, CompactSymbolAcceptance.pointSize + 0.5)
                XCTAssertEqual(bodyBounds.width, rootBounds.width, accuracy: 0.5, "Body and root \(name) glyph widths should match")
                XCTAssertEqual(bodyBounds.height, rootBounds.height, accuracy: 0.5, "Body and root \(name) glyph heights should match")
                if name == "arrow.up" || name == "stop.fill" {
                    let composer = ComposerGlassActionView(frame: CGRect(x: -100, y: -100, width: 120, height: 44))
                    composer.busy = name == "stop.fill"
                    controller.view.addSubview(composer)
                    composer.layoutIfNeeded()
                    let button = try XCTUnwrap(composer.subviews.compactMap { $0 as? UIButton }.first)
                    let icon = try XCTUnwrap(AppSymbolSizingTestAssertions.firstImageView(in: button))
                    let composerBounds = try XCTUnwrap(AppSymbolSizingTestAssertions.visibleGlyphBounds(in: icon))
                    XCTAssertTrue(button.isEnabled && button.bounds.size == CGSize(width: 44, height: 44), "\(name) remains enabled with its native hit target")
                    XCTAssertLessThanOrEqual(max(abs(composerBounds.width - bodyBounds.width), abs(composerBounds.height - bodyBounds.height)), 0.5, "\(name): composer \(composerBounds) differs from body \(bodyBounds)")
                    if name == "arrow.up" {
                        composer.disabled = true
                        XCTAssertTrue(!button.isEnabled && button.bounds.size == CGSize(width: 44, height: 44), "Disabled send stays unavailable without shrinking its hit target")
                    }
                }
                appearanceSizes[name] = CGSize(width: bodyBounds.width, height: bodyBounds.height)
                measurements[name] = ["bodyWidth": Double(bodyBounds.width), "bodyHeight": Double(bodyBounds.height),
                                      "rootWidth": Double(rootBounds.width), "rootHeight": Double(rootBounds.height)]
            }

            XCTAssertEqual(rootButtons[1].accessibilityValue, "진행 중")
            XCTAssertTrue(rootButtons[1].isEnabled)
            XCTAssertFalse(rootButtons[3].isEnabled)
            XCTAssertTrue(rootButtons[3].accessibilityTraits.contains(.notEnabled))
            for (index, button) in actionButtons.enumerated() {
                XCTAssertGreaterThanOrEqual(button.bounds.width, 44)
                XCTAssertEqual(button.bounds.height, 48, accuracy: 0.5)
                XCTAssertTrue(button.accessibilityTraits.contains(.button))
                XCTAssertEqual(button.accessibilityLabel, index == 0 ? "Add action" : "Edit action")
                XCTAssertEqual(button.accessibilityValue, index == 0 ? "진행 중" : nil)
                XCTAssertEqual(button.isEnabled, index == 0)
                XCTAssertEqual(button.accessibilityTraits.contains(.notEnabled), index != 0)
            }
            for (index, name) in ["plus", "pencil"].enumerated() {
                let icon = try XCTUnwrap(AppSymbolSizingTestAssertions.firstImageView(in: actionButtons[index]))
                let bodyIcon = try XCTUnwrap(bodyIcons[name])
                let bodyBounds = try XCTUnwrap(AppSymbolSizingTestAssertions.visibleGlyphBounds(in: bodyIcon))
                let actionBounds = try XCTUnwrap(AppSymbolSizingTestAssertions.visibleGlyphBounds(in: icon))
                XCTAssertEqual(bodyBounds.width, actionBounds.width, accuracy: 0.5, "Body and contextual \(name) glyph widths should match")
                XCTAssertEqual(bodyBounds.height, actionBounds.height, accuracy: 0.5, "Body and contextual \(name) glyph heights should match")
                measurements[name]?["actionWidth"] = Double(actionBounds.width)
                measurements[name]?["actionHeight"] = Double(actionBounds.height)
            }

            sizesByAppearance[appearance == .dark ? "dark" : "light"] = appearanceSizes
            let screenshot = UIGraphicsImageRenderer(bounds: window.bounds).image { context in
                window.layer.render(in: context.cgContext)
            }
            let attachment = XCTAttachment(image: screenshot)
            attachment.name = "compact-symbol-gallery-\(appearance == .dark ? "dark" : "light")"
            attachment.lifetime = .keepAlways
            add(attachment)
            let data = try JSONSerialization.data(withJSONObject: measurements)
            let measurementsAttachment = XCTAttachment(data: data, uniformTypeIdentifier: "public.json")
            measurementsAttachment.name = "compact-symbol-glyph-bounds-\(appearance == .dark ? "dark" : "light")"
            measurementsAttachment.lifetime = .keepAlways
            add(measurementsAttachment)
        }

        for name in symbols {
            let light = try XCTUnwrap(sizesByAppearance["light"]?[name])
            let dark = try XCTUnwrap(sizesByAppearance["dark"]?[name])
            XCTAssertEqual(light.width, dark.width, accuracy: 0.5, "\(name) should keep its glyph width across appearances")
            XCTAssertEqual(light.height, dark.height, accuracy: 0.5, "\(name) should keep its glyph height across appearances")
        }
    }
}
