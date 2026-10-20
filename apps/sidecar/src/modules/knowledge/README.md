# knowledge

Project knowledge (RAG, M5): file discovery and parsing, chunking, embeddings with provider fallback, the
LanceDB vector store, retrieval with MMR, and the `search_knowledge` context for chat.

- **RPC:** `rag.ingest`, `rag.query`, `rag.listDocuments`, `rag.deleteDocument`.
- **Depends on:** kernel (embedding providers, vector store, secret store port), `settings` (RAG settings), `cost`
  (budget, prices, ledger), `router` (model catalog `completed` bus), `workflow` (activity events).
