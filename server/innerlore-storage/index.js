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
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { applyPatch, isEmptyPatch, normalizePatch } from '../../store-diff.js?v=4';
import { directoriesOf, requireWs, stHelpers } from './st-bridge.js';
import { createBudget } from './provider-budget.js';
import { createLlm } from './llm.js';
import { createImages } from './images.js';
import { createHub } from './hub.js';
import { createJobRunner } from './jobs.js';
import { createPortraitJob } from './passes/portrait.js';
import { createPictureJob } from './passes/picture.js';
import { createPassJob, installServerTransport } from './passes/pass.js';
import { createPrivateReplyJob } from './passes/private-reply.js';
import { createRebuildJob } from './passes/rebuild.js';

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
    // Deleted rows are overwritten with zeros, so a deleted world's text does not linger in free pages.
    db.exec('PRAGMA secure_delete = ON');
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
/** The transactional snapshot writer, shared with the job runner once init has built it. */
let storeWriter = null;
export function getStoreWriter() { return storeWriter; }
/** The hub, budget and runner of this plugin instance (null until init). */
export const services = { hub: null, budget: null, runner: null, llm: null, images: null };
const logLine = (...args) => console.log('[innerlore-storage]', ...args);

function safeParse(text) {
    try { return JSON.parse(text); } catch { return {}; }
}

