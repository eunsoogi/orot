# Conversation A2UI local scratch surface

Conversation task v23 can admit one local scratch input and reset button at
the end of a coherent, finalized ordinary conversation surface. v20–v22
retain their existing schemas and restore policies. The optional control
suffix uses [A2UI 1.0 Basic Catalog](https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json)
TextField, Button and a Text child. It
admits only the app's fixed labels, one empty initial local string at
`/local/draft`, and the app-owned `orot:reset-local-draft` action with no
context. Reject mismatches, aliases, extra action parameters, external
functions and unknown handlers. The normal parser still checks the full
ordinary layout and its exact accepted prose.

The renderer can mount the controls only for the exact current completed
assistant response of the active app-owned session. No draft stamp from
the model becomes the real owner. Every native callback rechecks the
current route, app and session. Losing ownership clears the draft and
revokes pending work. The reset button consumes a new gesture receipt
locally and restores the original empty string.

The copy menu, persistence and restored history receive only original
prose and the existing arrangement skeleton. No field contents, action
event or binding is logged, stored, put in conversation history or sent
to any provider. Other templates and ordinary responses are unchanged.
