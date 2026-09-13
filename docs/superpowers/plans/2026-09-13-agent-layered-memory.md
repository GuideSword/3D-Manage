# Agent Layered Memory and Image Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound Agent context growth with Letta-style layered memory while retaining complete visible history, optional semantic recall, and secure on-demand access to prior conversation images.

**Architecture:** Persist raw messages and attachments as source-of-truth, then build model context through a dedicated budgeted assembler using core memory, one rolling summary, optional archive retrieval, and a recent window. Keep vector recall optional by providing FTS5 and normalized keyword fallbacks. Store image binaries outside SQLite and only rehydrate them through an ownership-checked recall tool.

**Tech Stack:** Express 5, better-sqlite3/SQLite FTS5, Node.js filesystem and crypto, Zod, existing OpenAI-compatible LLM and optional MiniMax Embedding provider, Node.js test runner.

---

## File map

- Create `backend/agent/contextBudget.js`: deterministic token estimation, turn grouping, tool-result clipping, and budget reduction.
- Create `backend/agent/memoryService.js`: rolling summary orchestration, core-memory validation, archival passage creation, and fallback policy.
- Create `backend/agent/archiveSearch.js`: Embedding, FTS5, and normalized keyword retrieval with one result shape.
- Create `backend/agent/attachmentStore.js`: safe attachment writes, reads, ownership checks, and cleanup queue.
- Create `backend/agent/tools/memory.js`: constrained core-memory proposal and prior-image recall tools.
- Modify `backend/db/migrations.js`, `backend/db/schema.sql`, and `backend/db/agent.js`: memory, passage, message sequence, and attachment persistence.
- Modify `backend/routes/agent.js`: persist validated incoming images, authenticated attachment reads, and transactional conversation cleanup.
- Modify `backend/agent/orchestrator.js`: persist attachment references only after safe file preparation, call the context assembler instead of sending all history, and expose safe memory tools.
- Modify `backend/agent/tools/index.js`: conditionally register memory/image tools.
- Modify `backend/config/storage.js`: initialize the private Agent attachment directory.
- Modify `deploy/backup.ps1`, `deploy/backup.sh`, `deploy/restore.ps1`, `deploy/restore.sh`, `docs/BACKUP_RESTORE.md`, and `docs/AGENT_DESIGN.md`: include and verify attachment lifecycle.
- Create `tests/backend/agent-db-migrations.test.cjs`, `tests/backend/agent-attachments.test.cjs`, `tests/backend/agent-context-budget.test.cjs`, `tests/backend/agent-memory.test.cjs`, and `tests/backend/agent-memory-integration.test.cjs`.

### Task 1: Add restart-safe memory and attachment schema

**Files:**
- Modify: `backend/db/schema.sql`
- Modify: `backend/db/migrations.js`
- Modify: `backend/db/agent.js`
- Create: `tests/backend/agent-db-migrations.test.cjs`

- [ ] **Step 1: Write a failing migration test**

Create a version-2 database with settings, one conversation, and messages sharing the same timestamp. Run migrations and assert every message receives a stable positive sequence, uniqueness is enforced within the conversation, raw JSON is unchanged, and all new tables exist. Run migrations twice and compare row counts.

- [ ] **Step 2: Run and verify red**

Run: `node --test tests/backend/agent-db-migrations.test.cjs`

Expected: FAIL because migration version 3 and new tables do not exist.

- [ ] **Step 3: Add schema version 3**

Add `sequence INTEGER` and `context_state TEXT NOT NULL DEFAULT 'active'` to messages, backfill sequence deterministically by `created_at, rowid`, and create `UNIQUE(conversation_id, sequence)`. Add these tables:

