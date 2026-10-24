/**
 * InnerLore Storage — lean SQLite server plugin.
 *
 * Purpose-built persistence for the InnerLore SillyTavern extension: one
 * SQLite database holds every chat's world (snapshot store + bounded
 * revisions + context profiles). Implements exactly the HTTP surface the
 * extension's storage client speaks, with optimistic-revision concurrency.
 * Prompt context is compiled client-side by the extension's deterministic
 * compiler; this plugin is pure storage.
 *
 * Install: copy or link this folder to <SillyTavern>/plugins/innerlore-storage,
 * run `npm install` inside it, set enableServerPlugins: true, restart.
 * Database location: <SillyTavern>/data/worlds/innerlore-storage.db
 * (override with INNERLORE_STORAGE_DB=/absolute/path.db).
 */

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_RELATIVE_DB = ['data', 'worlds', 'innerlore-storage.db'];

function resolveDatabaseDirectory(commandLineArgs) {
    const fromArgs = commandLineArgs?.find(arg => String(arg).startsWith('--dataRoot'))
        ?.split('=')[1];
    return fromArgs || process.cwd();
}

function openDatabase(commandLineArgs) {
    const target = process.env.INNERLORE_STORAGE_DB
        || path.join(resolveDatabaseDirectory(commandLineArgs), ...DEFAULT_RELATIVE_DB);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const db = new DatabaseSync(target);
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS worlds (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL DEFAULT '',
            metadata TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS stores (
            world_id TEXT PRIMARY KEY REFERENCES worlds(id) ON DELETE CASCADE,
            chat_id TEXT NOT NULL,
            revision INTEGER NOT NULL DEFAULT 0,
            snapshot TEXT NOT NULL DEFAULT '{}',
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS store_revisions (
            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
            revision INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            snapshot TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (world_id, revision)
        );
        CREATE TABLE IF NOT EXISTS context_profiles (
            world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
            profile_id TEXT NOT NULL,
            name TEXT NOT NULL,
            builtin INTEGER NOT NULL DEFAULT 0,
            revision INTEGER NOT NULL DEFAULT 0,
            config TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY (world_id, profile_id)
        );
    `);
    return db;
}

const ok = response => response.json({ ok: true, data: null });
const sendData = (response, data) => response.json({ ok: true, data });
const sendError = (response, status, message, code) => response.status(status).json({
    ok: false,
    error: { message, code: code || 'STORAGE_REQUEST_FAILED' },
});

function parseJsonSafe(value) {
    try { return JSON.parse(value); } catch { return null; }
}

export const info = {
    id: 'innerlore-storage',
    name: 'InnerLore Storage',
    description: 'Lean SQLite persistence for the InnerLore extension (worlds, stores, revisions, context profiles).',
};

let db = null;

export function init(router, args) {
    db = openDatabase(args?.commandLineArgs);

    router.get('/v1/health', (request, response) => {
        const worldId = String(request.query.worldId || '');
        if (worldId) {
            const row = db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
            return sendData(response, { status: 'ok', plugin: info.id, openWorlds: row ? 1 : 0 });
        }
        const count = db.prepare('SELECT COUNT(*) AS n FROM worlds').get().n;
        return sendData(response, { status: 'ok', plugin: info.id, openWorlds: count });
    });

    // Voice narration: InnerLore's local text-to-speech server (server/tts)
    // reached through SillyTavern, so a phone browsing from another device
    // and a page served over HTTPS both hear it. INNERLORE_TTS_URL overrides
    // the default http://127.0.0.1:8778.
    const ttsBase = () => String(process.env.INNERLORE_TTS_URL || 'http://127.0.0.1:8778').replace(/\/+$/u, '');
    // External providers (the fork's services): the key is read from the
    // user's secret store on the server, so it never travels to the page.
    const readSecretValue = (request, key, id) => {
        const root = request?.user?.directories?.root || path.join(resolveDatabaseDirectory(process.argv), 'data', 'default-user');
        try {
            const secrets = JSON.parse(fs.readFileSync(path.join(root, 'secrets.json'), 'utf8'));
            const entries = secrets?.[key];
            if (typeof entries === 'string') return entries;
            if (Array.isArray(entries)) {
                const entry = entries.find(item => item?.id === id) || entries.find(item => item?.active);
                return String(entry?.value || '');
            }
        } catch (error) {
            console.warn('[innerlore-storage] could not read the secret store:', error?.message || error);
        }
        return '';
    };
    const OPENAI_VOICES = [
        { id: 'alloy', name: 'Alloy', gender: 'female', pitch: 180 }, { id: 'ash', name: 'Ash', gender: 'male', pitch: 110 },
        { id: 'ballad', name: 'Ballad', gender: 'male', pitch: 120 }, { id: 'coral', name: 'Coral', gender: 'female', pitch: 195 },
        { id: 'echo', name: 'Echo', gender: 'male', pitch: 105 }, { id: 'fable', name: 'Fable', gender: 'male', pitch: 130 },
        { id: 'onyx', name: 'Onyx', gender: 'male', pitch: 90 }, { id: 'nova', name: 'Nova', gender: 'female', pitch: 200 },
        { id: 'sage', name: 'Sage', gender: 'female', pitch: 185 }, { id: 'shimmer', name: 'Shimmer', gender: 'female', pitch: 210 },
        { id: 'verse', name: 'Verse', gender: 'male', pitch: 115 },
    ];
    const externalBase = service => String(service?.url || '').trim().replace(/\/+$/u, '');
    const bearer = (request, service) => {
        const key = readSecretValue(request, 'api_key_custom', String(service?.secretId || ''));
        return key ? { Authorization: `Bearer ${key}` } : {};
    };

    router.get('/v1/tts/health', async (request, response) => {
        if (String(request.query.provider || '') === 'openai-speech') {
            return sendData(response, { ok: true, engine: 'openai-speech', voices: OPENAI_VOICES, url: String(request.query.url || '') });
        }
        try {
            const upstream = await fetch(`${ttsBase()}/health`, { signal: AbortSignal.timeout(4_000) });
            const payload = await upstream.json();
            return sendData(response, { ...payload, url: ttsBase() });
        } catch (error) {
            return sendError(response, 503, `Voice server not reachable at ${ttsBase()}: ${error?.message || error}`, 'tts_unavailable');
        }
    });
    router.post('/v1/tts/speak', async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const text = String(body.text || '').slice(0, 2_000);
        if (!text.trim()) return sendError(response, 400, 'text is empty', 'bad_request');
        const service = body.service && typeof body.service === 'object' ? body.service : null;
        if (service?.provider === 'openai-speech') {
            const base = externalBase(service);
            if (!/^https?:\/\//u.test(base)) return sendError(response, 400, 'the speech service URL is missing', 'bad_request');
            try {
                const upstream = await fetch(`${base}/v1/audio/speech`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...bearer(request, service) },
                    body: JSON.stringify({
                        model: String(service.model || 'tts-1'),
                        voice: String(body.voice || 'alloy'),
                        input: text,
                        response_format: 'wav',
                        speed: Math.min(4, Math.max(0.25, Number(body.speed) || 1)),
                    }),
                    signal: AbortSignal.timeout(120_000),
                });
                if (!upstream.ok) {
                    const detail = await upstream.text().catch(() => '');
                    return sendError(response, 502, `Speech service answered ${upstream.status}: ${detail.slice(0, 300)}`, 'tts_failed');
                }
                const audio = Buffer.from(await upstream.arrayBuffer());
                response.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/wav');
                response.setHeader('Cache-Control', 'no-store');
                return response.status(200).send(audio);
            } catch (error) {
                return sendError(response, 503, `Speech service not reachable at ${base}: ${error?.message || error}`, 'tts_unavailable');
            }
        }
        try {
            const upstream = await fetch(`${ttsBase()}/speak`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, voice: body.voice, speed: body.speed, steps: body.steps, silence: body.silence }),
                signal: AbortSignal.timeout(120_000),
            });
            if (!upstream.ok) {
                const detail = await upstream.text().catch(() => '');
                return sendError(response, 502, `Voice server answered ${upstream.status}: ${detail.slice(0, 300)}`, 'tts_failed');
            }
            const audio = Buffer.from(await upstream.arrayBuffer());
            response.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/wav');
            response.setHeader('Cache-Control', 'no-store');
            return response.status(200).send(audio);
        } catch (error) {
            return sendError(response, 503, `Voice server not reachable at ${ttsBase()}: ${error?.message || error}`, 'tts_unavailable');
        }
    });

    // Portraits through an OpenAI-compatible images API (the fork's image service).
    router.post('/v1/images/generate', async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const service = body.service && typeof body.service === 'object' ? body.service : {};
        const base = externalBase(service);
        const prompt = String(body.prompt || '').slice(0, 4_000);
        if (!/^https?:\/\//u.test(base)) return sendError(response, 400, 'the image service URL is missing', 'bad_request');
        if (!prompt.trim()) return sendError(response, 400, 'prompt is empty', 'bad_request');
        const negative = String(body.negative_prompt || '').slice(0, 1_000).trim();
        const width = Math.max(256, Math.min(2048, Number(body.width) || 1024));
        const height = Math.max(256, Math.min(2048, Number(body.height) || 1024));
        try {
            const upstream = await fetch(`${base}/v1/images/generations`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...bearer(request, service) },
                body: JSON.stringify({
                    ...(service.model ? { model: String(service.model) } : {}),
                    prompt: negative ? `${prompt}\n\nAvoid: ${negative}` : prompt,
                    n: 1,
                    size: `${width}x${height}`,
                    response_format: 'b64_json',
                }),
                signal: AbortSignal.timeout(300_000),
            });
            if (!upstream.ok) {
                const detail = await upstream.text().catch(() => '');
                return sendError(response, 502, `Image service answered ${upstream.status}: ${detail.slice(0, 300)}`, 'image_failed');
            }
            const payload = await upstream.json();
            const images = (Array.isArray(payload?.data) ? payload.data : []).map(item => item?.b64_json).filter(Boolean);
            if (!images.length) return sendError(response, 502, 'Image service sent no picture', 'image_failed');
            return sendData(response, { images });
        } catch (error) {
            return sendError(response, 503, `Image service not reachable at ${base}: ${error?.message || error}`, 'image_unavailable');
        }
    });

    router.post('/v1/tts/transcribe', async (request, response) => {
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const audio = String(body.audio || '');
        if (!audio) return sendError(response, 400, 'audio is empty', 'bad_request');
        try {
            const upstream = await fetch(`${ttsBase()}/transcribe`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ audio }),
                signal: AbortSignal.timeout(120_000),
            });
            const payload = await upstream.json().catch(() => ({}));
            if (!upstream.ok || !payload?.ok) return sendError(response, 502, `Voice server: ${payload?.error || upstream.status}`, 'stt_failed');
            return sendData(response, { text: String(payload.text || '') });
        } catch (error) {
            return sendError(response, 503, `Voice server not reachable at ${ttsBase()}: ${error?.message || error}`, 'tts_unavailable');
        }
    });

    router.post('/v1/worlds/', (request, response) => {
        const id = String(request.body?.id || '').trim();
        if (!id) return sendError(response, 400, 'A world id is required', 'INVALID_WORLD_ID');
        const existing = db.prepare('SELECT id FROM worlds WHERE id = ?').get(id);
        if (existing) return sendError(response, 409, 'World already exists', 'WORLD_EXISTS');
        db.prepare('INSERT INTO worlds (id, name, metadata) VALUES (?, ?, ?)')
            .run(id, String(request.body?.name || id), JSON.stringify(request.body?.metadata || {}));
        return sendData(response, { id, name: String(request.body?.name || id) });
    });

    router.get('/v1/worlds/:worldId', (request, response) => {
        const row = db.prepare('SELECT id, name, metadata, created_at, updated_at FROM worlds WHERE id = ?')
            .get(String(request.params.worldId));
        if (!row) return sendError(response, 404, 'World not found', 'WORLD_NOT_FOUND');
        return sendData(response, {
            id: row.id,
            name: row.name,
            metadata: parseJsonSafe(row.metadata) || {},
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        });
    });

    // ---- InnerLore store -------------------------------------------------

    const loadShape = row => ({
        store: parseJsonSafe(row.snapshot) || {},
        chatId: row.chat_id,
        worldId: row.world_id,
        revision: row.revision,
        snapshotHash: '',
    });

    router.get('/v1/worlds/:worldId/innerlore/store', (request, response) => {
        const row = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(String(request.params.worldId));
        if (!row) return sendError(response, 404, 'InnerLore store not found', 'STORE_NOT_FOUND');
        return sendData(response, loadShape(row));
    });

    router.put('/v1/worlds/:worldId/innerlore/store', (request, response) => {
        const worldId = String(request.params.worldId);
        const chatId = String(request.body?.chatId || '').trim();
        const store = request.body?.store;
        if (!chatId) return sendError(response, 400, 'A chat id is required', 'INVALID_CHAT_ID');
        if (!store || typeof store !== 'object') return sendError(response, 400, 'A store snapshot is required', 'INVALID_STORE');
        const expectedRevision = Number.isInteger(request.body?.expectedRevision)
            ? request.body.expectedRevision
            : null;

        const world = db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
        if (!world) return sendError(response, 404, 'World not found', 'WORLD_NOT_FOUND');

        const snapshot = JSON.stringify(store);
        const attempt = (() => {
            // Defense in depth: clear a leaked transaction instead of failing.
            try { db.exec('ROLLBACK'); } catch { /* no transaction open */ }
            db.exec('BEGIN');
            try {
            const row = db.prepare('SELECT revision FROM stores WHERE world_id = ?').get(worldId);
            const currentRevision = row ? row.revision : 0;
            if (expectedRevision !== null && expectedRevision !== currentRevision) {
                // Returning inside the transaction would leak an open BEGIN
                // and wedge every later write on this connection.
                db.exec('ROLLBACK');
                return { conflict: currentRevision };
            }
            const nextRevision = currentRevision + 1;
            const updatedAt = new Date().toISOString();
            if (row) {
                db.prepare(`UPDATE stores SET chat_id = ?, revision = ?, snapshot = ?, updated_at = ?
                            WHERE world_id = ?`).run(chatId, nextRevision, snapshot, updatedAt, worldId);
            } else {
                db.prepare(`INSERT INTO stores (world_id, chat_id, revision, snapshot, updated_at)
                            VALUES (?, ?, ?, ?, ?)`).run(worldId, chatId, nextRevision, snapshot, updatedAt);
            }
            // Bounded history: keep the latest 20 revisions per world.
            db.prepare(`INSERT INTO store_revisions (world_id, revision, chat_id, snapshot)
                        VALUES (?, ?, ?, ?)`).run(worldId, nextRevision, chatId, snapshot);
            db.prepare(`DELETE FROM store_revisions WHERE world_id = ? AND revision <= ?`)
                .run(worldId, nextRevision - 20);
                db.prepare(`UPDATE worlds SET updated_at = datetime('now') WHERE id = ?`).run(worldId);
                db.exec('COMMIT');
                return { revision: nextRevision, updatedAt };
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        })();

        if (attempt.conflict !== undefined) {
            return sendError(response, 409, `Revision conflict: expected ${expectedRevision}, found ${attempt.conflict}`,
                'REVISION_CONFLICT');
        }
        return sendData(response, {
            worldId, chatId,
            revision: attempt.revision,
            snapshotHash: '',
            updatedAt: attempt.updatedAt,
        });
    });

    router.post('/v1/worlds/:worldId/innerlore/fork', (request, response) => {
        const sourceId = String(request.params.worldId);
        const targetId = String(request.body?.targetWorldId || '').trim();
        const targetChatId = String(request.body?.targetChatId || '').trim();
        if (!targetId || !targetChatId) return sendError(response, 400, 'targetWorldId and targetChatId are required', 'INVALID_FORK');
        const source = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(sourceId);
        if (!source) return sendError(response, 404, 'Source store not found', 'STORE_NOT_FOUND');
        try { db.exec('ROLLBACK'); } catch { /* no transaction open */ }
        db.exec('BEGIN');
        try {
            db.prepare(`INSERT OR IGNORE INTO worlds (id, name, metadata) VALUES (?, ?, ?)`)
                .run(targetId, targetId, JSON.stringify({ forkedFrom: sourceId }));
            const existing = db.prepare('SELECT revision FROM stores WHERE world_id = ?').get(targetId);
            if (!existing) {
                db.prepare(`INSERT INTO stores (world_id, chat_id, revision, snapshot, updated_at)
                            VALUES (?, ?, ?, ?, datetime('now'))`)
                    .run(targetId, targetChatId, source.revision, source.snapshot);
            }
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        const row = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(targetId);
        return sendData(response, { ...loadShape(row), created: true, forked: true, migrated: false });
    });

    router.post('/v1/worlds/:worldId/innerlore/rename', (request, response) => {
        const worldId = String(request.params.worldId);
        const chatId = String(request.body?.chatId || '').trim();
        if (!chatId) return sendError(response, 400, 'A chat id is required', 'INVALID_CHAT_ID');
        const row = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(worldId);
        if (!row) return sendError(response, 404, 'Store not found', 'STORE_NOT_FOUND');
        const nextRevision = row.revision + 1;
        db.prepare('UPDATE stores SET chat_id = ?, revision = ?, updated_at = datetime(\'now\') WHERE world_id = ?')
            .run(chatId, nextRevision, worldId);
        const updated = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(worldId);
        return sendData(response, loadShape(updated));
    });

    router.delete('/v1/worlds/:worldId/innerlore/store', (request, response) => {
        const worldId = String(request.params.worldId);
        const chatId = String(request.query.chatId || '').trim();
        if (chatId) {
            const row = db.prepare('SELECT chat_id FROM stores WHERE world_id = ?').get(worldId);
            if (row && row.chat_id !== chatId) {
                return sendError(response, 409, 'Stored chat identity does not match', 'CHAT_ID_MISMATCH');
            }
        }
        db.exec('BEGIN');
        let result;
        try {
            result = db.prepare('DELETE FROM stores WHERE world_id = ?').run(worldId).changes > 0;
            db.prepare('DELETE FROM store_revisions WHERE world_id = ?').run(worldId);
            db.prepare('DELETE FROM context_profiles WHERE world_id = ?').run(worldId);
            db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        return sendData(response, {
            worldId, chatId,
            deleted: result, missing: !result, recoverable: false,
        });
    });

    // Context preparation happens client-side; acknowledge and defer.
    router.post('/v1/worlds/:worldId/innerlore/context/build', (request, response) => sendData(response, null));
    router.post('/v1/worlds/:worldId/innerlore/event-director/context', (request, response) => {
        const worldId = String(request.params.worldId);
        const row = db.prepare('SELECT chat_id, snapshot, revision FROM stores WHERE world_id = ?').get(worldId);
        if (!row) return sendError(response, 404, 'InnerLore store not found', 'STORE_NOT_FOUND');
        if (request.body?.expectedRevision !== undefined && request.body.expectedRevision !== row.revision) {
            return sendError(response, 409, 'InnerLore Event Director requested from a stale store revision', 'REVISION_CONFLICT');
        }
        const store = parseJsonSafe(row.snapshot) || {};
        const entities = Array.isArray(store.entities)
            ? store.entities
            : Object.values(store.entities || {});
        const progression = store.progression || {};
        const definitions = Object.values(progression.eventDefinitions || {});
        const proposals = Object.values(progression.eventProposals || {})
            .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
        const sources = [];
        for (const entity of entities) {
            if (!entity?.id || entity.enabled === false) continue;
            sources.push({
                id: `lore:${entity.id}`,
                recordId: entity.id,
                kind: 'lore',
                name: String(entity.name || entity.id),
                summary: String(entity.summary || entity.currentState || ''),
                unresolved: Array.isArray(entity.unresolved) ? entity.unresolved : [],
                revision: Number(entity.revision) || row.revision,
                messageIndex: Number.isInteger(entity.lastSeenMessage) ? entity.lastSeenMessage : -1,
                graphNodeId: `entity:${entity.id}`,
                generated: false,
            });
        }
        for (const [prefix, collection] of [
            ['goal', progression.goals],
            ['process', progression.processes],
            ['event', progression.events],
        ]) {
            for (const record of Object.values(collection || {})) {
                const key = record?.key ?? record?.id;
                if (!key) continue;
                sources.push({
                    id: `${prefix}:${key}`,
                    recordId: String(key),
                    kind: prefix,
                    name: String(record.title || record.name || key),
                    status: String(record.status || ''),
                    owner: String(record.owner || record.subjectName || ''),
                    description: String(record.description || '').slice(0, 600),
                    generated: prefix === 'event' && (record.generated === true || record.origin === 'automatic_director'),
                });
            }
        }
        if (request.body?.includePrivateMinds === true) {
            for (const brain of Object.values(store.brains || {})) {
                const current = brain.currentMind;
                const statement = [current?.perception, current?.interpretation, current?.intention]
                    .filter(Boolean).join(' ');
                if (!brain?.id || !statement.trim()) continue;
                sources.push({
                    id: `npc_motive:${brain.id}`,
                    recordId: brain.id,
                    kind: 'npc_motive',
                    name: String(brain.name || brain.id),
                    statement: statement.slice(0, 600),
                    graphNodeId: `brain:${brain.id}`,
                    generated: false,
                    private: true,
                });
            }
        }
        return sendData(response, {
            schema: 'innerlore.event-director-context.v1',
            snapshot: {
                worldId,
                chatId: row.chat_id,
                storeRevision: row.revision,
                lastProcessedIndex: Number.isInteger(store.lastProcessedIndex) ? store.lastProcessedIndex : -1,
                clock: progression.clock || {},
            },
            branch: {
                id: String(request.body?.branchId || 'main'),
                headFingerprint: String(request.body?.headFingerprint || ''),
            },
            sources,
            availableSourceIds: sources.map(source => source.id),
            existingDefinitions: definitions,
            recentProposals: proposals.slice(0, 12),
            relations: [],
            diagnostics: { sqliteAuthoritative: true, relationCount: 0 },
        });
    });

    router.get('/v1/worlds/:worldId/innerlore/context/profiles', (request, response) => {
        const rows = db.prepare('SELECT profile_id, name, builtin, revision, config FROM context_profiles WHERE world_id = ?')
            .all(String(request.params.worldId));
        return sendData(response, rows.map(row => ({
            id: row.profile_id,
            name: row.name,
            builtin: Boolean(row.builtin),
            revision: row.revision,
            config: parseJsonSafe(row.config) || {},
        })));
    });

    router.put('/v1/worlds/:worldId/innerlore/context/profiles/:profileId', (request, response) => {
        const worldId = String(request.params.worldId);
        const profileId = String(request.params.profileId);
        const name = String(request.body?.name || profileId);
        const config = JSON.stringify(request.body?.config || {});
        db.prepare(`INSERT INTO context_profiles (world_id, profile_id, name, builtin, revision, config)
                    VALUES (?, ?, ?, 0, 1, ?)
                    ON CONFLICT(world_id, profile_id) DO UPDATE SET
                        name = excluded.name, config = excluded.config, revision = revision + 1`)
            .run(worldId, profileId, name, config);
        return sendData(response, { id: profileId, name });
    });

    console.log(`${info.id}: lean SQLite storage ready (${info.id} v1 routes mounted)`);
}

export function exit() {
    try { db?.close(); } catch { /* already closed */ }
}

export default { info, init, exit };
