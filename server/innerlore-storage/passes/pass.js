/**
 * The pass job: the curator, world progression, game ledger and scene planner
 * run on the server with the same pipeline the page used to run, against a
 * working copy of the store read at the start. When the models have
 * answered, the result is a patch (what the pass changed) applied onto the
 * latest revision inside a transaction, so edits the page saved meanwhile
 * survive, and the new revision is pushed to every page on the world.
 */
import { normalizeStore } from '../../../core.js?v=49';
import { requestJsonPatch, setRequestTransport } from '../../../llm-client.js?v=21';
import { requestProgressionPatch } from '../../../progression-client.js?v=2';
import { requestGamePatch } from '../../../game-client.js?v=4';
import { analyzePassRange, assistedForModel, lastCompletedStoryIndex, planPass, runPassBatches, structuredFoundationBrains, summarizeRun } from '../../../pass-pipeline.js?v=5';
import { applyPatch, diffStore } from '../../../store-diff.js?v=4';
import { providerOf } from '../provider-budget.js';

const clone = value => JSON.parse(JSON.stringify(value));

/** Routes the shared client modules' requests through the server transport. Call once at plugin init. */
export function installServerTransport(llm) {
    setRequestTransport(async (settings, messages, signal, options = {}) => {
        const route = settings.serverRoute || {};
        const connections = route.connections || {};
        const connection = connections[settings.connectionProfileId];
        if (!connection) throw new Error(`The job has no record for connection ${settings.connectionProfileId || '(none)'}.`);
        const fallback = connections[settings.fallbackConnectionProfileId] || null;
        const maxTokens = Math.max(800, Math.min(32_000, Number(settings.maximumResponseTokens) || 6_000));
        return llm.request({
            connection,
            fallback,
            messages,
            maxTokens,
            temperature: Number(settings.temperature) || 0.15,
            topP: 0.9,
            jsonSchema: options.jsonSchema || null,
            names: route.names || {},
            directories: route.directories,
            signal,
            attempts: Math.max(1, Math.min(3, Number(settings.requestMaximumAttempts) || 3)),
            fallbackAttempts: Math.max(1, Math.min(2, Number(settings.fallbackRequestMaximumAttempts) || 1)),
            timeoutMs: Math.max(15_000, Math.min(300_000, (Number(settings.requestTimeoutSeconds) || 90) * 1_000)),
            breakerMs: Math.max(15_000, Math.min(300_000, (Number(settings.requestCircuitBreakerSeconds) || 90) * 1_000)),
            kind: settings.telemetryKind || 'background',
        });
    });
}

/** Every task at once; the provider budget inside the transport paces them. */
async function scheduleAll(tasks) {
    const settled = await Promise.allSettled(tasks.map(task => task.run()));
    const outcomes = {};
    tasks.forEach((task, index) => {
        outcomes[task.name] = settled[index].status === 'fulfilled' ? { value: settled[index].value } : { error: settled[index].reason };
    });
    return outcomes;
}

export function createPassJob({ store, log = () => {} }) {
    return async function runPass(job, tools) {
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
        const base = clone(current.store);
        const working = normalizeStore(clone(current.store), job.chatId || current.chatId);
        const targetIndex = lastCompletedStoryIndex(chat);
        if (targetIndex < 0) return { skipped: true, reason: 'no completed reply' };
        const plan = planPass({ chat, store: working, settings, targetIndex, force: input.force === true });
        if (!plan.run) return { skipped: true, reason: 'nothing due', summary: 'No narrative text required analysis.' };
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
        tools.setDetail(`messages ${plan.startIndex}–${plan.finalIndex}`);
        let result;
        try {
            result = await runPassBatches(working, plan, {
                chat,
                settings,
                analyze: (target, start, end, options) => analyzePassRange(target, start, end, options, deps),
                onBatch: (start, end) => tools.setDetail(`messages ${start}–${end}`),
            });
        } catch (error) {
            if (error?.name === 'InnerLoreHistoryChangedError') {
                store.commit(job.worldId, job.chatId, latest => { latest.needsRebuild = true; latest.updatedAt = Date.now(); return latest; }, { reason: 'pass-history' });
            } else if (error?.name !== 'AbortError' && !tools.signal.aborted) {
                const message = String(error?.message || error).slice(0, 2_000);
                store.commit(job.worldId, job.chatId, latest => {
                    latest.lastError = message;
                    latest.lastFailureAt = Date.now();
                    latest.consecutiveFailures = Math.max(0, Number(latest.consecutiveFailures) || 0) + 1;
                    latest.updatedAt = Date.now();
                    return latest;
                }, { reason: 'pass-failed' });
            }
            throw error;
        }
        // What the pass changed, onto whatever the store holds now. The turn
        // counter is settled against the latest value, not the copy's, so
        // replies that landed during the pass stay counted; the watermarks
        // only ever move forward.
        const patch = diffStore(base, working);
        delete patch.set.assistantTurnsSincePass;
        const committed = store.commit(job.worldId, job.chatId, latest => {
            if (latest.needsRebuild) return null;
            const turnsBefore = Math.max(0, Number(latest.assistantTurnsSincePass) || 0);
            applyPatch(latest, patch);
            latest.lastProcessedIndex = Math.max(Number(latest.lastProcessedIndex ?? -1), Number(working.lastProcessedIndex ?? -1));
            if (latest.progression && working.progression) {
                latest.progression.lastProcessedIndex = Math.max(Number(latest.progression.lastProcessedIndex ?? -1), Number(working.progression.lastProcessedIndex ?? -1));
            }
            if (latest.game && working.game) {
                latest.game.lastProcessedIndex = Math.max(Number(latest.game.lastProcessedIndex ?? -1), Number(working.game.lastProcessedIndex ?? -1));
            }
            latest.assistantTurnsSincePass = plan.runCurator ? Math.max(0, turnsBefore - plan.assistantTurnsCoveredAtStart) : turnsBefore;
            return latest;
        }, { reason: 'pass' });
        const summary = summarizeRun(result);
        log(`pass ${plan.startIndex}–${plan.finalIndex} committed as revision ${committed?.revision ?? '(discarded)'}: ${summary}`);
        return {
            summary,
            skipped: Boolean(result?.skipped),
            discarded: Boolean(committed?.unchanged),
            revision: committed?.revision ?? null,
            range: [plan.startIndex, plan.finalIndex],
            entities: result?.entityResult ? { created: result.entityResult.created, updated: result.entityResult.updated } : null,
            minds: result?.mindResult ? { created: result.mindResult.created, updated: result.mindResult.updated } : null,
            game: result?.gameResult ? { applied: result.gameResult.applied } : null,
            errors: ['curatorError', 'progressionError', 'gameError', 'plannerError'].filter(key => result?.[key]).map(key => `${key}: ${result[key]?.message || result[key]}`),
        };
    };
}
