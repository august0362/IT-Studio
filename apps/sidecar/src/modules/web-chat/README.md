# web-chat

Web chat links (D34): finds installed browsers, opens the configured chat sites in a dedicated browser profile,
and builds a copyable project brief.

- **RPC:** `webchat.browsers`, `webchat.open`, `webchat.projectBrief`.
- **Depends on:** kernel (browser locator and launcher, web-chat domain rules), `settings` (links and layout),
  `projects` (repository and project context for the brief).
