/**
 * Background work the page hands to the server: per world, three lanes that
 * each run their jobs in order and run beside each other: the world's own
 * work (passes, rebuilds), a person's private replies, and pictures
 * (portraits and the pictures people send). A reply in a conversation never
 * waits for a picture to be drawn, and a picture never waits for a pass. Each
 * kind's handler does the model and image calls and
 * committing to the store. A job survives the page going to sleep because
 * it lives here; its row in SQLite survives a plugin restart as a record of
 * what happened (a job running at restart is marked failed, and the page
 * re-submits on its next sync because nothing moved its watermarks).
 */
import { randomUUID } from 'node:crypto';

const FINISHED = new Set(['done', 'failed', 'cancelled']);
const KEEP_FINISHED_PER_WORLD = 50;
/** How long a finished job's result is kept: a page that slept through it catches up within this. */
export const RESULT_KEEP_MS = 15 * 60_000;
const LANES = Object.freeze({ portrait: 'images', picture: 'images', 'private-reply': 'chat' });

/** The lane a kind of job runs in: 'images', 'chat', or the world's 'main' work. */
export function laneOf(kind) {
    return LANES[kind] || 'main';
}

export function createJobRunner({ db, hub, log = () => {}, now = Date.now, shouldHold = () => false, holdPollMs = 1_000 } = {}) {
    const handlers = new Map();
    const worlds = new Map();
    const jobs = new Map();

    db.exec(`
        CREATE TABLE IF NOT EXISTS jobs (
            id TEXT PRIMARY KEY,
            world_id TEXT NOT NULL,
            chat_id TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL,
            job_key TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL,
            detail TEXT NOT NULL DEFAULT '',
            input TEXT NOT NULL DEFAULT '{}',
            result TEXT NOT NULL DEFAULT 'null',
            error TEXT NOT NULL DEFAULT '',
            base_revision INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            started_at INTEGER,
            finished_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS jobs_world ON jobs(world_id, created_at);
    `);
    // Whatever was running when the plugin last stopped did not finish.
    db.prepare(`UPDATE jobs SET status = 'failed', error = 'the server restarted', finished_at = ?
                WHERE status IN ('queued', 'running')`).run(now());
    // A job's input (the messages it was given) is never kept, and its result (what the model
    // answered) only while a page that slept through it may still ask: nothing older survives a start.
    db.prepare(`UPDATE jobs SET input = '{}', result = 'null' WHERE input != '{}' OR result != 'null'`).run();

    const insert = db.prepare(`INSERT INTO jobs (id, world_id, chat_id, kind, job_key, status, detail, input, result, error, base_revision, created_at, started_at, finished_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const update = db.prepare(`UPDATE jobs SET status = ?, detail = ?, result = ?, error = ?, started_at = ?, finished_at = ? WHERE id = ?`);
    const pruneStatement = db.prepare(`DELETE FROM jobs WHERE world_id = ? AND status IN ('done', 'failed', 'cancelled') AND id NOT IN (
        SELECT id FROM jobs WHERE world_id = ? AND status IN ('done', 'failed', 'cancelled') ORDER BY created_at DESC LIMIT ?)`);
    const forgetResults = db.prepare(`UPDATE jobs SET result = 'null' WHERE result != 'null' AND finished_at IS NOT NULL AND finished_at < ?`);

    const laneKey = (worldId, lane) => `${worldId}\u0000${lane}`;
    const worldOf = (worldId, lane = 'main') => {
        const key = laneKey(worldId, lane);
        if (!worlds.has(key)) worlds.set(key, { worldId, lane, active: null, queue: [], holdTimer: null });
        return worlds.get(key);
    };
    const lanesOf = worldId => [...worlds.values()].filter(entry => entry.worldId === worldId);

    const publicView = job => ({
        id: job.id,
        worldId: job.worldId,
        chatId: job.chatId,
        kind: job.kind,
        key: job.key,
        status: job.status,
        detail: job.detail,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        ...(job.status === 'done' && job.result !== undefined ? { result: job.result } : {}),
    });

    const persist = job => {
        try {
            update.run(job.status, job.detail, JSON.stringify(job.result ?? null).slice(0, 200_000), job.error, job.startedAt, job.finishedAt, job.id);
        } catch (error) {
            log(`could not persist job ${job.id}: ${error?.message || error}`);
        }
    };

    const announce = job => {
        try {
            hub?.broadcast?.(job.worldId, { type: 'job', job: publicView(job) });
        } catch (error) {
            log(`could not announce job ${job.id}: ${error?.message || error}`);
        }
    };

    const finish = (job, status, { error = '', result } = {}) => {
        job.status = status;
        job.error = String(error || '').slice(0, 2_000);
        if (result !== undefined) job.result = result;
        job.finishedAt = now();
        persist(job);
        announce(job);
        try { pruneStatement.run(job.worldId, job.worldId, KEEP_FINISHED_PER_WORLD); } catch { /* bounded history is best effort */ }
        try { forgetResults.run(now() - RESULT_KEEP_MS); } catch { /* best effort, and again at the next start */ }
    };

    async function run(world, job) {
        world.active = job;
        job.status = 'running';
        job.startedAt = now();
        job.controller = new AbortController();
        persist(job);
        announce(job);
        const tools = {
            signal: job.controller.signal,
            log: (...args) => log(`[${job.kind} ${job.id.slice(0, 8)}]`, ...args),
            setDetail(text) {
                job.detail = String(text || '').slice(0, 300);
                persist(job);
                announce(job);
            },
        };
        try {
            const handler = handlers.get(job.kind);
            if (!handler) throw new Error(`no handler for job kind ${job.kind}`);
            const result = await handler(job, tools);
            if (job.controller.signal.aborted) finish(job, 'cancelled', { error: job.cancelReason || 'cancelled' });
            else finish(job, 'done', { result });
        } catch (error) {
            if (job.controller.signal.aborted || error?.name === 'AbortError') finish(job, 'cancelled', { error: job.cancelReason || error?.message || 'cancelled' });
            else {
                log(`job ${job.kind} ${job.id.slice(0, 8)} failed: ${error?.message || error}`);
                finish(job, 'failed', { error: error?.message || String(error) });
            }
        } finally {
            job.controller = null;
            world.active = null;
            jobs.delete(job.id);
            setTimeout(() => pump(job.worldId, world.lane), 0);
        }
    }

    /** Starts the next job of one lane of a world, or of every lane when none is named. */
    function pump(worldId, lane) {
        if (!lane) {
            for (const entry of lanesOf(worldId)) pump(worldId, entry.lane);
            return;
        }
        const world = worldOf(worldId, lane);
        if (world.active || !world.queue.length) return;
        const next = world.queue[0];
        try {
            if (shouldHold(next)) {
                clearTimeout(world.holdTimer);
                world.holdTimer = setTimeout(() => pump(worldId, lane), holdPollMs);
                world.holdTimer.unref?.();
                return;
            }
        } catch (error) {
            log(`hold check failed: ${error?.message || error}`);
        }
        world.queue.shift();
        void run(world, next);
    }

    return {
        register(kind, handler) {
            handlers.set(kind, handler);
        },
        /**
         * Queues a job. A queued or running job of the same world, kind and
         * key is returned instead of a duplicate; with `replace`, a queued one
         * takes the new input (a newer pass request supersedes the waiting one).
         */
        submit({ worldId, chatId = '', kind, key = '', input = {}, directories = null, baseRevision = 0, replace = false }) {
            if (!worldId || !kind) throw new Error('a job needs a world and a kind');
            const lane = laneOf(kind);
            const world = worldOf(worldId, lane);
            const existing = [world.active, ...world.queue].find(job => job && job.kind === kind && job.key === key);
            if (existing) {
                if (replace && existing.status === 'queued') {
                    existing.input = input;
                    existing.directories = directories;
                    existing.baseRevision = baseRevision;
                }
                return { jobId: existing.id, coalesced: true, job: publicView(existing) };
            }
            const job = {
                id: randomUUID(), worldId, chatId, kind, key, input, directories, baseRevision,
                status: 'queued', detail: '', error: '', result: undefined,
                createdAt: now(), startedAt: null, finishedAt: null, controller: null, cancelReason: '',
            };
            jobs.set(job.id, job);
            world.queue.push(job);
            try {
                // The input stays in memory for the run; the table keeps only what the job is.
                insert.run(job.id, worldId, chatId, kind, key, job.status, '', '{}', 'null', '', baseRevision, job.createdAt, null, null);
            } catch (error) {
                log(`could not record job ${job.id}: ${error?.message || error}`);
            }
            announce(job);
            setTimeout(() => pump(worldId, lane), 0);
            return { jobId: job.id, coalesced: false, job: publicView(job) };
        },
        cancel(jobId, reason = 'cancelled') {
            const job = jobs.get(jobId);
            if (!job) return null;
            job.cancelReason = String(reason || 'cancelled');
            if (job.status === 'queued') {
                const world = worldOf(job.worldId, laneOf(job.kind));
                world.queue = world.queue.filter(entry => entry !== job);
                jobs.delete(job.id);
                finish(job, 'cancelled', { error: job.cancelReason });
                setTimeout(() => pump(job.worldId, world.lane), 0);
                return publicView(job);
            }
            job.controller?.abort(new DOMException(job.cancelReason, 'AbortError'));
            return publicView(job);
        },
        get(jobId) {
            const live = jobs.get(jobId);
            if (live) return publicView(live);
            const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(jobId);
            return row ? rowView(row) : null;
        },
        /** Queued and running jobs of a world, every lane (or every job the table remembers). */
        list(worldId, { active = true } = {}) {
            const live = lanesOf(worldId).flatMap(world => [world.active, ...world.queue]).filter(Boolean).map(publicView);
            if (active) return live;
            const rows = db.prepare('SELECT * FROM jobs WHERE world_id = ? ORDER BY created_at DESC LIMIT 100').all(worldId);
            return rows.map(rowView);
        },
        /** The model work in flight for a world: its own (a pass, a rebuild), else a private reply; never a picture being drawn. */
        activeJob(worldId) {
            return worlds.get(laneKey(worldId, 'main'))?.active || worlds.get(laneKey(worldId, 'chat'))?.active || null;
        },
        /** Jobs of a world that finished in the last `withinMs`, newest first: what a page that was away missed. */
        recent(worldId, withinMs = RESULT_KEEP_MS) {
            const since = now() - withinMs;
            return db.prepare(`SELECT * FROM jobs WHERE world_id = ? AND status IN ('done', 'failed', 'cancelled') AND finished_at >= ?
                               ORDER BY finished_at DESC LIMIT 20`).all(worldId, since).map(rowView);
        },
        /** A world that is being deleted takes its queued and running jobs with it. */
        cancelWorld(worldId, reason = 'the world was deleted') {
            const cancelled = lanesOf(worldId).flatMap(world => [...world.queue, world.active]).filter(Boolean);
            if (!cancelled.length) return 0;
            for (const job of cancelled) this.cancel(job.id, reason);
            return cancelled.length;
        },
        /** Nudges a world whose hold condition may have cleared (a story claim ended). */
        pump,
        close() {
            for (const world of worlds.values()) {
                clearTimeout(world.holdTimer);
                world.active?.controller?.abort(new DOMException('the server is stopping', 'AbortError'));
            }
        },
    };

    function rowView(row) {
        let result = null;
        try { result = JSON.parse(row.result); } catch { result = null; }
        return {
            id: row.id, worldId: row.world_id, chatId: row.chat_id, kind: row.kind, key: row.job_key, status: row.status,
            detail: row.detail, error: row.error, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at,
            ...(row.status === 'done' ? { result } : {}),
        };
    }
}
