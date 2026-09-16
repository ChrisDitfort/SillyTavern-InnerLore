const API_ROOT = '/api/plugins/airpg-storage/v1';
const POINTER_BACKEND = 'airpg-storage';
const POINTER_VERSION = 1;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export class InnerLoreStorageError extends Error {
    constructor(message, { status = 0, code = 'STORAGE_UNAVAILABLE', details = null } = {}) {
        super(message);
        this.name = 'InnerLoreStorageError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export function isInnerLoreStoragePointer(value) {
    return Boolean(value
        && typeof value === 'object'
        && value.backend === POINTER_BACKEND
        && typeof value.worldId === 'string'
        && value.worldId);
}

export function isLegacyInnerLoreStore(value) {
    return Boolean(value
        && typeof value === 'object'
        && !isInnerLoreStoragePointer(value)
        && (value.entities || value.brains || Number.isFinite(Number(value.version))));
}

export function createInnerLoreStoragePointer(result) {
    return {
        backend: POINTER_BACKEND,
        pointerVersion: POINTER_VERSION,
        worldId: result.worldId,
        chatId: result.chatId,
        revision: result.revision,
        snapshotHash: result.snapshotHash,
        updatedAt: result.updatedAt,
    };
}

async function sha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function innerLoreWorldId(chatId) {
    const id = String(chatId ?? '').trim();
    if (!id) throw new InnerLoreStorageError('A chat ID is required', { code: 'INVALID_CHAT_ID' });
    return `innerlore-${(await sha256(id)).slice(0, 40)}`;
}

export class InnerLoreStorageClient {
    constructor({
        fetchImpl = globalThis.fetch,
        getHeaders = () => ({ 'Content-Type': 'application/json' }),
        requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    } = {}) {
        if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');
        // Window.fetch is a browser Web IDL method and must retain Window as
        // its receiver. Calling a copied reference as `this.fetchImpl()` makes
        // the storage client the receiver and Chromium throws "Illegal
        // invocation" before any request leaves the page.
        this.fetchImpl = fetchImpl.bind(globalThis);
        this.getHeaders = getHeaders;
        this.requestTimeoutMs = Number.isFinite(Number(requestTimeoutMs)) && Number(requestTimeoutMs) > 0
            ? Number(requestTimeoutMs)
            : DEFAULT_REQUEST_TIMEOUT_MS;
    }

    async #request(path, { method = 'GET', body, allowMissing = false, signal } = {}) {
        const controller = new AbortController();
        let timedOut = false;
        const cancelFromCaller = () => controller.abort(signal?.reason);
        if (signal?.aborted) cancelFromCaller();
        else signal?.addEventListener?.('abort', cancelFromCaller, { once: true });
        const timeout = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, this.requestTimeoutMs);
        const cancelled = new Promise((_, reject) => {
            const rejectCancelled = () => reject(controller.signal.reason || new Error('InnerLore storage request cancelled'));
            if (controller.signal.aborted) rejectCancelled();
            else controller.signal.addEventListener('abort', rejectCancelled, { once: true });
        });

        try {
            const response = await Promise.race([this.fetchImpl(`${API_ROOT}${path}`, {
                method,
                headers: this.getHeaders(),
                signal: controller.signal,
                ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            }), cancelled]);
            let payload = null;
            try { payload = await Promise.race([response.json(), cancelled]); } catch (error) {
                if (controller.signal.aborted) throw error;
                // A non-JSON error response is handled below using its status.
            }
            if (allowMissing && response.status === 404) return null;
            if (!response.ok || payload?.ok !== true) {
                const serverError = payload?.error;
                throw new InnerLoreStorageError(serverError?.message || `InnerLore storage request failed (${response.status})`, {
                    status: response.status,
                    code: serverError?.code || 'STORAGE_REQUEST_FAILED',
                    details: serverError?.details,
                });
            }
            return payload.data;
        } catch (error) {
            if (error instanceof InnerLoreStorageError) throw error;
            if (timedOut) {
                throw new InnerLoreStorageError(`The InnerLore server store did not respond within ${this.requestTimeoutMs} ms`, {
                    code: 'STORAGE_TIMEOUT',
                });
            }
            if (signal?.aborted) {
                throw new InnerLoreStorageError('The InnerLore storage request was cancelled', {
                    code: 'STORAGE_ABORTED',
                });
            }
            throw new InnerLoreStorageError(`Could not reach the InnerLore server store: ${error.message || error}`, {
                code: 'STORAGE_UNAVAILABLE',
            });
        } finally {
            clearTimeout(timeout);
            signal?.removeEventListener?.('abort', cancelFromCaller);
        }
    }

    async health(worldId = '') {
        const suffix = worldId ? `?worldId=${encodeURIComponent(worldId)}` : '';
        return this.#request(`/health${suffix}`);
    }

    async ensureWorld(chatId, worldId = null) {
        const resolvedWorldId = worldId || await innerLoreWorldId(chatId);
        const existing = await this.#request(`/worlds/${encodeURIComponent(resolvedWorldId)}`, { allowMissing: true });
        if (existing) {
            const assignedChatId = existing.metadata?.chatId;
            if (assignedChatId && assignedChatId !== chatId) {
                throw new InnerLoreStorageError('The storage world belongs to a different chat', {
                    status: 409,
                    code: 'WORLD_ID_COLLISION',
                    details: { worldId: resolvedWorldId, expectedChatId: assignedChatId, actualChatId: chatId },
                });
            }
            return resolvedWorldId;
        }
        try {
            await this.#request('/worlds', {
                method: 'POST',
                body: {
                    id: resolvedWorldId,
                    name: `InnerLore: ${chatId}`,
                    metadata: { kind: 'innerlore', chatId },
                },
            });
        } catch (error) {
            // Another tab may have created the deterministic world between the
            // GET and POST. Re-read it before treating the conflict as fatal.
            if (error.status !== 409) throw error;
            const raced = await this.#request(`/worlds/${encodeURIComponent(resolvedWorldId)}`, { allowMissing: true });
            if (!raced || (raced.metadata?.chatId && raced.metadata.chatId !== chatId)) throw error;
        }
        return resolvedWorldId;
    }

    load(worldId) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/store`, { allowMissing: true });
    }

    save(worldId, chatId, store, { expectedRevision, migrationSource, reason = 'save', branch, scene, observation } = {}) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/store`, {
            method: 'PUT',
            body: {
                chatId,
                store,
                ...(expectedRevision === undefined ? {} : { expectedRevision }),
                ...(migrationSource ? { migrationSource } : {}),
                ...(branch ? { branch } : {}),
                ...(scene ? { scene } : {}),
                ...(observation ? { observation } : {}),
                reason,
            },
        });
    }

    buildContext(worldId, input, { signal } = {}) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/context/build`, {
            method: 'POST', body: input, signal,
        });
    }

    buildEventDirectorContext(worldId, input, { signal } = {}) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/event-director/context`, {
            method: 'POST', body: input, signal,
        });
    }

    contextProfiles(worldId) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/context/profiles`);
    }

    saveContextProfile(worldId, profileId, input) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/context/profiles/${encodeURIComponent(profileId)}`, {
            method: 'PUT', body: input,
        });
    }

    async fork(sourceWorldId, targetWorldId, targetChatId, expectedRevision) {
        return this.#request(`/worlds/${encodeURIComponent(sourceWorldId)}/innerlore/fork`, {
            method: 'POST',
            body: { targetWorldId, targetChatId, expectedRevision },
        });
    }

    rename(worldId, chatId, expectedRevision) {
        return this.#request(`/worlds/${encodeURIComponent(worldId)}/innerlore/rename`, {
            method: 'POST',
            body: { chatId, expectedRevision },
        });
    }

    async deleteWorld(chatId, worldId = null) {
        const resolvedWorldId = worldId || await innerLoreWorldId(chatId);
        const result = await this.#request(
            `/worlds/${encodeURIComponent(resolvedWorldId)}/innerlore/store?chatId=${encodeURIComponent(chatId)}`,
            { method: 'DELETE', allowMissing: true },
        );
        return result ?? { worldId: resolvedWorldId, chatId, missing: true, deleted: false, recoverable: false };
    }

    async loadOrCreate({ chatId, pointer = null, initialStore, migrationSource = null } = {}) {
        const targetWorldId = await innerLoreWorldId(chatId);
        const sourceWorldId = isInnerLoreStoragePointer(pointer) ? pointer.worldId : '';
        const isBranch = Boolean(sourceWorldId && pointer.chatId && pointer.chatId !== chatId);

        if (isBranch && sourceWorldId !== targetWorldId) {
            try {
                // The pointer is intentionally tiny and is not persisted on
                // every save, so the server must fork the latest committed
                // source revision rather than trusting its cached revision.
                const forked = await this.fork(sourceWorldId, targetWorldId, chatId);
                return { ...forked, created: true, forked: true, migrated: false };
            } catch (error) {
                if (error.status !== 409) throw error;
                const raced = await this.load(targetWorldId);
                if (raced?.chatId === chatId) return { ...raced, created: false, forked: true, migrated: false };
                throw error;
            }
        }

        const preferredWorldId = sourceWorldId || targetWorldId;
        let loaded = await this.load(preferredWorldId);
        if (loaded) {
            if (loaded.chatId !== chatId) {
                throw new InnerLoreStorageError('Stored InnerLore chat identity does not match the open chat', {
                    status: 409,
                    code: 'CHAT_ID_MISMATCH',
                    details: { worldId: preferredWorldId, expectedChatId: loaded.chatId, actualChatId: chatId },
                });
            }
            return { ...loaded, created: false, forked: false, migrated: false };
        }

        await this.ensureWorld(chatId, preferredWorldId);
        loaded = await this.load(preferredWorldId);
        if (loaded) return { ...loaded, created: false, forked: false, migrated: false };
        const saved = await this.save(preferredWorldId, chatId, initialStore, {
            expectedRevision: 0,
            migrationSource,
            reason: migrationSource ? 'migration' : 'initialize',
        });
        return { ...saved, created: true, forked: false, migrated: Boolean(migrationSource) };
    }
}

export const INNERLORE_STORAGE_API_ROOT = API_ROOT;
