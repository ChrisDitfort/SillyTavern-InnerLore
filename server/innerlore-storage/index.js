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
import express from 'express';
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

    const worlds = express.Router();

    router.get('/v1/health', (request, response) => {
        const worldId = String(request.query.worldId || '');
        if (worldId) {
            const row = db.prepare('SELECT id FROM worlds WHERE id = ?').get(worldId);
            return sendData(response, { status: 'ok', plugin: info.id, openWorlds: row ? 1 : 0 });
        }
        const count = db.prepare('SELECT COUNT(*) AS n FROM worlds').get().n;
        return sendData(response, { status: 'ok', plugin: info.id, openWorlds: count });
    });

    worlds.post('/', (request, response) => {
        const id = String(request.body?.id || '').trim();
        if (!id) return sendError(response, 400, 'A world id is required', 'INVALID_WORLD_ID');
        const existing = db.prepare('SELECT id FROM worlds WHERE id = ?').get(id);
        if (existing) return sendError(response, 409, 'World already exists', 'WORLD_EXISTS');
        db.prepare('INSERT INTO worlds (id, name, metadata) VALUES (?, ?, ?)')
            .run(id, String(request.body?.name || id), JSON.stringify(request.body?.metadata || {}));
        return sendData(response, { id, name: String(request.body?.name || id) });
    });

    worlds.get('/:worldId', (request, response) => {
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

    worlds.get('/:worldId/innerlore/store', (request, response) => {
        const row = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(String(request.params.worldId));
        if (!row) return sendError(response, 404, 'InnerLore store not found', 'STORE_NOT_FOUND');
        return sendData(response, loadShape(row));
    });

    worlds.put('/:worldId/innerlore/store', (request, response) => {
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
            db.exec('BEGIN');
            try {
            const row = db.prepare('SELECT revision FROM stores WHERE world_id = ?').get(worldId);
            const currentRevision = row ? row.revision : 0;
            if (expectedRevision !== null && expectedRevision !== currentRevision) {
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

    worlds.post('/:worldId/innerlore/fork', (request, response) => {
        const sourceId = String(request.params.worldId);
        const targetId = String(request.body?.targetWorldId || '').trim();
        const targetChatId = String(request.body?.targetChatId || '').trim();
        if (!targetId || !targetChatId) return sendError(response, 400, 'targetWorldId and targetChatId are required', 'INVALID_FORK');
        const source = db.prepare('SELECT * FROM stores WHERE world_id = ?').get(sourceId);
        if (!source) return sendError(response, 404, 'Source store not found', 'STORE_NOT_FOUND');
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

    worlds.post('/:worldId/innerlore/rename', (request, response) => {
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

    worlds.delete('/:worldId/innerlore/store', (request, response) => {
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
    worlds.post('/:worldId/innerlore/context/build', (request, response) => sendData(response, null));
    worlds.post('/:worldId/innerlore/event-director/context', (request, response) => sendData(response, null));

    worlds.get('/:worldId/innerlore/context/profiles', (request, response) => {
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

    worlds.put('/:worldId/innerlore/context/profiles/:profileId', (request, response) => {
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

    router.use('/v1/worlds', express.json({ limit: '64mb' }), worlds);
    console.log(`${info.id}: lean SQLite storage ready (${info.id} v1 routes mounted)`);
}

export function exit() {
    try { db?.close(); } catch { /* already closed */ }
}

export default { info, init, exit };
