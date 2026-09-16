/**
 * Embedded (standalone) storage backend.
 *
 * Keeps the complete InnerLore store inside the chat's own JSONL metadata —
 * the same place the extension kept state before the SQLite server plugin
 * existed. SillyTavern persists chat metadata with the chat file, so state is
 * branch-aware and device-portable with zero server components. The local
 * deterministic context compiler supplies prompt state; server-only extras
 * (FTS5 search, graph projections, prepared contexts) are simply absent.
 */

function stContext() {
    return globalThis.SillyTavern?.getContext?.() || null;
}

function metadataKey() {
    // Import lazily to avoid a cycle; MODULE_KEY is a constant string.
    return 'inner_lore';
}

function clone(value) {
    return typeof structuredClone === 'function'
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));
}

export class EmbeddedStorageError extends Error {
    constructor(message, code = 'EMBEDDED_STORAGE') {
        super(message);
        this.name = 'EmbeddedStorageError';
        this.code = code;
    }
}

export class EmbeddedStorageClient {
    constructor({ requestTimeoutMs = 5_000 } = {}) {
        this.requestTimeoutMs = requestTimeoutMs;
    }

    get #metadata() {
        const ctx = stContext();
        return ctx?.chatMetadata || null;
    }

    async #saveMetadata() {
        const ctx = stContext();
        if (!ctx) throw new EmbeddedStorageError('SillyTavern context unavailable');
        await ctx.saveMetadata();
    }

    async health() {
        return { status: 'ok', plugin: 'embedded', backend: 'chat-metadata' };
    }

    async loadOrCreate({ chatId, initialStore }) {
        if (!chatId) throw new EmbeddedStorageError('A chat ID is required');
        const metadata = this.#metadata;
        const existing = metadata ? metadata[metadataKey()] : null;
        // Legacy-format metadata IS the embedded store shape.
        const store = existing && existing.entities && (existing.brains || existing.version !== undefined)
            ? clone(existing)
            : clone(initialStore || { chatId, version: 1, entities: {}, brains: {} });
        store.chatId = chatId;
        if (!Number.isFinite(store.revision)) store.revision = 0;
        return {
            store,
            worldId: 'embedded',
            chatId,
            revision: store.revision,
            snapshotHash: '',
            created: !existing,
            forked: false,
            migrated: false,
        };
    }

    async save(worldId, chatId, store, { expectedRevision } = {}) {
        const metadata = this.#metadata;
        if (!metadata) throw new EmbeddedStorageError('Chat metadata unavailable');
        const next = clone(store);
        next.chatId = chatId;
        const base = Number.isFinite(expectedRevision) ? expectedRevision : (Number(next.revision) || 0);
        next.revision = base + 1;
        next.updatedAt = new Date().toISOString();
        metadata[metadataKey()] = next;
        await this.#saveMetadata();
        return { revision: next.revision, snapshotHash: '', updatedAt: next.updatedAt, worldId, chatId };
    }

    async rename(worldId, newChatId, expectedRevision) {
        const metadata = this.#metadata;
        const store = metadata?.[metadataKey()];
        if (!store) throw new EmbeddedStorageError('No embedded store to rename');
        const result = await this.save(worldId, newChatId, store, { expectedRevision });
        return { store, worldId, chatId: newChatId, revision: result.revision, snapshotHash: '' };
    }

    async deleteWorld() {
        const metadata = this.#metadata;
        if (metadata && metadata[metadataKey()] !== undefined) {
            delete metadata[metadataKey()];
            await this.#saveMetadata();
            return { deleted: true, recoverable: false };
        }
        return { deleted: false, missing: true, recoverable: false };
    }

    async fork() {
        // Chat-file branches copy metadata automatically; nothing to do.
        throw new EmbeddedStorageError('Embedded storage follows chat files; forking is automatic');
    }

    async buildContext() {
        // Signals the caller to use the local deterministic compiler.
        return null;
    }

    async buildEventDirectorContext() {
        return null;
    }

    async contextProfiles() {
        return [];
    }
}
