/**
 * The rebuild job: after an edit, swipe or deletion (or on request) the
 * world is re-derived from the chat, on the server, with the same routine
 * the page used to run: a resume from the newest checkpoint that still
 * matches the history when the change was a late one, a full replay
 * otherwise. The rebuilt store replaces the latest revision whole (the
 * portraits and the manual edits are carried), and is pushed to every page.
 */
import { normalizeStore } from '../../../core.js?v=49';
import { requestJsonPatch } from '../../../llm-client.js?v=21';
import { requestProgressionPatch } from '../../../progression-client.js?v=2';
import { requestGamePatch } from '../../../game-client.js?v=4';
import { analyzePassRange, assistedForModel, rebuildStore, structuredFoundationBrains } from '../../../pass-pipeline.js?v=5';
import { providerOf } from '../provider-budget.js';

const clone = value => JSON.parse(JSON.stringify(value));

async function scheduleAll(tasks) {
    const settled = await Promise.allSettled(tasks.map(task => task.run()));
    const outcomes = {};
    tasks.forEach((task, index) => {
        outcomes[task.name] = settled[index].status === 'fulfilled' ? { value: settled[index].value } : { error: settled[index].reason };
    });
    return outcomes;
}

export function createRebuildJob({ store, log = () => {} }) {
    return async function runRebuild(job, tools) {
        const input = job.input || {};
        const chat = Array.isArray(input.chat) ? input.chat : [];
        const connections = input.connections && typeof input.connections === 'object' ? input.connections : {};
        const settings = {
            ...(input.settings || {}),
            serverRoute: {
                connections,
                directories: job.directories,
                names: { characterName: input.characterName || 'Narrator', playerName: input.playerName || 'You' },
            },
        };
        const current = store.read(job.worldId);
        if (!current?.store) throw new Error('the world has no store yet');
        const oldStore = normalizeStore(clone(current.store), job.chatId || current.chatId);
        const assisted = profileId => {
            const connection = connections[profileId];
            return assistedForModel(connection?.model, providerOf(connection), settings.assistedBackground || 'auto');
        };
        const deps = {
            chat,
            playerName: input.playerName || 'You',
            characterName: input.characterName || 'Narrator',
            persona: input.persona || '',
            cardContext: input.cardContext || '',
            settings,
            signal: tools.signal,
            requests: {
                curator: (passSettings, messages, signal) => requestJsonPatch({ ...passSettings, serverRoute: settings.serverRoute }, messages, signal),
                progression: (passSettings, messages, signal, options) => requestProgressionPatch({ ...passSettings, serverRoute: settings.serverRoute }, messages, signal, options),
                game: (passSettings, messages, signal, task, options) => requestGamePatch({ ...passSettings, serverRoute: settings.serverRoute }, messages, signal, task, options),
            },
            assisted,
            schedule: scheduleAll,
            hasFoundationBrains: candidate => structuredFoundationBrains(candidate).length > 0,
            log: (...args) => tools.log(...args),
        };
        let rebuilt;
        try {
            rebuilt = await rebuildStore({
                chat,
                oldStore,
                settings,
                automatic: input.automatic === true,
                cardSeeds: Array.isArray(input.cardSeeds) ? input.cardSeeds : [],
                analyze: (target, start, end, options) => analyzePassRange(target, start, end, options, deps),
                onBatch: (start, end, total) => tools.setDetail(`rebuilding messages ${start}–${end} of ${total}`),
            });
        } catch (error) {
            if (error?.name === 'AbortError' || tools.signal.aborted) throw error;
            const message = String(error?.message || error).slice(0, 2_000);
            store.commit(job.worldId, job.chatId, latest => {
                latest.needsRebuild = true;
                if (error?.name !== 'InnerLoreHistoryChangedError') {
                    latest.lastError = message;
                    latest.lastFailureAt = Date.now();
                    latest.consecutiveFailures = Math.max(0, Number(latest.consecutiveFailures) || 0) + 1;
                    // A resumed rebuild that failed for good may sit on an
                    // unusable checkpoint: the retry starts clean.
                    if (error?.resumedFromCheckpoint && !error?.transient) latest.checkpoints = [];
                }
                latest.updatedAt = Date.now();
                return latest;
            }, { reason: 'rebuild-failed' });
            throw error;
        }
        if (rebuilt.nothingToRebuild) {
            // Every message any subsystem read still says the same: lift the quarantine, replay nothing.
            const lifted = store.commit(job.worldId, job.chatId, latest => {
                if (!latest.needsRebuild) return null;
                latest.needsRebuild = false;
                latest.updatedAt = Date.now();
                return latest;
            }, { reason: 'rebuild-skipped' });
            log(`nothing InnerLore had read changed; no rebuild (revision ${lifted?.revision ?? 'unchanged'})`);
            return { summary: 'Nothing InnerLore had read changed; no rebuild was needed.', nothingToRebuild: true, automatic: input.automatic === true, revision: lifted?.revision ?? null, messages: chat.length };
        }
        const committed = store.commit(job.worldId, job.chatId, latest => {
            const next = rebuilt.store;
            // What the rebuild does not derive and the latest revision owns.
            next.portraits = latest.portraits && typeof latest.portraits === 'object' ? latest.portraits : (next.portraits || {});
            next.pictures = latest.pictures && typeof latest.pictures === 'object' ? latest.pictures : (next.pictures || {});
            next.chatId = latest.chatId || next.chatId;
            return next;
        }, { reason: 'rebuild' });
        const summary = `Rebuilt ${Object.keys(rebuilt.store.entities || {}).length} lore entries, ${Object.keys(rebuilt.store.brains || {}).length} character minds from ${chat.length} messages${rebuilt.resumedFrom >= 0 ? ` (resumed from message ${rebuilt.resumedFrom})` : ''}.`;
        log(`${summary} revision ${committed?.revision ?? '(unchanged)'}`);
        return { summary, automatic: input.automatic === true, revision: committed?.revision ?? null, resumedFrom: rebuilt.resumedFrom, messages: chat.length };
    };
}
