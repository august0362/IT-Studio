# chat

Conversations (M4): streaming replies through the router, optional knowledge context, the `generate_image` and
`search_knowledge` tools, cancellation and retry through the process registry.

- **RPC:** `chat.listConversations`, `chat.createConversation`, `chat.getMessages`, `chat.setRagEnabled`,
  `chat.send`, `chat.cancel`.
- **Depends on:** kernel, `settings`, `router` (LLM router), `cost` (ledger), `knowledge` (retriever), `images`
  (image tool), `workflow` (request correlation for the workflow map).