export function init(router, args) {
    db = openDatabase(args?.commandLineArgs);

    // Background work and its push channel. SillyTavern gives a plugin only
    // a router; the HTTP server is taken from the first request's socket so
    // the WebSocket upgrade can be served on the same port.
    const budget = createBudget();
    const hub = createHub({
        ws: requireWs(),
        log: (...parts) => logLine('hub:', ...parts),
        onSubscribe: ({ worldId, revision }) => subscriptionState(worldId, revision),
        onMessage: (message) => {
            if (message.type === 'story') applyStoryClaim(message);
        },
    });
    const llm = createLlm({ helpers: stHelpers, budget, log: (...parts) => logLine('llm:', ...parts) });
    const images = createImages({ helpers: stHelpers, log: (...parts) => logLine('images:', ...parts) });
    const runner = createJobRunner({
        db, hub, log: (...parts) => logLine('jobs:', ...parts),
        // A pass must not read a reply that is still being written; a portrait may.
        shouldHold: job => !['portrait', 'picture', 'private-reply'].includes(job.kind) && budget.storyFresh(job.worldId),
    });
    Object.assign(services, { hub, budget, runner, llm, images });
    // Jobs of worlds deleted before a deletion took its jobs along (their chat names and status lines).
    try { db.prepare('DELETE FROM jobs WHERE world_id NOT IN (SELECT id FROM worlds)').run(); } catch (error) { logLine('could not clear the jobs of deleted worlds:', error?.message || error); }
    // The runner has just wiped old job inputs and results; fold the write-ahead log in so the old pages go.
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (error) { logLine('startup checkpoint failed:', error?.message || error); }
    // Every page learns how much of each provider the server's jobs hold, so
    // its story gate can count it beside its own requests.
    budget.onChange(detail => {
        try { hub.broadcastAll({ type: 'provider', ...detail }); } catch { /* no sockets */ }
    });
    if (typeof router.use === 'function') {
        router.use((request, response, next) => {
            try { hub.ensureAttached(request); } catch (error) { logLine('hub attach failed:', error?.message || error); }
            next();
        });
    }
    const storeAccess = {
        read(worldId) {
            const row = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(String(worldId));
            return row ? loadShape(row) : null;
        },
        /** Applies `transform` to the latest snapshot inside a transaction and pushes the new revision. */
        commit(worldId, chatId, transform, { reason = 'job', except = null } = {}) {
            const attempt = storeWriter(String(worldId), String(chatId || ''), { transform });
            if (attempt.unchanged) return attempt;
            hub.broadcast(String(worldId), { type: 'store', revision: attempt.revision, snapshot: attempt.snapshotObject, origin: reason }, { except });
            return attempt;
        },
    };
    runner.register('portrait', createPortraitJob({ llm, images, store: storeAccess, hub, log: (...parts) => logLine('portrait:', ...parts) }));
    runner.register('picture', createPictureJob({ llm, images, store: storeAccess, hub, log: (...parts) => logLine('picture:', ...parts) }));
    installServerTransport(llm);
    runner.register('pass', createPassJob({ store: storeAccess, log: (...parts) => logLine('pass:', ...parts) }));
    runner.register('private-reply', createPrivateReplyJob({ llm, log: (...parts) => logLine('private:', ...parts) }));
    runner.register('rebuild', createRebuildJob({ store: storeAccess, log: (...parts) => logLine('rebuild:', ...parts) }));
    function subscriptionState(worldId, clientRevision) {
        const row = db.prepare('SELECT revision, snapshot FROM stores WHERE world_id = ?').get(String(worldId));
        const revision = row ? row.revision : 0;
        return {
            revision,
            ...(row && revision > (Number(clientRevision) || 0) ? { snapshot: safeParse(row.snapshot) } : {}),
            jobs: runner.list(String(worldId)),
            recent: runner.recent(String(worldId)),
            story: budget.storyClaim(String(worldId)),
            providers: budget.snapshots(),
        };
    }
    function applyStoryClaim(message) {
        const worldId = String(message?.worldId || '');
        if (!worldId) return null;
        if (message.phase === 'end') budget.releaseStory(worldId);
        else budget.claimStory(worldId, { provider: String(message.provider || ''), cost: Number(message.cost) || 1, quiet: Boolean(message.quiet) });
        if (message.phase === 'end') runner.pump(worldId);
        return budget.storyClaim(worldId);
    }

    router.get('/v1/health', (request, response) => {
        const worldId = String(request.query.worldId || '');
        if (worldId) {
            const row = db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
            return sendData(response, { status: 'ok', plugin: info.id, openWorlds: row ? 1 : 0 });
        }
        const count = db.prepare('SELECT COUNT(*) AS n FROM worlds').get().n;
        return sendData(response, { status: 'ok', plugin: info.id, openWorlds: count, hub: hub.describe() });
    });

    // Voice narration: InnerLore's local text-to-speech server (server/tts)
    // reached through SillyTavern, so a phone browsing from another device
    // and a page served over HTTPS both hear it. INNERLORE_TTS_URL overrides
    // the default http://127.0.0.1:8778.
    const ttsBase = () => String(process.env.INNERLORE_TTS_URL || 'http://127.0.0.1:8778').replace(/\/+$/u, '');
    // The voice server dies with the terminal that started it or under memory
    // pressure, and the narration then stalls until someone notices. When
    // INNERLORE_TTS_RESTART names the command that starts it (the launcher
    // script sets it), a refused connection starts it again, at most once
    // every 90 s; the page's next probe finds it up.
    let ttsRestartAt = 0;
    const ttsUnreachable = error => /ECONNREFUSED|ECONNRESET|ENOTFOUND|fetch failed/u.test(String(error?.cause?.code || error?.cause?.message || error?.message || ''));
    const restartTts = () => {
        const command = String(process.env.INNERLORE_TTS_RESTART || '').trim();
        if (!command || Date.now() - ttsRestartAt < 90_000) return false;
        ttsRestartAt = Date.now();
        console.warn(`[innerlore-storage] voice server not reachable at ${ttsBase()}; starting it again`);
        try {
            const termuxShell = '/data/data/com.termux/files/usr/bin/sh';
            const shell = process.env.SHELL || (fs.existsSync(termuxShell) ? termuxShell : '/bin/sh');
            const child = spawn(shell, ['-c', command], { detached: true, stdio: 'ignore' });
            child.on('error', error => console.warn('[innerlore-storage] voice server restart failed:', error?.message || error));
            child.unref();
            return true;
        } catch (error) {
            console.warn('[innerlore-storage] voice server restart failed:', error?.message || error);
            return false;
        }
    };
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
            if (ttsUnreachable(error)) restartTts();
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
            if (ttsUnreachable(error)) restartTts();
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

    /**
     * Writes a snapshot as the next revision inside one transaction. With
     * `expectedRevision` it refuses a moved store ({conflict}); with
     * `transform` the current snapshot is read inside the transaction and the
     * function's result is what gets written, so a patch or a job commit
     * lands on the latest state whatever happened since the writer read it.
     */
    const writeSnapshot = (worldId, chatId, { expectedRevision = null, snapshot = null, transform = null }) => {
        // Defense in depth: clear a leaked transaction instead of failing.
        try { db.exec('ROLLBACK'); } catch { /* no transaction open */ }
        db.exec('BEGIN');
        try {
            // A job that finishes after its world was deleted has nothing to write to.
            if (!db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId)) {
                db.exec('ROLLBACK');
                return { unchanged: true, missing: true, revision: 0, snapshotObject: null };
            }
            const row = db.prepare('SELECT revision, snapshot FROM stores WHERE world_id = ?').get(worldId);
            const currentRevision = row ? row.revision : 0;
            if (expectedRevision !== null && expectedRevision !== currentRevision) {
                // Returning inside the transaction would leak an open BEGIN
                // and wedge every later write on this connection.
                db.exec('ROLLBACK');
                return { conflict: currentRevision };
            }
            let next = snapshot;
            if (typeof transform === 'function') {
                const current = row ? safeParse(row.snapshot) : {};
                next = transform(current, currentRevision);
                if (!next || typeof next !== 'object') {
                    db.exec('ROLLBACK');
                    return { unchanged: true, revision: currentRevision, snapshotObject: current };
                }
            }
            const serialized = JSON.stringify(next);
            const nextRevision = currentRevision + 1;
            const updatedAt = new Date().toISOString();
            if (row) {
                db.prepare(`UPDATE stores SET chat_id = ?, revision = ?, snapshot = ?, updated_at = ?
                            WHERE world_id = ?`).run(chatId, nextRevision, serialized, updatedAt, worldId);
            } else {
                db.prepare(`INSERT INTO stores (world_id, chat_id, revision, snapshot, updated_at)
                            VALUES (?, ?, ?, ?, ?)`).run(worldId, chatId, nextRevision, serialized, updatedAt);
            }
            // Bounded history: keep the latest 20 revisions per world.
            db.prepare(`INSERT INTO store_revisions (world_id, revision, chat_id, snapshot)
                        VALUES (?, ?, ?, ?)`).run(worldId, nextRevision, chatId, serialized);
            db.prepare(`DELETE FROM store_revisions WHERE world_id = ? AND revision <= ?`)
                .run(worldId, nextRevision - 20);
            db.prepare(`UPDATE worlds SET updated_at = datetime('now') WHERE id = ?`).run(worldId);
            db.exec('COMMIT');
            return { revision: nextRevision, previousRevision: currentRevision, updatedAt, snapshotObject: next };
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    };
    storeWriter = writeSnapshot;

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

        const attempt = writeSnapshot(worldId, chatId, { expectedRevision, snapshot: store });
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

    /**
     * A writer's changes as path operations (see store-diff.js), applied onto
     * the current snapshot: no revision conflicts. When the store had moved
     * since the writer's `baseRevision`, the new snapshot comes back so the
     * writer can adopt what the others did.
     */
    router.patch('/v1/worlds/:worldId/innerlore/store', (request, response) => {
        const worldId = String(request.params.worldId);
        const chatId = String(request.body?.chatId || '').trim();
        if (!chatId) return sendError(response, 400, 'A chat id is required', 'INVALID_CHAT_ID');
        const patch = normalizePatch(request.body?.patch);
        const baseRevision = Number.isInteger(request.body?.baseRevision) ? request.body.baseRevision : null;
        const row = db.prepare('SELECT revision FROM stores WHERE world_id = ?').get(worldId);
        if (!row) return sendError(response, 404, 'InnerLore store not found', 'STORE_NOT_FOUND');
        if (isEmptyPatch(patch)) {
            return sendData(response, { worldId, chatId, revision: row.revision, moved: baseRevision !== null && baseRevision !== row.revision, snapshotHash: '', unchanged: true });
        }
        const attempt = writeSnapshot(worldId, chatId, { transform: current => applyPatch(current, patch) });
        const moved = baseRevision !== null && baseRevision !== attempt.previousRevision;
        const writer = String(request.body?.writer || '');
        // Other pages on this world learn of the new revision at once; the
        // writer itself already has it (and learns of others' changes from
        // the response when the store had moved).
        hub.broadcast(worldId, { type: 'store', revision: attempt.revision, snapshot: attempt.snapshotObject, origin: 'patch', writer }, { exceptWriter: writer });
        return sendData(response, {
            worldId, chatId,
            revision: attempt.revision,
            updatedAt: attempt.updatedAt,
            snapshotHash: '',
            moved,
            ...(moved ? { snapshot: attempt.snapshotObject } : {}),
        });
    });

    // ---- background jobs and the story's claim ----
    router.post('/v1/worlds/:worldId/jobs', (request, response) => {
        const worldId = String(request.params.worldId);
        const body = request.body && typeof request.body === 'object' ? request.body : {};
        const kind = String(body.kind || '').trim();
        if (!kind) return sendError(response, 400, 'A job kind is required', 'INVALID_JOB');
        const world = db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
        if (!world) return sendError(response, 404, 'World not found', 'WORLD_NOT_FOUND');
        try {
            const result = runner.submit({
                worldId,
                chatId: String(body.chatId || ''),
                kind,
                key: String(body.key || ''),
                input: body.input && typeof body.input === 'object' ? body.input : {},
                directories: directoriesOf(request),
                baseRevision: Number(body.baseRevision) || 0,
                replace: body.replace === true,
            });
            return sendData(response, result);
        } catch (error) {
            return sendError(response, 400, error?.message || String(error), 'INVALID_JOB');
        }
    });
    router.get('/v1/worlds/:worldId/jobs', (request, response) => {
        const active = String(request.query.active ?? '1') !== '0';
        return sendData(response, { jobs: runner.list(String(request.params.worldId), { active }) });
    });
    router.get('/v1/jobs/:jobId', (request, response) => {
        const job = runner.get(String(request.params.jobId));
        if (!job) return sendError(response, 404, 'Job not found', 'JOB_NOT_FOUND');
        return sendData(response, { job });
    });
    router.post('/v1/jobs/:jobId/cancel', (request, response) => {
        const job = runner.cancel(String(request.params.jobId), String(request.body?.reason || 'cancelled'));
        if (!job) return sendError(response, 404, 'Job not found or already finished', 'JOB_NOT_FOUND');
        return sendData(response, { job });
    });
    /** What the story gate asks before leaving: is background work on this world in flight, and is there room on its provider. */
    router.get('/v1/worlds/:worldId/background', (request, response) => {
        const worldId = String(request.params.worldId);
        const provider = String(request.query.provider || '');
        const cost = Math.max(0, Number(request.query.cost) || 0);
        const active = runner.activeJob(worldId);
        const queued = runner.list(worldId).filter(job => job.status === 'queued');
        return sendData(response, {
            inFlight: active ? 1 : 0,
            activeJob: active ? { id: active.id, kind: active.kind, key: active.key, status: active.status } : null,
            queued: queued.length,
            room: provider ? budget.hasRoom(provider, cost || 1, { ignoreReserve: true }) : true,
            providers: budget.snapshots(),
            story: budget.storyClaim(worldId),
        });
    });
    router.post('/v1/worlds/:worldId/story-claim', (request, response) => {
        const claim = applyStoryClaim({ ...(request.body || {}), worldId: String(request.params.worldId) });
        return sendData(response, { story: claim });
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
        try { runner.cancelWorld(String(request.params.worldId)); } catch { /* no jobs */ }
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
            // The jobs carried the world's messages and replies (their input and result).
            db.prepare('DELETE FROM jobs WHERE world_id = ?').run(worldId);
            db.prepare('DELETE FROM worlds WHERE id = ?').run(worldId);
            db.exec('COMMIT');
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
        // The write-ahead log still holds the pages as they were written; fold it in and empty it.
        try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch (error) { logLine('checkpoint after a world delete failed:', error?.message || error); }
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
    try { services.runner?.close(); } catch { /* stopping */ }
    try { services.hub?.close(); } catch { /* stopping */ }
    try { db?.close(); } catch { /* already closed */ }
}

export default { info, init, exit };