```sql
CREATE TABLE conversation_summaries (
  conversation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  summary_version INTEGER NOT NULL DEFAULT 1,
  summarized_through_sequence INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('ready','error')),
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE core_memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('user_preferences','business_constraints','active_goals')),
  content TEXT NOT NULL,
  source_message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded','deleted')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE archival_passages (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  text TEXT NOT NULL,
  topic TEXT NOT NULL DEFAULT '',
  source_sequence_start INTEGER NOT NULL,
  source_sequence_end INTEGER NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
);

CREATE TABLE archival_embeddings (
  passage_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  embedding TEXT NOT NULL,
  vector_dim INTEGER NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(passage_id, user_id, config_fingerprint),
  FOREIGN KEY(passage_id) REFERENCES archival_passages(id) ON DELETE CASCADE
);

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','missing','delete_pending')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE attachment_cleanup_queue (
  attachment_id TEXT PRIMARY KEY,
  storage_name TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Attempt to create `archival_passages_fts` with FTS5 inside the migration. If SQLite reports `no such module: fts5`, persist capability `fts5_available = 0` in a small `agent_capabilities` table and continue. Set `PRAGMA user_version = 3` only after the transaction succeeds.

- [ ] **Step 4: Add sequence-aware data functions**

`addMessage` must allocate `MAX(sequence) + 1` inside a transaction. Add functions for recent messages, messages by sequence range, summary upsert/get, core-memory CRUD, passage CRUD, FTS capability, attachment metadata, and cleanup queue. Every read that handles user-owned memory must require `userId` in its SQL predicate.

- [ ] **Step 5: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: all migrations are idempotent and existing Agent tests remain green.

```powershell
git add -- backend/db/schema.sql backend/db/migrations.js backend/db/agent.js tests/backend/agent-db-migrations.test.cjs
git commit -m "feat(agent): add layered memory persistence"
```

### Task 2: Store conversation images outside SQLite

**Files:**
- Modify: `backend/config/storage.js`
- Create: `backend/agent/attachmentStore.js`
- Modify: `backend/routes/agent.js`
- Modify: `backend/agent/orchestrator.js`
- Create: `tests/backend/agent-attachments.test.cjs`

- [ ] **Step 1: Write failing attachment tests**

Use temporary `UPLOAD_DIR` and Agent DB directories. Test valid PNG storage under `uploads/agent`, UUID-only storage names, metadata ownership, duplicate content still receiving distinct attachment IDs, read denial for another user/conversation, rejection of `../` storage names, and cleanup queue insertion when a mocked unlink fails.

- [ ] **Step 2: Run and verify red**

Run: `node --test tests/backend/agent-attachments.test.cjs`

Expected: FAIL because `attachmentStore.js` is missing.

- [ ] **Step 3: Implement safe filesystem boundaries**

Export this interface:

```js
module.exports = {
  prepareMessageImages,
  discardPreparedImages,
  readOwnedAttachment,
  deleteConversationAttachments,
  retryPendingAttachmentCleanup,
};
```

Resolve every generated file against `path.resolve(UPLOAD_DIR, 'agent')` and verify it stays below that root before I/O. Derive `.png`, `.jpg`, or `.webp` only from the server-validated MIME. Write to a same-directory temporary UUID and rename atomically. `prepareMessageImages` writes files and returns metadata without touching SQLite; `discardPreparedImages` removes only paths generated by that preparation result.

- [ ] **Step 4: Persist references instead of data URLs**

After `/agent/chat` validates images, pass decoded images to `runConversation`. Once the orchestrator has created or loaded the conversation and generated the user message ID, call `prepareMessageImages`. In one SQLite transaction, insert the user message and its attachment metadata in foreign-key order. If that transaction fails, call `discardPreparedImages`; if file preparation fails, insert neither message nor metadata. Persist the user message using content parts such as:

```js
{ type: 'image_attachment', attachment_id: id, name, mime_type: mimeType, byte_size: byteSize }
```

Construct transient model-only `image_url` parts from the newly received buffers. Assert no `data:image/` prefix exists anywhere in the persisted message JSON.

- [ ] **Step 5: Add an authenticated attachment response**

Add `GET /conversations/:conversationId/attachments/:attachmentId` under the authenticated Agent router. Resolve ownership through `readOwnedAttachment`, set the validated content type, `Cache-Control: private, no-store`, and `Content-Disposition: inline`; return 404 for both missing and foreign attachments.

- [ ] **Step 6: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: attachment tests PASS and Agent DB contains no Base64.

```powershell
git add -- backend/config/storage.js backend/agent/attachmentStore.js backend/routes/agent.js backend/agent/orchestrator.js tests/backend/agent-attachments.test.cjs
git commit -m "feat(agent): persist private conversation image attachments"
```

### Task 3: Build a deterministic context budgeter

**Files:**
- Create: `backend/agent/contextBudget.js`
- Create: `tests/backend/agent-context-budget.test.cjs`

- [ ] **Step 1: Write failing budget tests**

Cover Chinese estimation, ASCII estimation, 20% envelope, grouping tool calls/results with their assistant turn, retaining 10 latest rounds under budget, dropping archive entries before recent turns, trimming recent turns while preserving at least 3, and never dropping system/core/current messages.

The core assertion should resemble:

```js
const result = assembleBudgetedContext({
  systemMessages,
  coreMemory,
  summary,
  archiveMatches: fiveLargeMatches,
  recentRounds: twelveRounds,
  currentMessage,
  maxInputTokens: 12000,
});
assert.ok(result.estimatedTokens <= 12000);
assert.equal(result.recentRoundsKept >= 3, true);
assert.equal(result.messages.at(-1), currentMessage);
```

- [ ] **Step 2: Run and verify red**

Run: `node --test tests/backend/agent-context-budget.test.cjs`

Expected: FAIL because the context budget module is missing.

- [ ] **Step 3: Implement the estimator and assembler**

Estimate every CJK code point as one token, non-CJK text as `Math.ceil(chars / 4)`, JSON after serialization, then multiply the subtotal by `1.2`. `groupConversationRounds` must keep assistant tool calls and matching tool messages together. `clipToolResult` must preserve `id`, `name`, status/count fields, and a bounded error while removing oversized payload fields from model context only.

`assembleBudgetedContext` follows the approved priority: system, core, summary, archives, recent, current. If over budget, remove least relevant archives, then oldest recent rounds down to three. If mandatory content alone exceeds the budget, clip summary to 6,000 characters and core memory to 4,000 characters and return an `overBudget` diagnostic without altering stored data.

- [ ] **Step 4: Run tests and commit**

Run: `node --test tests/backend/agent-context-budget.test.cjs`

Expected: PASS.

```powershell
git add -- backend/agent/contextBudget.js tests/backend/agent-context-budget.test.cjs
git commit -m "feat(agent): bound model context assembly"
```

### Task 4: Add structured rolling summaries and controlled core memory

**Files:**
- Create: `backend/agent/memoryService.js`
- Create: `backend/agent/tools/memory.js`
- Modify: `backend/agent/tools/index.js`
- Create: `tests/backend/agent-memory.test.cjs`

- [ ] **Step 1: Write failing summary tests**

Inject a fake summarizer and test first summary, incremental merge through a later sequence, exact JSON Schema rejection, 6,000-character limit, failure preserving the previous ready summary, and an idempotent retry that does not summarize the same sequence twice.

- [ ] **Step 2: Write failing core-memory validation tests**

Test that only `user_preferences`, `business_constraints`, and `active_goals` are accepted; source message must belong to the current user; speculative content is rejected unless the cited user message contains the normalized fact; superseding keeps the old audit row; total active text never exceeds 4,000 characters.

- [ ] **Step 3: Run and verify red**

Run: `node --test tests/backend/agent-memory.test.cjs`

Expected: FAIL because memory service and tool are missing.

- [ ] **Step 4: Implement strict summary generation**

Define the Zod schema:

```js
const summarySchema = z.object({
  conversation_goal: z.string().max(1000),
  confirmed_facts: z.array(z.string().max(500)).max(20),
  decisions: z.array(z.string().max(500)).max(20),
  pending_items: z.array(z.string().max(500)).max(20),
  important_tool_results: z.array(z.string().max(500)).max(15),
  image_references: z.array(z.object({ attachment_id: z.string().uuid(), description: z.string().max(500) })).max(12),
}).strict();
```

`ensureRollingSummary` only selects messages after `summarized_through_sequence` and before the recent 10-round boundary. It asks the configured LLM for JSON, validates before writing, creates archival passages for content leaving the active window, marks covered messages `summarized`, and commits summary/passage/state changes in one SQLite transaction.

- [ ] **Step 5: Implement the constrained memory proposal tool**

Expose `propose_core_memory_change` with fixed action/category/content/source message ID parameters. The handler calls `memoryService.applyCoreMemoryCandidate`; it never accepts SQL, arbitrary field names, or a user ID argument. Add a system-prompt rule that the tool is only for explicitly stated stable facts, not inferred traits or live order/inventory facts.

- [ ] **Step 6: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: summary and core-memory tests PASS.

```powershell
git add -- backend/agent/memoryService.js backend/agent/tools/memory.js backend/agent/tools/index.js tests/backend/agent-memory.test.cjs
git commit -m "feat(agent): add structured summaries and core memory"
```

### Task 5: Add optional archive retrieval with deterministic fallbacks

**Files:**
- Create: `backend/agent/archiveSearch.js`
- Modify: `backend/agent/memoryService.js`
- Modify: `backend/db/agent.js`
- Modify: `tests/backend/agent-memory.test.cjs`

- [ ] **Step 1: Write failing retrieval tests**

Seed passages for two users and two conversations. Verify semantic top-five ordering when Embedding is configured, dimension mismatch exclusion, FTS5 results when Embedding fails or is disabled, normalized keyword results when FTS5 is unavailable, and identical public result keys across all three strategies.

- [ ] **Step 2: Run and verify red**

Run: `node --test tests/backend/agent-memory.test.cjs`

Expected: FAIL because archive search is not implemented.

- [ ] **Step 3: Implement one retrieval contract**

Every strategy returns:

```js
{
  id,
  conversationId,
  text,
  topic,
  sourceSequenceStart,
  sourceSequenceEnd,
  score,
  strategy: 'embedding' | 'fts5' | 'keyword',
}
```

`searchArchive({ userId, query, embeddingConfig, limit = 5 })` first attempts same-user/same-fingerprint embeddings. Any provider/config/index failure is contained and falls back to FTS5. FTS5 queries must bind user ID and escaped terms; keyword fallback lowercases and Unicode-normalizes query/passages and ranks by matched distinct terms plus recency. Never search another user's rows.

- [ ] **Step 4: Index summaries without making Embedding mandatory**

After a passage is committed, queue an embedding only if the current user has enabled, tested configuration. A failure leaves the passage searchable by text and records no blocking error. Configuration changes create new fingerprint rows lazily; old rows are ignored and may be cleaned later.

- [ ] **Step 5: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: all memory retrieval tests PASS.

```powershell
git add -- backend/agent/archiveSearch.js backend/agent/memoryService.js backend/db/agent.js tests/backend/agent-memory.test.cjs
git commit -m "feat(agent): retrieve archived memory with text fallback"
```

### Task 6: Assemble layered context in the orchestrator

**Files:**
- Modify: `backend/agent/orchestrator.js`
- Modify: `backend/agent/tools/index.js`
- Modify: `backend/agent/tools/memory.js`
- Modify: `backend/routes/agent.js`
- Create: `tests/backend/agent-memory-integration.test.cjs`

- [ ] **Step 1: Write a failing 20-round integration test**

Use a fake streaming LLM that records every request. Seed 25 rounds, early confirmed facts, a tool result, and one attachment. Assert the final model request contains system/core/summary/archive/recent/current in order, stays below the estimator's 12,000-token budget, retains at least three recent rounds, and contains no persisted image data URL.

- [ ] **Step 2: Add failing image recall ownership tests**

Call `recall_conversation_image` for an owned attachment and assert it returns a transient image part for the current turn. Assert a foreign conversation/attachment returns a generic not-found error and never reveals metadata.

- [ ] **Step 3: Run and verify red**

Run: `node --test tests/backend/agent-memory-integration.test.cjs`

Expected: FAIL because the orchestrator still sends every stored message.

- [ ] **Step 4: Replace full-history loading**

Before the main LLM loop:

1. Ensure a rolling summary if unsummarized history exceeds 10 rounds or estimated input exceeds 12,000 tokens.
2. Load active core memories.
3. Search archives for the current user message.
4. Load the latest 10 complete rounds.
5. Pass all layers to `assembleBudgetedContext`.

Use the resulting messages instead of `sqliteDb.getMessages(conv.id)`. Preserve the existing tool-call loop by appending current-turn assistant/tool messages in memory and persisting their raw forms separately.

- [ ] **Step 5: Add safe prior-image recall**

Register `recall_conversation_image` only when the current conversation has attachments. The handler takes only `attachment_id`, injects `userId` and `conversationId` from context, reads through `attachmentStore`, and returns a special internal result that the orchestrator converts to a temporary `image_url` part. Never serialize the resulting Base64 into the tool message stored in SQLite; persist only `{ attachment_id, recalled: true }`.

- [ ] **Step 6: Attach first-turn image descriptions**

After the first image response completes, set each new attachment's description from a sanitized, 500-character excerpt of the assistant's visible answer. Later summary generation may refine the text, but must retain the attachment ID.

- [ ] **Step 7: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: layered context and image recall integration tests PASS.

```powershell
git add -- backend/agent/orchestrator.js backend/agent/tools/index.js backend/agent/tools/memory.js backend/routes/agent.js tests/backend/agent-memory-integration.test.cjs
git commit -m "feat(agent): assemble bounded layered conversation context"
```

### Task 7: Make conversation deletion and attachment recovery complete

**Files:**
- Modify: `backend/routes/agent.js`
- Modify: `backend/agent/attachmentStore.js`
- Modify: `backend/server.js`
- Modify: `tests/backend/agent-attachments.test.cjs`

- [ ] **Step 1: Add failing lifecycle tests**

Delete a conversation with two attachments and assert DB rows and files disappear. Mock one unlink failure and assert the row is queued, the route still returns a truthful `cleanupPending: true`, another user's files remain untouched, and `retryPendingAttachmentCleanup` removes the pending item after recovery.

- [ ] **Step 2: Run and verify red**

Run: `node --test tests/backend/agent-attachments.test.cjs`

Expected: FAIL because current conversation deletion only removes SQLite rows.

- [ ] **Step 3: Implement deletion ordering**

Resolve and snapshot owned attachment metadata first. Delete the conversation and dependent DB rows transactionally, then unlink only the validated snapshot paths. Enqueue failed unlinks with generated storage names. Return `{ deleted: true, cleanupPending }` without exposing filenames.

- [ ] **Step 4: Resume cleanup at startup**

After Agent DB and storage readiness complete, call `retryPendingAttachmentCleanup({ limit: 25 })`. Failures should be logged only as counts/error categories and must not prevent the server from becoming ready.

- [ ] **Step 5: Run tests and commit**

Run: `npm --prefix backend run test:agent`

Expected: attachment lifecycle tests PASS.

```powershell
git add -- backend/routes/agent.js backend/agent/attachmentStore.js backend/server.js tests/backend/agent-attachments.test.cjs
git commit -m "feat(agent): clean conversation attachments safely"
```

### Task 8: Extend backup, restore, and operational verification

**Files:**
- Modify: `deploy/backup.ps1`
- Modify: `deploy/backup.sh`
- Modify: `deploy/restore.ps1`
- Modify: `deploy/restore.sh`
- Modify: `docs/BACKUP_RESTORE.md`
- Modify: `docs/AGENT_DESIGN.md`
- Modify: `backend/scripts/verify-agent-db.js`
- Modify: `tests/ops/docker-backend-scripts.verify.ps1`

- [ ] **Step 1: Add failing operational assertions**

Extend the PowerShell verification to require the backup archive allowlist to include `uploads/agent/**`, reject traversal/symlink entries there, and ensure restore staging accepts only `data/**` and `uploads/**`. Extend Agent DB verification to validate attachment ownership relations, missing files, pending cleanup rows, summary JSON, sequence uniqueness, and vector dimensions.

- [ ] **Step 2: Run and verify red**

Run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/docker-backend-scripts.verify.ps1
npm --prefix backend run agent:verify
```

Expected: FAIL on the newly required Agent attachment/memory checks.

- [ ] **Step 3: Update backup/restore behavior and documentation**

The existing archive already includes the `uploads` tree; preserve that behavior and explicitly validate `uploads/agent`. Document that Agent SQLite, conversation attachments, summaries, and cleanup state are one recovery unit. Restore must stage and validate the full archive before replacing runtime data.

- [ ] **Step 4: Run operational checks and commit**

Run the two commands from Step 2.

Expected: PASS.

```powershell
git add -- deploy/backup.ps1 deploy/backup.sh deploy/restore.ps1 deploy/restore.sh docs/BACKUP_RESTORE.md docs/AGENT_DESIGN.md backend/scripts/verify-agent-db.js tests/ops/docker-backend-scripts.verify.ps1
git commit -m "docs(agent): cover layered memory backup and recovery"
```

### Task 9: Full layered-memory acceptance run

**Files:**
- Verify only: no planned file changes.

- [ ] **Step 1: Run the complete automated suite**

Run:

```powershell
npm run verify:client
npm run verify:agent-client
npm --prefix backend run test:agent
npm run verify:backend
npm --prefix backend run agent:verify
powershell -NoProfile -ExecutionPolicy Bypass -File tests/ops/docker-backend-scripts.verify.ps1
npx expo export --platform web --output-dir .tmp/agent-memory-web
```

Expected: every command exits 0.

- [ ] **Step 2: Run a long-conversation acceptance fixture**

Create 25 turns through the integration harness, including an early stable preference, an early decision, a later contradictory live business lookup, and one image. Capture model input estimates for turns 10, 20, and 25.

Expected:

- Turn 25 remains at or below 12,000 estimated input tokens.
- The early preference is available through core memory.
- The early decision is available through summary/archive.
- Live tool data wins over stale memory.
- No model request after the image's original turn includes that image unless recall is explicitly invoked.

- [ ] **Step 3: Verify Embedding-off behavior**

Disable Embedding, restart the backend, continue the same conversation, and ask about an archived early fact.

Expected: the answer is supported by FTS5 or keyword retrieval; no Embedding call occurs and chat remains functional.

- [ ] **Step 4: Verify deletion and restore**

Back up a runtime containing a conversation attachment, restore it into the isolated rehearsal target, verify authenticated attachment recall works, then delete the conversation and verify its files are removed without affecting other conversations.

- [ ] **Step 5: Final cleanup commit only if acceptance fixes were necessary**

Run:

```powershell
rg -n "\[DEBUG-|data:image/" backend/data backend/agent backend/routes --glob '!**/*.test.*'
git diff --check
```

Expected: no debug instrumentation, no persisted Base64 fixture, and no whitespace errors. If acceptance required scoped fixes, commit only those files with `git commit -m "fix(agent): close layered memory acceptance gaps"`; otherwise make no empty commit.
