import React
import UIKit

/// UIKit owns swipe recognition and accessible trailing actions; React owns session data and undo.
final class ConversationHistorySurfaceView: UIView, UITableViewDataSource, UITableViewDelegate {
    @objc var rows: NSArray = [] {
        didSet { rebuildSections() }
    }

    @objc var onSelectSession: RCTDirectEventBlock?
    @objc var onDeleteSession: RCTDirectEventBlock?
    private let table = UITableView(frame: .zero, style: .insetGrouped)
    private var sections = [(title: String, rows: [[String: Any]])]()

    override init(frame: CGRect) {
        super.init(frame: frame)
        table.dataSource = self
        table.delegate = self
        table.backgroundColor = .clear
        // History uses the requested physical right-to-left deletion gesture in every locale.
        table.semanticContentAttribute = .forceLeftToRight
        table.contentInsetAdjustmentBehavior = .never
        table.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 0, leading: 24, bottom: 0, trailing: 24)
        table.estimatedRowHeight = 82
        table.rowHeight = UITableView.automaticDimension
        table.sectionHeaderTopPadding = 0
        addSubview(table)
    }

    @available(*, unavailable)
    required init?(coder _: NSCoder) {
        fatalError("Created by React Native")
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        table.frame = bounds
    }

    private func rebuildSections() {
        sections = []
        for row in rows {
            guard let row = row as? [String: Any], let title = row["section"] as? String else { continue }
            if sections.last?.title == title {
                sections[sections.count - 1].rows.append(row)
            } else {
                sections.append((title, [row]))
            }
        }
        table.reloadData()
    }

    func numberOfSections(in _: UITableView) -> Int {
        sections.count
    }

    func tableView(_: UITableView, numberOfRowsInSection section: Int) -> Int {
        sections[section].rows.count
    }

    func tableView(_: UITableView, titleForHeaderInSection section: Int) -> String? {
        sections[section].title
    }

    func tableView(_ tableView: UITableView, cellForRowAt indexPath: IndexPath) -> UITableViewCell {
        let row = sections[indexPath.section].rows[indexPath.row]
        let cell = tableView.dequeueReusableCell(withIdentifier: "conversation") ?? UITableViewCell(style: .subtitle, reuseIdentifier: "conversation")
        // Content configuration owns the vertical insets, so automatic sizing follows Dynamic Type.
        var content = cell.defaultContentConfiguration()
        content.text = row["title"] as? String
        content.textProperties.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: .systemFont(ofSize: 16, weight: .semibold))
        content.textProperties.numberOfLines = 2
        content.secondaryText = row["time"] as? String
        content.secondaryTextProperties.font = UIFontMetrics(forTextStyle: .caption1).scaledFont(for: .systemFont(ofSize: 13))
        content.secondaryTextProperties.color = .secondaryLabel
        content.image = UIImage(systemName: "bubble.left", withConfiguration: UIImage.SymbolConfiguration(pointSize: 20))
        content.imageProperties.tintColor = .secondaryLabel
        content.directionalLayoutMargins = NSDirectionalEdgeInsets(top: 20, leading: 20, bottom: 20, trailing: 20)
        cell.contentConfiguration = content
        cell.accessoryType = .disclosureIndicator
        cell.backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 28 / 255, green: 34 / 255, blue: 42 / 255, alpha: 1) : .white }
        cell.accessibilityIdentifier = "conversation-history-session-\(row["id"] ?? "")"
        cell.accessibilityTraits = row["selected"] as? Bool == true ? [.button, .selected] : [.button]
        return cell
    }

    func tableView(_ tableView: UITableView, didSelectRowAt indexPath: IndexPath) {
        tableView.deselectRow(at: indexPath, animated: true)
        if let id = sections[indexPath.section].rows[indexPath.row]["id"] {
            onSelectSession?(["id": id])
        }
    }

    func tableView(_: UITableView, trailingSwipeActionsConfigurationForRowAt indexPath: IndexPath) -> UISwipeActionsConfiguration? {
        guard let id = sections[indexPath.section].rows[indexPath.row]["id"] else { return nil }
        let action = UIContextualAction(style: .destructive, title: "삭제") { [weak self] _, _, complete in
            self?.onDeleteSession?(["id": id])
            complete(true)
        }
        action.image = UIImage(systemName: "trash")
        let configuration = UISwipeActionsConfiguration(actions: [action])
        // A full trailing swipe commits the same reversible deletion as the exposed action.
        configuration.performsFirstActionWithFullSwipe = true
        return configuration
    }
}

@objc(ConversationHistoryViewManager)
final class ConversationHistoryViewManager: RCTViewManager {
    override static func requiresMainQueueSetup() -> Bool {
        true
    }

    override func view() -> UIView! {
        ConversationHistorySurfaceView()
    }
}
