/**
 * The background pass, free of the page: which messages the curator, world
 * progression, game ledger and scene planner should read next, the prompts
 * for each, and how their answers are folded into the store. The browser
 * fallback and the server's pass job both run this; what differs (how a
 * model request is sent, who the player is, the character card) arrives as
 * `deps`, so the same code produces the same store either way.
 *
 * Pure: no DOM, no SillyTavern. Every function takes the chat as an array of
 * messages ({ mes, is_user, is_system, name, extra }).
 */
import {
    EXPRESSION_FOUNDATION_VERSION,
    alignExplicitLocationOperations,
    applyStoreCheckpoint,
    canonicalNameKey,
    cleanString,
    cleanTextMentions,
    createEmptyStore,
    createStoreCheckpoint,
    firstDivergenceIndex,
    selectResumeCheckpoint,
    ensurePlayerEntity,
    mergeEntityOperations,
    mergeMindOperations,
    messageRangeMatchesSnapshot,
    playerEntityKeys,
    recordCheckpoint,
    refreshMentionRecency,
    resolveLocationReference,
    snapshotMessageRange,
} from './core.js?v=49';
import { deriveCameraFrame, deriveSceneState } from './scene.js?v=8';
import { collectRecentStoryExpressions } from './expression-cooldown.js';
import { buildAnalysisMessages, formatTranscript } from './prompts.js?v=12';
import { decideInnerLoreMaintenance } from './maintenance-scheduler.js?v=4';
import { buildProgressionMessages } from './progression-prompts.js?v=2';
import { applyProgressionPatch, createProgressionState, formatClockRange, normalizeProgressionState } from './progression.js';
import { resetTriggerEventRuntime } from './trigger-events.js';
import { isTransientRequestError } from './llm-client.js?v=21';
import { triggerEventAgentSnapshot } from './trigger-events.js';
import {
    ABILITY_KEYS,
    abilitiesKnown,
    applyGameOperations,
    entryText,
    gameContext,
    gameStateBefore,
    groundedRecords,
    introductionOperations,
    needsStartingKit,
    normalizeGameRecords,
    normalizeGameState,
    placeRefOf,
    plannerTargets,
    nameKey,
    reconcileGameIdentities,
    supersededPlannerPrices,
} from './game.js?v=6';
import { buildGiftMessages, buildLedgerMessages, buildPlannerMessages } from './game-prompts.js?v=7';
import { normalizeCommunication } from './communication.js?v=1';
import { actionEntriesInRange, dropDuplicateLedgerOps } from './game-actions.js?v=3';

const clone = value => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

// ---- message indexes ----

export function lastCompletedStoryIndex(messages, endIndex = messages.length - 1) {
    let index = Math.min(messages.length - 1, endIndex);
    while (index >= 0) {
        const message = messages[index];
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) return index;
        index--;
    }
    return -1;
}

export function lastPlayerMessageIndex(messages, endIndex = messages.length - 1) {
    for (let index = Math.min(messages.length - 1, endIndex); index >= 0; index--) {
        const message = messages[index];
        if (message?.is_user && !message.is_system && cleanString(message.mes)) return index;
    }
    return -1;
}

export function firstCompletedStoryIndex(messages, startIndex = 0, endIndex = messages.length - 1) {
    const finalIndex = Math.min(messages.length - 1, endIndex);
    for (let index = Math.max(0, startIndex); index <= finalIndex; index++) {
        const message = messages[index];
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) return index;
    }
    return -1;
}

export function completedAssistantTurnCount(messages, startIndex = 0, endIndex = messages.length - 1) {
    const finalIndex = Math.min(messages.length - 1, endIndex);
    let count = 0;
    for (let index = Math.max(0, startIndex); index <= finalIndex; index++) {
        const message = messages[index];
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) count++;
    }
    return count;
}

/**
 * End a rebuild batch on a completed story reply. This keeps a player action
 * and the reply that resolves it in the same curator range even when the raw
 * numeric lookback boundary falls between them.
 */
export function completedRebuildBatchEnd(messages, startIndex, targetIndex, maximumMessages) {
    const candidateEnd = Math.min(
        targetIndex,
        startIndex + Math.max(1, Number(maximumMessages) || 1) - 1,
    );
    const completedAtOrBeforeBoundary = lastCompletedStoryIndex(messages, candidateEnd);
    if (completedAtOrBeforeBoundary >= startIndex) return completedAtOrBeforeBoundary;
    return firstCompletedStoryIndex(messages, startIndex, targetIndex);
}

export function boundedProgressionEnd(messages, startIndex, candidateEnd, maximumMessages, maximumCharacters = 85_000) {
    if (candidateEnd < startIndex) return -1;
    let characters = 0;
    let lastCompleted = -1;
    let relevantMessages = 0;
    const messageLimit = Math.max(2, maximumMessages);
    for (let index = startIndex; index <= candidateEnd; index++) {
        const message = messages[index];
        const relevant = message
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes);
        if (!relevant) continue;
        if (lastCompleted >= startIndex && relevantMessages >= messageLimit) break;
        const messageCharacters = cleanString(message?.mes, 30_000).length + 160;
        if (lastCompleted >= startIndex && characters + messageCharacters > maximumCharacters) break;
        relevantMessages++;
        characters += messageCharacters;
        if (message
            && !message.is_user
            && (!message.is_system || message.extra?.sc_ghosted === true)
            && cleanString(message.mes)) lastCompleted = index;
    }
    return lastCompleted;
}

/** The messages of a passage as `{index, text}`, for locating a matched condition's evidence. */
export function passageMessagesFor(chat, startIndex, endIndex) {
    const messages = [];
    for (let index = Math.max(0, startIndex); index <= endIndex && index < (chat?.length || 0); index++) {
        const text = chat[index]?.mes;
        if (typeof text === 'string' && text.trim()) messages.push({ index, text });
    }
    return messages;
}

/** The chat as a job carries it: only the fields the passes read. */
export function trimChatForJob(chat) {
    return (Array.isArray(chat) ? chat : []).map(message => (message ? {
        mes: typeof message.mes === 'string' ? message.mes : '',
        is_user: Boolean(message.is_user),
        is_system: Boolean(message.is_system),
        name: typeof message.name === 'string' ? message.name : '',
        ...(message.extra && (message.extra.sc_ghosted !== undefined || message.extra.inner_lore_private !== undefined)
            ? { extra: { ...(message.extra.sc_ghosted !== undefined ? { sc_ghosted: message.extra.sc_ghosted } : {}), ...(message.extra.inner_lore_private !== undefined ? { inner_lore_private: message.extra.inner_lore_private } : {}) } }
            : {}),
    } : null));
}

// ---- which connection, and whether the model gets help ----

/**
 * Background help for smaller models (list-first ledger, code-found hints,
 * evidence check): on for a model under 70B by its name (Gemma 4 31B, Qwen
 * 27B), off for large or unnamed ones (Claude, GLM 4.6), unless the setting
 * forces it. An unnamed size on NovelAI's single slot is its GLM 4.6; on a
 * provider with a request budget (NanoGPT) unnamed models are the large ones.
 */
export function assistedForModel(model, provider, mode = 'auto') {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    const sizes = [...String(model || '').matchAll(/(\d+(?:\.\d+)?)\s*[bB](?![a-z])/gu)].map(match => Number(match[1]));
    const size = sizes.length ? Math.max(...sizes) : Infinity;
    return size < 70 || (!Number.isFinite(size) && provider === 'novelai.net');
}

export function plannerProfileId(settings) {
    return settings.plannerConnectionProfileId || settings.progressionConnectionProfileId || settings.connectionProfileId;
}

export function plannerPlaces(plan) {
    return (Array.isArray(plan?.targets) ? plan.targets : []).map(target => cleanString(target?.name, 240)).filter(Boolean);
}

// ---- the expression foundation (card-backed psychology a mind must carry) ----

export const FOUNDATION_OUTER_VOICE_KINDS = new Set([
    'cadence',
    'hesitation',
    'emotional_openness',
    'pressure_shift',
]);

export function cardBackedEntries(entries) {
    return Object.fromEntries(Object.entries(entries || {}).filter(([, entry]) => (
        entry?.basis === 'character_card'
    )));
}

export function hasStructuredExpressionFoundation(brain) {
    const facets = Object.values(brain?.persistentSelf?.facets || {})
        .filter(entry => entry?.basis === 'character_card');
    const voice = Object.values(brain?.persistentSelf?.voice || {})
        .filter(entry => entry?.basis === 'character_card');
    return facets.some(entry => entry.kind === 'personal_anchor')
        && voice.some(entry => entry.kind === 'thought_style')
        && voice.some(entry => entry.kind === 'emphasis')
        && voice.some(entry => FOUNDATION_OUTER_VOICE_KINDS.has(entry.kind));
}

export function structuredFoundationBrains(store) {
    return Object.values(store?.brains || {}).filter(brain => (
        brain?.active !== false && hasStructuredExpressionFoundation(brain)
    ));
}

// ---- what a rebuild carries over from the old store ----

function namesOf(record) {
    return [record?.name, record?.character, ...(Array.isArray(record?.aliases) ? record.aliases : [])]
        .map(name => canonicalNameKey(name || ''))
        .filter(Boolean);
}

/**
 * An automatic rebuild re-reads the chat after a change at `divergence`.
 * A person, place or mind whose first and last appearance both come before
 * it does not depend on the change, so one the re-read failed to recreate is
 * kept as it was, unless the re-read already holds the same person under one
 * of their names (a record it merged).
 */
export function carryUntouchedRecords(oldStore, newStore, divergence) {
    if (!Number.isFinite(divergence)) return 0;
    let carried = 0;
    // Only a record the story actually showed before the change (a known
    // last appearance); one of unknown provenance proves nothing.
    const before = record => Number.isInteger(record?.firstSeenMessage) && Number.isInteger(record?.lastSeenMessage)
        && record.lastSeenMessage >= 0 && record.firstSeenMessage < divergence && record.lastSeenMessage < divergence;
    for (const field of ['entities', 'brains']) {
        const target = newStore[field] && typeof newStore[field] === 'object' ? newStore[field] : (newStore[field] = {});
        const taken = new Set(Object.values(target).flatMap(namesOf));
        for (const [id, record] of Object.entries(oldStore?.[field] || {})) {
            if (target[id] || !before(record) || record?.player) continue;
            if (namesOf(record).some(name => taken.has(name))) continue;
            target[id] = clone(record);
            for (const name of namesOf(record)) taken.add(name);
            carried++;
        }
    }
    return carried;
}

/** Every name the old store knew a record by stays with the rebuilt record of the same id. */
export function carryIdentity(oldStore, newStore) {
    for (const field of ['entities', 'brains']) {
        for (const [id, record] of Object.entries(newStore?.[field] || {})) {
            const old = oldStore?.[field]?.[id];
            if (!old) continue;
            const own = canonicalNameKey(record.name || record.character || '');
            const aliases = [...(Array.isArray(record.aliases) ? record.aliases : [])];
            for (const alias of Array.isArray(old.aliases) ? old.aliases : []) {
                const key = canonicalNameKey(alias);
                if (!key || key === own || aliases.some(existing => canonicalNameKey(existing) === key)) continue;
                aliases.push(alias);
            }
            if (aliases.length) record.aliases = aliases;
            if (Array.isArray(record.keys) && Array.isArray(old.keys)) {
                for (const key of old.keys) if (!record.keys.includes(key)) record.keys.push(key);
            }
        }
    }
}


export function carryManualState(oldStore, newStore) {
    for (const [id, oldRecord] of Object.entries(oldStore.entities || {})) {
        const current = newStore.entities[id];
        if (current) {
            current.pinned = oldRecord.pinned;
            current.enabled = oldRecord.enabled;
            if (oldRecord.manualOverride) {
                current.manualOverride = true;
                current.manualContent = oldRecord.manualContent;
            }
        } else if (oldRecord.manualOverride) {
            newStore.entities[id] = clone(oldRecord);
            newStore.entities[id].entryUid = null;
            newStore.entities[id].renderedHash = '';
        }
    }
    for (const [id, oldBrain] of Object.entries(oldStore.brains || {})) {
        const current = newStore.brains[id];
        if (current) {
            current.pinned = oldBrain.pinned;
            current.enabled = oldBrain.enabled;
        }
    }
}

/**
 * Persist only character-card-backed psychology from the preflight.  These
 * fields are safe across swipes; transient mind state and story-derived
 * beliefs remain in the branch-local staging view until the full rebuild.
 */
export function copyCardExpressionFoundation(destination, source, options = {}) {
    if (!destination || !source) return 0;
    const copyCurrentMind = options.copyCurrentMind ?? !destination.needsRebuild;
    let copied = 0;
    destination.brains = destination.brains && typeof destination.brains === 'object'
        ? destination.brains
        : {};
    for (const sourceBrain of structuredFoundationBrains(source)) {
        const id = sourceBrain.id || canonicalNameKey(sourceBrain.name);
        if (!id) continue;
        const sourceFacets = cardBackedEntries(sourceBrain.persistentSelf?.facets);
        const sourceVoice = cardBackedEntries(sourceBrain.persistentSelf?.voice);
        const sourceRelationships = Object.fromEntries(
            Object.entries(sourceBrain.persistentSelf?.relationships || {}).flatMap(([relationshipId, relationship]) => {
                const aspects = cardBackedEntries(relationship?.aspects);
                return Object.keys(aspects).length
                    ? [[relationshipId, { ...clone(relationship), aspects }]]
                    : [];
            }),
        );
        let target = destination.brains[id];
        if (!target) {
            target = clone(sourceBrain);
            target.currentMind = copyCurrentMind ? clone(sourceBrain.currentMind) : null;
            target.persistentSelf = {
                facets: sourceFacets,
                voice: sourceVoice,
                relationships: sourceRelationships,
            };
            destination.brains[id] = target;
        } else {
            target.persistentSelf = target.persistentSelf && typeof target.persistentSelf === 'object'
                ? target.persistentSelf
                : { facets: {}, voice: {}, relationships: {} };
            target.persistentSelf.facets = {
                ...(target.persistentSelf.facets || {}),
                ...clone(sourceFacets),
            };
            target.persistentSelf.voice = {
                ...(target.persistentSelf.voice || {}),
                ...clone(sourceVoice),
            };
            target.persistentSelf.relationships = target.persistentSelf.relationships || {};
            for (const [relationshipId, relationship] of Object.entries(sourceRelationships)) {
                const current = target.persistentSelf.relationships[relationshipId];
                target.persistentSelf.relationships[relationshipId] = current
                    ? {
                        ...current,
                        aspects: { ...(current.aspects || {}), ...clone(relationship.aspects) },
                    }
                    : clone(relationship);
            }
            if (copyCurrentMind && sourceBrain.currentMind) {
                target.currentMind = clone(sourceBrain.currentMind);
            }
            target.updatedAt = Date.now();
        }
        copied++;
    }
    if (copied) {
        destination.expressionFoundationVersion = EXPRESSION_FOUNDATION_VERSION;
        destination.updatedAt = Date.now();
    }
    return copied;
}

// ---- the game side ----

export function alreadyRecordedLines(store, start, end, playerName) {
    const game = normalizeGameState(store.game);
    return actionEntriesInRange(game, start, end).map(entry => entryText(entry, game, playerName)).filter(Boolean);
}

export function gamePlaceOf(scene, store) {
    const name = cleanString(scene?.location?.name, 240);
    if (!name) return null;
    const entities = store?.entities || {};
    return placeRefOf((scene.location.id && entities[scene.location.id]) || resolveLocationReference(entities, name), name);
}

export function codecStatsFromResponse(response) {
    if (!response) return null;
    const diagnostics = Array.isArray(response.parseDiagnostics) ? response.parseDiagnostics : [];
    const normalizations = {};
    for (const item of diagnostics) {
        if (!item?.code) continue;
        normalizations[item.code] = (normalizations[item.code] || 0) + 1;
    }
    return {
        format: response.outputFormat === 'dsl' ? 'dsl' : 'json',
        repaired: Boolean(response.repaired),
        salvaged: diagnostics.some(item => (
            item.code === 'truncated_tail_dropped' || item.code === 'missing_done_salvaged'
        )),
        crossFormat: diagnostics.some(item => item.code === 'cross_format_json_accepted'),
        normalizations,
        firstError: cleanString(response.firstError, 500),
    };
}

function mergeCodecSignals(accumulator, codec) {
    if (!codec || typeof codec !== 'object') return accumulator;
    return {
        seen: true,
        format: codec.format === 'dsl' || accumulator.format === 'dsl' ? 'dsl' : 'json',
        salvaged: accumulator.salvaged || Boolean(codec.salvaged),
        crossFormat: accumulator.crossFormat || Boolean(codec.crossFormat),
        repaired: accumulator.repaired || Boolean(codec.repaired),
        normalizations: accumulator.normalizations
            + Object.values(codec.normalizations || {}).reduce((sum, value) => sum + value, 0),
    };
}

/**
 * What the planner should prepare for this scene: where the player is when it
 * has no stage (or a stale one), places reachable from it, and the starting
 * kit while the purse was never counted. Null when nothing is needed.
 */
export function plannerPlanFor(store, scene, index, settings, playerName, { heading = false, prefetch = settings.scenePlannerPrefetch !== false } = {}) {
    if (!scene?.location?.name) return null;
    store.game = normalizeGameState(store.game);
    const targets = plannerTargets(store.game, {
        store,
        scene,
        heading,
        camera: prefetch ? deriveCameraFrame(scene, store, { playerName }) : null,
        clockSeconds: Number(store.progression?.clock?.estimatedSeconds),
        staleSeconds: Math.max(1, Number(settings.scenePlannerStaleHours) || 8) * 3_600,
        prefetch,
        maximum: prefetch ? Math.max(1, Math.min(3, Number(settings.scenePlannerMaximumPlaces) || 2)) : 1,
    });
    const startingKit = needsStartingKit(store.game) && !store.game.planner?.kitOffered;
    return targets.length || startingKit ? { targets, startingKit, index } : null;
}

/** The planner's prompt for a plan; `deps` names the player, the card and the chat. */
export function plannerMessagesFor(store, plan, deps) {
    const end = plan.atSend ? deps.chat.length - 1 : plan.index;
    return buildPlannerMessages({
        game: store.game,
        store,
        targets: plan.targets,
        startingKit: plan.startingKit,
        assisted: deps.assisted(plannerProfileId(deps.settings)),
        playerName: deps.playerName,
        persona: deps.persona,
        characterCard: deps.cardContext,
        clockLabel: store.progression?.clock?.currentTimeLabel,
        recentTranscript: formatTranscript(deps.chat, {
            startIndex: Math.max(0, end - 3),
            endIndex: end,
            userName: deps.playerName,
            characterName: deps.characterName,
            maximumCharacters: 12_000,
        }),
        settings: deps.settings,
    });
}

export const MAXIMUM_NEWCOMERS_PER_PASS = 6;

/**
 * Anyone this passage shows whose gifts the game has not weighed yet (a
 * person the curator just made, one from the card's seed, someone met before
 * gifts were tracked) is judged now, in one short background request by the
 * world's rules. A person the answer leaves out is an ordinary, open mind.
 * Nothing to do when the world has no mind-speech.
 */
export async function settleNewcomerGifts(targetStore, { chat = [], playerName = '', settings = {}, start = 0, end = -1, cardContext = '', request, log = () => {} } = {}) {
    const world = normalizeCommunication(settings?.communication);
    if (!world.mind || settings?.gameEnabled === false || typeof request !== 'function' || end < 0) return null;
    const state = normalizeGameState(targetStore.game);
    const passage = (Array.isArray(chat) ? chat : []).slice(Math.max(0, start), end + 1)
        .filter(message => message && !message.is_system).map(message => String(message.mes || '')).join('\n');
    if (!passage.trim()) return null;
    const playerKey = canonicalNameKey(playerName);
    const people = Object.values(targetStore.entities || {})
        .filter(record => ['character', 'creature'].includes(String(record?.type || '').toLocaleLowerCase()) && record.enabled !== false && !record.player
            && canonicalNameKey(record.name) !== playerKey
            && !abilitiesKnown(state, { name: record.name })
            && cleanTextMentions(passage, [record.name, ...(Array.isArray(record.aliases) ? record.aliases : [])]))
        .slice(0, MAXIMUM_NEWCOMERS_PER_PASS);
    if (!people.length) return null;
    const response = await request(buildGiftMessages({ store: targetStore, people: people.map(person => person.name), playerName, characterCard: cardContext, settings }));
    const context = gameContext(state, { playerName, entities: targetStore.entities });
    const normalized = normalizeGameRecords(response?.payload || {}, context, { source: 'judge', communication: settings.communication });
    const asked = new Set(people.map(person => nameKey(person.name)));
    const ops = normalized.ops.filter(op => op.type === 'ability.set' && op.holder?.kind === 'character' && asked.has(nameKey(op.holder.name)));
    for (const person of people) {
        if (ops.some(op => nameKey(op.holder.name) === nameKey(person.name))) continue;
        ops.push({ type: 'ability.set', holder: { kind: 'character', name: person.name }, key: ABILITY_KEYS.mindWard, name: 'warded mind', level: 0, note: 'weighed on arrival: an ordinary, open mind' });
    }
    targetStore.game = applyGameOperations(targetStore.game, ops, { messageIndex: end, source: 'judge' }).state;
    log(`Gifts settled for ${people.map(person => person.name).join(', ')}.`);
    return { settled: people.map(person => person.name), ops: ops.length };
}

/** Apply a scene planner answer to the store's game state. */
export function commitPlannerResponse(targetStore, plan, response, playerName, assisted = false, log = () => {}, { communication } = {}) {
    targetStore.game = normalizeGameState(targetStore.game);
    const context = gameContext(targetStore.game, { playerName, entities: targetStore.entities });
    const { ops, rejected, adjusted } = normalizeGameRecords(response.payload, context, {
        source: 'planner',
        // The world's rules: whether people come with gifts, and whether the player's gift and device are the planner's to settle.
        communication,
        // The ledger may have just counted the purse from this same passage.
        allowStartingKit: plan.startingKit && needsStartingKit(targetStore.game),
        clockSeconds: Number(targetStore.progression?.clock?.estimatedSeconds),
        // A smaller planner prepares a smaller cast.
        ...(assisted ? { maximumPeoplePerStage: 2 } : {}),
    });
    const applied = applyGameOperations(targetStore.game, ops, { messageIndex: plan.index, source: 'planner', rejected });
    targetStore.game = applied.state;
    // The place the player is at comes first; a planner that prepared only
    // somewhere else is noted, and the next pass targets the place again.
    const placeKeyOf = value => canonicalNameKey(value).replace(/^(?:the|a|an)\s+/u, '');
    const firstTarget = plan.targets[0];
    const missedPlayerPlace = firstTarget && !ops.some(op => op.type === 'stage.set' && placeKeyOf(op.place) === placeKeyOf(firstTarget.name))
        ? firstTarget.name
        : '';
    if (missedPlayerPlace) log(`Scene planner prepared nothing for ${missedPlayerPlace}; it is targeted again next pass.`);
    const result = {
        places: plan.targets.map(target => target.name),
        startingKit: plan.startingKit,
        applied: applied.applied.length,
        rejected: applied.rejected.slice(0, 12),
        ...(adjusted?.length ? { adjusted } : {}),
        ...(missedPlayerPlace ? { missedPlayerPlace } : {}),
        repaired: Boolean(response.repaired),
        ...(plan.atSend ? { atSend: true } : {}),
    };
    targetStore.game.planner = {
        ...targetStore.game.planner,
        lastRunIndex: plan.index,
        kitOffered: Boolean(targetStore.game.planner?.kitOffered || plan.startingKit),
        lastRunStats: { ...result, at: Date.now() },
        lastError: '',
    };
    return result;
}

/**
 * Commit the game ledger and scene planner results of one analysis. People
 * and objects the planner prepared earlier that the newest replies now show
 * are marked as introduced first, so a stage prepared in this same pass is
 * never mistaken for one the narrator has already used.
 */
export function commitGamePasses(targetStore, pass) {
    const { chat, playerName, settings } = pass;
    let gameResult = null;
    let plannerResult = null;
    if (settings.gameEnabled === false || pass.gameEnd < 0) return { gameResult, plannerResult };
    const place = gamePlaceOf(pass.gameScene, targetStore);

    const introducedFrom = Math.max(0, (Number.isInteger(targetStore.game.introducedThrough) ? targetStore.game.introducedThrough : -1) + 1);
    const storyText = chat.slice(introducedFrom, pass.gameEnd + 1)
        .filter(message => message && !message.is_user && !message.is_system)
        .map(message => message.mes)
        .join('\n\n');
    const introductions = introductionOperations(targetStore.game, storyText, place);
    if (introductions.length) {
        targetStore.game = applyGameOperations(targetStore.game, introductions, { messageIndex: pass.gameEnd, source: 'scene' }).state;
    }
    targetStore.game.introducedThrough = Math.max(introducedFrom - 1, pass.gameEnd);
    // A person the lore has folded into another name keeps one standing.
    const identityFolds = reconcileGameIdentities(targetStore.game, targetStore.entities);
    if (identityFolds.length) {
        targetStore.game = applyGameOperations(targetStore.game, identityFolds, { messageIndex: pass.gameEnd, source: 'lore' }).state;
    }

    const advanceLedger = () => {
        for (const [index, fingerprint] of Object.entries(snapshotMessageRange(chat, pass.gameStart, pass.gameEnd))) {
            if (fingerprint) targetStore.game.processedFingerprints[index] = fingerprint;
        }
        targetStore.game.lastProcessedIndex = Math.max(targetStore.game.lastProcessedIndex, pass.gameEnd);
    };
    if (pass.gameResponse) {
        const context = gameContext(targetStore.game, { playerName, entities: targetStore.entities, scenePlace: place });
        // A smaller model's records must quote PASSAGE; the rest are dropped.
        const grounded = pass.ledgerAssisted
            ? groundedRecords(pass.gameResponse.payload, pass.gameTranscript)
            : { payload: pass.gameResponse.payload, dropped: [] };
        const normalized = normalizeGameRecords(grounded.payload, context, { source: 'ledger', communication: settings.communication });
        // What the game system applied while the passage was written is not recorded twice.
        const deduped = dropDuplicateLedgerOps(normalized.ops, actionEntriesInRange(targetStore.game, pass.gameStart, pass.gameEnd));
        // An exchange the story only narrated (no game tool call) is not
        // applied to the player's purse or belongings on the model's word:
        // it waits for the player to confirm it. Everything else in the
        // ledger (prices, other people's trades, standings) applies at once,
        // and so does a passage with no player message in it (the opening
        // scene is the card's canon, not something the player did).
        const playerActed = chat.slice(Math.max(0, pass.gameStart), pass.gameEnd + 1).some(message => message?.is_user && !message.is_system);
        const split = playerActed ? splitConfirmableOps(deduped.ops, targetStore.game) : { direct: deduped.ops, confirmable: [] };
        // An exchange already waiting for the player, or one they said did not happen, is not asked again.
        const known = [...pendingOps(targetStore.game.pending), ...pendingOps(targetStore.game.declined)];
        const confirmable = split.confirmable.filter(op => !known.some(other => sameExchangeOp(op, other, targetStore.game)));
        const applied = applyGameOperations(targetStore.game, split.direct, { messageIndex: pass.gameEnd, source: 'ledger', rejected: normalized.rejected });
        targetStore.game = applied.state;
        if (confirmable.length) {
            targetStore.game.pending = [
                ...(Array.isArray(targetStore.game.pending) ? targetStore.game.pending : []),
                ...pendingConfirmations(confirmable, targetStore.game, { at: pass.gameEnd, playerName, now: Date.now() }),
            ];
        }
        // The story's stated prices replace what the planner had guessed for the same kind of thing here.
        const retired = supersededPlannerPrices(targetStore.game, applied.applied.map(entry => entry.op));
        if (retired.length) targetStore.game = applyGameOperations(targetStore.game, retired, { messageIndex: pass.gameEnd, source: 'lore' }).state;
        advanceLedger();
        gameResult = {
            startIndex: pass.gameStart,
            endIndex: pass.gameEnd,
            applied: applied.applied.length,
            awaitingConfirmation: confirmable.length,
            introduced: introductions.length,
            ungrounded: grounded.dropped.length,
            duplicates: deduped.dropped.length,
            rejected: applied.rejected.slice(0, 12),
            shortfall: applied.applied.reduce((sum, entry) => sum + (entry.shortfall || 0), 0),
            retiredPrices: retired.length,
            repaired: Boolean(pass.gameResponse.repaired),
            codec: codecStatsFromResponse(pass.gameResponse),
        };
        targetStore.game.lastRunStats = { ...gameResult, at: Date.now() };
        targetStore.game.lastError = '';
    } else if (pass.gameError) {
        targetStore.game.lastError = cleanString(pass.gameError.message || String(pass.gameError), 1_000);
    } else if (pass.gameEnabled && pass.gameStart <= pass.gameEnd && !pass.gameTranscript) {
        // Nothing readable in the range (hidden or empty messages): skip it.
        advanceLedger();
    }

    if (pass.plannerResponse && pass.plannerPlan) {
        plannerResult = commitPlannerResponse(targetStore, pass.plannerPlan, pass.plannerResponse, playerName, pass.plannerAssisted, pass.log, { communication: settings.communication });
    } else if (pass.plannerError) {
        targetStore.game.planner = {
            ...targetStore.game.planner,
            lastError: cleanString(pass.plannerError.message || String(pass.plannerError), 1_000),
        };
    }
    return { gameResult, plannerResult };
}

/**
 * Whether a ledger operation moves the player's own coin or belongings: a
 * payment to or from the player, the purse being counted, a thing joining,
 * leaving or arriving in what they carry.
 */
export function opTouchesPlayer(op, state) {
    if (!op || typeof op !== 'object') return false;
    const items = state?.items || {};
    const carriedByPlayer = key => items[key]?.holder?.kind === 'player';
    switch (op.type) {
        case 'money': return op.from?.kind === 'player' || op.to?.kind === 'player';
        case 'purse.set': return true;
        case 'item.add': return op.holder?.kind === 'player';
        case 'item.move': return op.to?.kind === 'player' || carriedByPlayer(op.key);
        case 'item.remove': return carriedByPlayer(op.key);
        default: return false;
    }
}

/** Ledger operations split into what applies at once and what the player must confirm. */
export function splitConfirmableOps(ops, state) {
    const direct = [];
    const confirmable = [];
    for (const op of ops || []) (opTouchesPlayer(op, state) ? confirmable : direct).push(op);
    return { direct, confirmable };
}

/** The person on the other side of an exchange with the player ('' when none). */
function counterpartOf(op, game) {
    const name = holder => (holder && holder.kind === 'character' && holder.name ? canonicalNameKey(holder.name) : '');
    switch (op?.type) {
        case 'money': return op.from?.kind === 'player' ? name(op.to) : name(op.from);
        case 'item.move': {
            if (op.to?.kind === 'player') return name(game?.items?.[op.key]?.holder) || name(op.from);
            return name(op.to);
        }
        default: return '';
    }
}

/** The operations of pending or declined entries (old entries held one `op`). */
export function pendingOps(entries) {
    return (Array.isArray(entries) ? entries : []).flatMap(entry => (Array.isArray(entry?.ops) ? entry.ops : (entry?.op ? [entry.op] : [])));
}

/**
 * Whether two operations describe the same exchange: the same kind of
 * change with the same person, for the same sum or the same thing. Used to
 * keep an exchange from being asked about twice and to clear a question the
 * player answered by acting.
 */
export function sameExchangeOp(a, b, game) {
    if (!a || !b || a.type !== b.type) return false;
    const thing = op => canonicalNameKey(op.name || game?.items?.[op.key]?.name || op.key || '');
    switch (a.type) {
        case 'money':
            return Number(a.amount) === Number(b.amount)
                && (a.from?.kind === 'player') === (b.from?.kind === 'player')
                && counterpartOf(a, game) === counterpartOf(b, game);
        case 'item.move':
        case 'item.add':
        case 'item.remove':
            return thing(a) === thing(b) && (a.to?.kind || a.holder?.kind || '') === (b.to?.kind || b.holder?.kind || '');
        case 'purse.set':
            return Number(a.amount) === Number(b.amount);
        default:
            return JSON.stringify(a) === JSON.stringify(b);
    }
}

/**
 * Pending confirmations for the player-touching operations of one passage:
 * what changed hands with the same person is one question (the candle and
 * the two coins paid for it), and a change with nobody named joins the only
 * person in the passage, or stands alone.
 */
export function pendingConfirmations(ops, state, { at = -1, playerName = 'You', now = Date.now() } = {}) {
    const game = normalizeGameState(state);
    const groups = new Map();
    const orphans = [];
    for (const op of ops || []) {
        const who = counterpartOf(op, game);
        if (!who) {
            orphans.push(op);
            continue;
        }
        if (!groups.has(who)) groups.set(who, []);
        groups.get(who).push(op);
    }
    const lists = [...groups.values()];
    if (lists.length === 1) lists[0].push(...orphans.filter(op => op.type !== 'purse.set'));
    const standalone = lists.length === 1 ? orphans.filter(op => op.type === 'purse.set') : orphans;
    for (const op of standalone) lists.push([op]);
    const describe = op => entryText({
        op,
        source: 'ledger',
        fromPlayer: op.type === 'item.move' || op.type === 'item.remove' ? game.items?.[op.key]?.holder?.kind === 'player' : undefined,
    }, game, playerName) || op.type;
    return lists.map((group, index) => ({
        id: `confirm-${now.toString(36)}-${at}-${index}`,
        at,
        createdAt: now,
        ops: group,
        text: group.map(describe).join('; '),
        evidence: group.map(op => (typeof op.note === 'string' ? op.note : '')).find(Boolean)?.slice(0, 300) || '',
    }));
}

/** The ledger runs after every completed reply it has not yet read. */
export function gameLedgerDue(store, settings, targetIndex) {
    if (settings.gameEnabled === false || settings.gameLedgerEnabled === false || targetIndex < 0) return false;
    const game = normalizeGameState(store?.game);
    return game.lastProcessedIndex < targetIndex;
}

/**
 * A chat that existed before the game system was switched on is not read
 * from its first message: the ledger starts from the recent window, and the
 * planner gives the player a starting kit consistent with where things stand.
 */
export function adoptGameLedger(store, settings, targetIndex) {
    if (settings.gameEnabled === false || !store) return;
    store.game = normalizeGameState(store.game);
    if (store.game.lastProcessedIndex >= 0 || store.game.journal.length) return;
    const window = Math.max(2, Number(settings.lookbackMessages) || 10);
    if (targetIndex >= window) store.game.lastProcessedIndex = targetIndex - window;
}

export function throwForSubsystemFailure(result) {
    const failures = [];
    if (result?.curatorError) failures.push(`continuity curator: ${result.curatorError.message || result.curatorError}`);
    if (result?.progressionError) failures.push(`world progression: ${result.progressionError.message || result.progressionError}`);
    // A failed ledger keeps its watermark, so the retry re-reads the same
    // replies. The scene planner is preparation only and simply runs again.
    if (result?.gameError) failures.push(`game ledger: ${result.gameError.message || result.gameError}`);
    if (!failures.length) return;
    const error = new Error(failures.join('; '));
    error.name = 'InnerLoreSubsystemError';
    throw error;
}

/**
 * How far apart checkpoints are recorded, in messages. A rebuild resumes from
 * the newest checkpoint before the change, so this bounds how much a swipe or
 * an edit re-derives; the ladder keeps at most MAX_STORE_CHECKPOINTS of them,
 * dense near the end and sparse further back.
 */
export const CHECKPOINT_INTERVAL_MESSAGES = 4;
/** A rebuild reads the chat in batches of at most this many messages, so the curator sees a passage of normal size. */
export const REBUILD_BATCH_MESSAGES = 8;

export function maybeRecordCheckpoint(store, settings = {}) {
    if (!store || !Number.isInteger(store.lastProcessedIndex) || store.lastProcessedIndex < 0) return;
    void settings;
    const interval = CHECKPOINT_INTERVAL_MESSAGES;
    const newest = (store.checkpoints || []).reduce(
        (max, checkpoint) => Math.max(max, Number.isInteger(checkpoint?.index) ? checkpoint.index : -1),
        -1,
    );
    if (store.lastProcessedIndex - newest < interval) return;
    store.checkpoints = recordCheckpoint(store.checkpoints, createStoreCheckpoint(store));
}

export function summarizeRun(result) {
    if (!result) return 'No narrative text required analysis.';
    if (result.skipped && result.progressionError) {
        return `World progression deferred (${result.progressionError.message || result.progressionError}).`;
    }
    if (result.skipped && result.gameError) return `Game ledger deferred (${result.gameError.message || result.gameError}).`;
    if (result.skipped) return 'No narrative text required analysis.';
    const entities = result.entityResult || {};
    const minds = result.mindResult || {};
    const progression = result.progressionResult;
    const curatorText = result.curatorError
        ? `; curator deferred (${result.curatorError.message || result.curatorError})`
        : '';
    const progressionText = progression
        ? `; story clock +${formatClockRange({
            minimumSeconds: progression.timeResult?.duration?.minimumSeconds || 0,
            estimatedSeconds: progression.timeResult?.duration?.estimatedSeconds || 0,
            maximumSeconds: progression.timeResult?.duration?.maximumSeconds || 0,
        })}${progression.triggerEventResult?.transitions?.length
            ? `; ${progression.triggerEventResult.transitions.length} editor event transition${progression.triggerEventResult.transitions.length === 1 ? '' : 's'}`
            : ''}${progression.triggerEventResult?.deliveryConfirmed?.length
            ? `; ${progression.triggerEventResult.deliveryConfirmed.length} event delivery confirmed`
            : ''}${progression.triggerEventResult?.deliveryRetries?.length
            ? `; ${progression.triggerEventResult.deliveryRetries.length} event delivery retry queued`
            : ''}${progression.triggerEventResult?.deliveryFailures?.length
            ? `; ${progression.triggerEventResult.deliveryFailures.length} event delivery needs manual review`
            : ''}`
        : result.progressionError
            ? `; progression deferred (${result.progressionError.message || result.progressionError})`
            : '';
    const game = result.gameResult;
    const gameText = game
        ? `; game ledger ${game.applied} change${game.applied === 1 ? '' : 's'}${game.introduced ? `, ${game.introduced} prepared ${game.introduced === 1 ? 'thing' : 'things'} now in the story` : ''}${game.shortfall ? '; a payment was larger than the purse' : ''}`
        : result.gameError
            ? `; game ledger deferred (${result.gameError.message || result.gameError})`
            : '';
    const planner = result.plannerResult;
    const plannerText = planner
        ? `; planner prepared ${planner.places.length ? planner.places.join(', ') : 'nothing new'}${planner.startingKit ? ' and a starting kit' : ''}`
        : result.plannerError
            ? `; planner deferred (${result.plannerError.message || result.plannerError})`
            : '';
    const director = result.eventDirectorResult;
    const directorText = director?.generated
        ? `; Event Director ${director.definition ? 'armed' : 'proposed'} “${director.proposal?.title || 'event'}”`
        : director?.error
            ? `; Event Director deferred (${director.error.message || director.error})`
            : '';
    const codecTotals = [result.codec, progression?.state?.lastRunStats?.codec, director?.codec]
        .reduce(mergeCodecSignals, {
            seen: false, format: 'json', salvaged: false, crossFormat: false, repaired: false, normalizations: 0,
        });
    const codecParts = [];
    if (codecTotals.salvaged) codecParts.push('salvaged a truncated response');
    if (codecTotals.crossFormat) codecParts.push('accepted a JSON fallback');
    if (codecTotals.normalizations) {
        codecParts.push(`${codecTotals.normalizations} local normalization${codecTotals.normalizations === 1 ? '' : 's'}`);
    }
    if (codecTotals.repaired) codecParts.push('one repair round');
    const codecText = codecParts.length
        ? `; ${codecTotals.format === 'dsl' ? 'DSL' : 'JSON'}: ${codecParts.join(', ')}`
        : '';
    return `${entities.created || 0} lore entries created, ${entities.updated || 0} updated; ${minds.created || 0} minds created, ${minds.updated || 0} updated${curatorText}${progressionText}${gameText}${plannerText}${directorText}${codecText}.`;
}

// ---- planning a pass ----

/**
 * Whether a pass is due and what it covers: the maintenance decision, the
 * three watermarks, the first and last message to read, and the completed
 * turns this pass answers for. Mutates `store` only through adoptGameLedger.
 */
export function planPass({ chat, store, settings, targetIndex, force = false }) {
    const decision = decideInnerLoreMaintenance({ messages: chat, store, settings, targetIndex });
    const runCurator = (settings.innerSelfEnabled || settings.autoLoreEnabled) && (force || decision.curatorDue);
    const runProgression = settings.worldProgressionEnabled && (force || decision.progressionDue);
    adoptGameLedger(store, settings, targetIndex);
    const runGame = gameLedgerDue(store, settings, targetIndex);
    const due = Boolean(force || (settings.autoUpdate && (runCurator || runProgression || runGame)));
    // Capture the completed-turn queue that this pass is responsible for. A
    // newer story reply may arrive while the model request is in flight; its
    // queue increment must survive this pass rather than being erased by a
    // blanket reset on success.
    const assistantTurnsCoveredAtStart = Math.max(0, Number(store.assistantTurnsSincePass) || 0);
    const progressionStart = runProgression ? normalizeProgressionState(store.progression).lastProcessedIndex + 1 : Number.POSITIVE_INFINITY;
    const curatorStart = runCurator ? store.lastProcessedIndex + 1 : Number.POSITIVE_INFINITY;
    const gameStart = runGame ? normalizeGameState(store.game).lastProcessedIndex + 1 : Number.POSITIVE_INFINITY;
    let startIndex = Math.max(0, Math.min(curatorStart, progressionStart, gameStart));
    const finalIndex = targetIndex;
    let nothingPending = false;
    if (startIndex > finalIndex) {
        nothingPending = true;
        startIndex = Math.max(0, finalIndex - (Number(settings.lookbackMessages) || 10) + 1);
    }
    return {
        run: due && !(nothingPending && !force),
        decision, runCurator, runProgression, runGame, force,
        startIndex, finalIndex, assistantTurnsCoveredAtStart,
    };
}

// ---- one analysis range ----

/**
 * Reads the passes' ranges from the chat, sends their prompts through
 * `deps.requests`, and folds the answers into `targetStore`. Returns the run
 * result; the store's saving and the lorebook mirror are the caller's.
 *
 * deps: { chat, playerName, characterName, persona, cardContext, settings,
 *         signal, requests: { curator, progression, game }, assisted(profileId),
 *         schedule(tasks, {parallel, signal}), hasFoundationBrains(store), log }
 */
export async function analyzePassRange(targetStore, startIndex, endIndex, options = {}, deps) {
    const { chat, settings, signal } = deps;
    const playerName = deps.playerName;
    const characterName = deps.characterName;
    const log = deps.log || (() => {});
    targetStore.progression = normalizeProgressionState(targetStore.progression);
    const curatorEnabled = (settings.innerSelfEnabled || settings.autoLoreEnabled)
        && options.curatorEnabled !== false;
    const curatorStart = Math.max(startIndex, targetStore.lastProcessedIndex + 1);
    // Never curate a dangling player action or an empty swipe placeholder as a
    // completed exchange. The next assistant reply will include it again from
    // the unchanged watermark.
    const curatorEnd = lastCompletedStoryIndex(chat, endIndex);
    const progressionStart = Math.max(0, targetStore.progression.lastProcessedIndex + 1);
    const progressionCandidateEnd = lastCompletedStoryIndex(chat, endIndex);
    const progressionPending = progressionCandidateEnd >= progressionStart
        ? progressionCandidateEnd - progressionStart + 1
        : 0;
    const progressionAssistantTurns = completedAssistantTurnCount(chat, progressionStart, progressionCandidateEnd);
    const progressionThreshold = options.progressionMode === 'rebuild'
        ? Math.max(1, Number(settings.progressionRebuildBatchMessages) || 30)
        : Math.max(1, Number(settings.progressionEveryAssistantTurns) || 2);
    const progressionBatchLimit = options.progressionMode === 'rebuild'
        ? Math.max(progressionThreshold, Number(settings.lookbackMessages) || 10)
        : Math.max(2, Number(settings.lookbackMessages) || 10);
    let progressionEnd = boundedProgressionEnd(chat, progressionStart, progressionCandidateEnd, progressionBatchLimit);
    const pendingCreationBoundary = Object.values(targetStore.progression.eventDefinitions || {})
        .filter(definition => targetStore.progression.eventRuntime?.[definition.id]?.creationAnchorPending)
        .map(definition => definition.createdAtMessage)
        .filter(index => Number.isInteger(index) && index >= progressionStart && index <= progressionEnd)
        .sort((a, b) => a - b)[0];
    const progressionAnchorFlush = Number.isInteger(pendingCreationBoundary);
    if (progressionAnchorFlush) progressionEnd = pendingCreationBoundary;
    const runProgression = settings.worldProgressionEnabled
        && options.progressionEnabled !== false
        && progressionPending > 0
        && progressionEnd >= progressionStart
        && (
            (options.progressionMode === 'rebuild'
                ? progressionPending >= progressionThreshold
                : progressionAssistantTurns >= progressionThreshold)
            || options.progressionFlush === true
            || progressionAnchorFlush
        );
    const actualStart = Math.min(
        curatorEnabled && curatorStart <= curatorEnd ? curatorStart : Number.POSITIVE_INFINITY,
        runProgression ? progressionStart : Number.POSITIVE_INFINITY,
    );
    const actualEnd = Math.max(
        curatorEnabled ? curatorEnd : -1,
        runProgression ? progressionEnd : -1,
    );
    const sourceSnapshot = Number.isFinite(actualStart) && actualEnd >= actualStart
        ? snapshotMessageRange(chat, actualStart, actualEnd)
        : {};
    // The transcript is formatted once per distinct range and shared.
    const transcriptCache = new Map();
    const transcriptFor = (from, to, maximumCharacters) => {
        const key = `${from}:${to}:${maximumCharacters}`;
        if (!transcriptCache.has(key)) {
            transcriptCache.set(key, formatTranscript(chat, { startIndex: from, endIndex: to, userName: playerName, characterName, maximumCharacters }));
        }
        return transcriptCache.get(key);
    };
    const transcript = curatorEnabled && curatorStart <= curatorEnd ? transcriptFor(curatorStart, curatorEnd, 55_000) : '';
    const progressionTranscript = runProgression ? transcriptFor(progressionStart, progressionEnd, 90_000) : '';

    // Game ledger: the same completed range as the curator, from its own
    // watermark. The scene planner prepares where the player is and can go.
    targetStore.game = normalizeGameState(targetStore.game);
    const gameEnabled = settings.gameEnabled !== false && settings.gameLedgerEnabled !== false
        && options.gameEnabled !== false;
    const gameStart = Math.max(startIndex, targetStore.game.lastProcessedIndex + 1);
    const gameEnd = lastCompletedStoryIndex(chat, endIndex);
    const gameTranscript = gameEnabled && gameStart <= gameEnd ? transcriptFor(gameStart, gameEnd, 40_000) : '';
    // The ledger may read from before the curator's range; a swipe or edit
    // there during the pass discards its result too.
    const gameSnapshot = gameTranscript ? snapshotMessageRange(chat, gameStart, gameEnd) : {};
    const gameScene = settings.gameEnabled !== false && gameEnd >= 0
        ? deriveSceneState(chat, targetStore, {
            currentIndex: gameEnd,
            playerName,
            lookbackMessages: settings.sceneLookbackMessages ?? 4,
        })
        : null;
    const plannerWanted = options.plannerEnabled === true && settings.gameEnabled !== false
        && settings.scenePlannerEnabled !== false && gameEnd >= 0;
    // A brand-new world has no places until the curator reads the opening,
    // so the planner waits for those first records instead of guessing.
    const deferPlanner = plannerWanted && Boolean(transcript)
        && !Object.values(targetStore.entities || {}).some(record => record?.type === 'location' && record.enabled !== false);
    const plannerPlan = plannerWanted && !deferPlanner && gameScene
        ? plannerPlanFor(targetStore, gameScene, gameEnd, settings, playerName)
        : null;

    // The character card is formatted once per analysis and goes to the
    // passes whose prompts read it; the ledger and the planner get the short
    // premise line instead of the full card.
    const cardContext = deps.cardContext || '';
    const premiseLine = cleanString(cardContext.split('\n').find(line => line.trim()) || '', 400);
    const tasks = [];
    // With a minds profile the curator is two narrower requests: people,
    // places and whereabouts on the curator profile, NPC minds on the minds
    // profile, side by side (on two providers, truly at once).
    const splitMinds = Boolean(transcript) && Boolean(settings.mindsConnectionProfileId)
        && settings.innerSelfEnabled && settings.autoLoreEnabled;
    const recentExpressionText = transcript ? collectRecentStoryExpressions(chat, { endIndex: curatorEnd, maximumReplies: 3, maximumCharacters: 1_600 }) : '';
    const curatorRequest = passSettings => deps.requests.curator(passSettings, buildAnalysisMessages({
        transcript,
        store: targetStore,
        currentIndex: curatorEnd,
        characterCard: cardContext,
        playerName,
        recentExpressionText,
        assisted: deps.assisted(passSettings.connectionProfileId || settings.connectionProfileId),
        settings: passSettings,
    }), signal);
    if (transcript && splitMinds) {
        // Each half carries only its own rules: the curator half no mind
        // rules, the minds half no entity rules or location keyring.
        tasks.push({ name: 'curator', profileId: settings.connectionProfileId, run: () => curatorRequest({ ...settings, innerSelfEnabled: false, telemetryKind: 'curator' }) });
        tasks.push({ name: 'minds', profileId: settings.mindsConnectionProfileId, run: () => curatorRequest({
            ...settings,
            autoLoreEnabled: false,
            connectionProfileId: settings.mindsConnectionProfileId,
            telemetryKind: 'minds',
        }) });
    } else if (transcript) {
        tasks.push({ name: 'curator', profileId: settings.connectionProfileId, run: () => curatorRequest(settings) });
    }
    if (progressionTranscript) {
        tasks.push({ name: 'progression', profileId: settings.progressionConnectionProfileId || settings.connectionProfileId, run: () => {
            const eventEvaluationDefinitions = triggerEventAgentSnapshot(targetStore.progression, { currentIndex: progressionEnd });
            const eventEvaluationKeys = eventEvaluationDefinitions.map(definition => definition.key);
            const progressionMessages = buildProgressionMessages({
                transcript: progressionTranscript,
                store: targetStore,
                progression: targetStore.progression,
                currentIndex: progressionEnd,
                characterCard: cardContext,
                playerName,
                assisted: deps.assisted(settings.progressionConnectionProfileId || settings.connectionProfileId),
                settings,
            });
            targetStore.progression.lastTriggerEvaluatorRequest = {
                startIndex: progressionStart,
                endIndex: progressionEnd,
                eventKeys: eventEvaluationKeys,
                eventPayloads: eventEvaluationDefinitions.map(definition => ({
                    definitionId: definition.id,
                    key: definition.key,
                    payload: JSON.stringify(definition, null, 2),
                })),
                promptCharacters: progressionMessages.reduce((sum, message) => sum + message.content.length, 0),
                requestedAt: Date.now(),
            };
            return deps.requests.progression(settings, progressionMessages, signal, {
                expectedEventKeys: eventEvaluationKeys,
                expectedEventContracts: Object.fromEntries(eventEvaluationDefinitions.map(definition => [
                    definition.key,
                    {
                        createdAtMessage: definition.created_at_message,
                        actionCondition: definition.action_condition,
                        actorScope: definition.actor_scope,
                        actorName: definition.actor_name,
                        cancellationCondition: definition.cancellation_condition,
                        revealCondition: definition.reveal_condition,
                        resolutionCondition: definition.resolution_condition,
                    },
                ])),
                passageStartIndex: progressionStart,
                passageEndIndex: progressionEnd,
                passageMessages: passageMessagesFor(chat, progressionStart, progressionEnd),
                playerName,
                assisted: deps.assisted(settings.progressionConnectionProfileId || settings.connectionProfileId),
            });
        } });
    }
    const ledgerAssisted = Boolean(gameTranscript) && deps.assisted(settings.gameConnectionProfileId || settings.connectionProfileId);
    if (gameTranscript) {
        tasks.push({ name: 'game', profileId: settings.gameConnectionProfileId || settings.connectionProfileId, run: () => deps.requests.game(settings, buildLedgerMessages({
            game: targetStore.game,
            store: targetStore,
            scene: gameScene,
            playerName,
            transcript: gameTranscript,
            characterCard: premiseLine,
            settings,
            assisted: ledgerAssisted,
            alreadyRecorded: alreadyRecordedLines(targetStore, gameStart, gameEnd, playerName),
        }), signal, 'game') });
    }
    const plannerDeps = { ...deps, cardContext: premiseLine };
    if (plannerPlan) {
        tasks.push({ name: 'planner', profileId: plannerProfileId(settings), run: () => deps.requests.game(settings, plannerMessagesFor(targetStore, plannerPlan, plannerDeps), signal, 'planner', { places: plannerPlaces(plannerPlan) }) });
    }
    const outcomes = await deps.schedule(tasks, { parallel: settings.parallelBackgroundPasses === true, signal });
    for (const outcome of Object.values(outcomes)) {
        if (outcome.error?.name === 'AbortError') throw outcome.error;
    }
    if (signal?.aborted) throw new DOMException('InnerLore pass stopped', 'AbortError');
    const response = outcomes.curator?.value ?? null;
    const curatorError = outcomes.curator?.error ?? null;
    const mindsResponse = splitMinds ? outcomes.minds?.value ?? null : response;
    const mindsError = splitMinds ? outcomes.minds?.error ?? null : null;
    const progressionResponse = outcomes.progression?.value ?? null;
    const progressionError = outcomes.progression?.error ?? null;
    const gameResponse = outcomes.game?.value ?? null;
    const gameError = outcomes.game?.error ?? null;
    const plannerResponse = outcomes.planner?.value ?? null;
    const plannerError = outcomes.planner?.error ?? null;
    if (!messageRangeMatchesSnapshot(chat, sourceSnapshot) || !messageRangeMatchesSnapshot(chat, gameSnapshot)) {
        targetStore.needsRebuild = true;
        const error = new Error('Chat history changed while InnerLore was analyzing it; the stale result was discarded.');
        error.name = 'InnerLoreHistoryChangedError';
        throw error;
    }
    const payload = response?.payload && typeof response.payload === 'object' ? response.payload : {};
    const entityOperations = payload.entities || payload.entity_operations || [];
    const alignedEntityOperations = alignExplicitLocationOperations(targetStore, entityOperations, transcript);
    // The player's record anchors the scene and must survive every cap; a
    // provider that never writes one still gets it, and a mind written for
    // the player under any of their names is dropped.
    if (settings.autoLoreEnabled) ensurePlayerEntity(targetStore, { name: playerName, persona: deps.persona, messageIndex: curatorEnd });
    const playerKeys = playerEntityKeys(targetStore, playerName);
    const mindPayload = mindsResponse?.payload && typeof mindsResponse.payload === 'object' ? mindsResponse.payload : {};
    const mindOperations = (mindPayload.minds || mindPayload.mind_operations || [])
        .filter(operation => !playerKeys.has(canonicalNameKey(operation?.character)));

    const entityResult = response && settings.autoLoreEnabled
        ? mergeEntityOperations(targetStore, alignedEntityOperations, {
            enabledTypes: settings.enabledEntityTypes,
            minimumImportance: settings.minimumImportance,
            maximumOperations: settings.maximumEntitiesPerPass,
            messageIndex: curatorEnd,
        })
        : { created: 0, updated: 0, skipped: alignedEntityOperations.length, changedIds: [] };
    const mindResult = mindsResponse && settings.innerSelfEnabled
        ? mergeMindOperations(targetStore, mindOperations, {
            maximumOperations: settings.maximumMindOperationsPerPass,
            maximumThoughts: settings.maximumThoughtsPerBrain,
            maximumThoughtChanges: settings.maximumThoughtChangesPerBrain,
            minimumStoryFacetObservations: settings.minimumStoryFacetObservations,
            consolidationSimilarity: settings.brainConsolidationSimilarity,
            maximumSceneThoughts: settings.maximumSceneThoughtsPerBrain,
            messageIndex: curatorEnd,
        })
        : { created: 0, updated: 0, skipped: mindOperations.length, changedIds: [] };
    if (mindsResponse && settings.innerSelfEnabled && deps.hasFoundationBrains?.(targetStore)) {
        // Readiness requires all four real card-backed capabilities; any JSON
        // response by itself is not enough to bless the narration path.
        targetStore.expressionFoundationVersion = EXPRESSION_FOUNDATION_VERSION;
    }
    const mentionResult = transcript ? refreshMentionRecency(targetStore, transcript, curatorEnd, {
        entities: settings.autoLoreEnabled,
        brains: settings.innerSelfEnabled,
    }) : { entities: 0, brains: 0 };

    let progressionResult = null;
    if (progressionResponse) {
        progressionResult = applyProgressionPatch(targetStore.progression, progressionResponse.payload, {
            messageIndex: progressionEnd,
            passageStartIndex: progressionStart,
            passageText: progressionTranscript,
            playerName,
            autonomy: settings.progressionAutonomy,
            maximumGoals: settings.progressionMaximumGoals,
            maximumProcesses: settings.progressionMaximumProcesses,
            maximumEvents: settings.progressionMaximumEvents,
            evaluationCoverageRequired: true,
            deliveryMaximumAttempts: settings.triggerDeliveryMaximumAttempts,
        });
        targetStore.progression = progressionResult.state;
        const progressionSnapshot = snapshotMessageRange(chat, progressionStart, progressionEnd);
        for (const [index, fingerprint] of Object.entries(progressionSnapshot)) {
            if (fingerprint) targetStore.progression.processedFingerprints[index] = fingerprint;
        }
        targetStore.progression.lastProcessedIndex = Math.max(targetStore.progression.lastProcessedIndex, progressionEnd);
        targetStore.progression.lastRunStats = {
            ...targetStore.progression.lastRunStats,
            startIndex: progressionStart,
            endIndex: progressionEnd,
            repaired: progressionResponse.repaired,
            codec: codecStatsFromResponse(progressionResponse),
        };
        targetStore.progression.lastError = '';
    } else if (progressionError) {
        targetStore.progression.lastError = cleanString(progressionError.message || String(progressionError), 1_000);
    } else if (settings.worldProgressionEnabled
        && progressionStart <= endIndex
        && chat.slice(progressionStart, endIndex + 1).every(message => (
            !message
            || !cleanString(message.mes)
            || (message.is_system && message.extra?.sc_ghosted !== true)
        ))) {
        const ignoredSnapshot = snapshotMessageRange(chat, progressionStart, endIndex);
        for (const [index, fingerprint] of Object.entries(ignoredSnapshot)) {
            if (fingerprint) targetStore.progression.processedFingerprints[index] = fingerprint;
        }
        targetStore.progression.lastProcessedIndex = endIndex;
    }

    const gameCommit = commitGamePasses(targetStore, {
        chat, playerName, settings, gameEnabled, gameStart, gameEnd, gameTranscript, gameScene,
        gameResponse, gameError, ledgerAssisted, plannerPlan, plannerResponse, plannerError,
        plannerAssisted: deps.assisted(plannerProfileId(settings)), log,
    });

    const curatorSucceeded = !curatorEnabled || !transcript || Boolean(response);
    if (curatorEnabled && curatorStart <= curatorEnd && curatorSucceeded) {
        const curatorSnapshot = snapshotMessageRange(chat, curatorStart, curatorEnd);
        for (const [index, fingerprint] of Object.entries(curatorSnapshot)) {
            if (fingerprint) targetStore.processedFingerprints[index] = fingerprint;
        }
        targetStore.lastProcessedIndex = Math.max(targetStore.lastProcessedIndex, curatorEnd);
    }
    // After the curator's watermark moves, so the scene trusts its new record
    // of where the player is rather than reading the opening's prose.
    if (deferPlanner && response) {
        const scene = deriveSceneState(chat, targetStore, {
            currentIndex: gameEnd,
            playerName,
            lookbackMessages: settings.sceneLookbackMessages ?? 4,
        });
        const plan = plannerPlanFor(targetStore, scene, gameEnd, settings, playerName);
        if (plan) {
            try {
                const reply = await deps.requests.game(settings, plannerMessagesFor(targetStore, plan, plannerDeps), signal, 'planner', { places: plannerPlaces(plan) });
                gameCommit.plannerResult = commitPlannerResponse(targetStore, plan, reply, playerName, deps.assisted(plannerProfileId(settings)), log, { communication: settings.communication });
            } catch (error) {
                if (error?.name === 'AbortError' || signal?.aborted) throw error;
                targetStore.game.planner = { ...targetStore.game.planner, lastError: cleanString(error?.message || String(error), 1_000) };
            }
        }
    }
    // Gifts settled as people come in, so reaching them later needs no judging.
    try {
        gameCommit.giftsResult = await settleNewcomerGifts(targetStore, {
            chat, playerName, settings, start: Math.min(curatorStart, gameStart), end: endIndex, cardContext: premiseLine, log,
            request: messages => deps.requests.game(settings, messages, signal, 'abilities'),
        });
    } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) throw error;
        log(`Could not settle newcomers' gifts: ${error?.message || error}`);
    }
    targetStore.lastRunAt = Date.now();
    const curatorCodecStats = codecStatsFromResponse(response);
    targetStore.lastRunStats = {
        startIndex: Number.isFinite(actualStart) ? actualStart : -1,
        endIndex: actualEnd,
        entityResult,
        mindResult,
        mentionResult,
        repaired: Boolean(response?.repaired),
        codec: curatorCodecStats,
        curatorError: curatorError ? cleanString(curatorError.message || String(curatorError), 1_000) : '',
        mindsError: mindsError ? cleanString(mindsError.message || String(mindsError), 1_000) : '',
        progressionResult: progressionResult?.state?.lastRunStats || null,
        progressionError: progressionError ? cleanString(progressionError.message || String(progressionError), 1_000) : '',
        gameResult: gameCommit.gameResult,
        gameError: gameError ? cleanString(gameError.message || String(gameError), 1_000) : '',
        plannerResult: gameCommit.plannerResult,
        plannerError: plannerError ? cleanString(plannerError.message || String(plannerError), 1_000) : '',
    };
    targetStore.updatedAt = Date.now();
    return {
        entityResult,
        mindResult,
        mentionResult,
        repaired: Boolean(response?.repaired),
        codec: curatorCodecStats,
        progressionResult,
        curatorError,
        progressionError,
        gameResult: gameCommit.gameResult,
        gameError,
        plannerResult: gameCommit.plannerResult,
        plannerError,
        skipped: !response && !progressionResponse && !gameResponse && !plannerResponse,
    };
}

// ---- a whole pass: batches, catch-up, bookkeeping ----

/**
 * Runs a planned pass over its batches, then the progression catch-up, and
 * settles the turn counter, the decision record and the checkpoint on the
 * store. `analyze(store, start, end, options)` is analyzePassRange with the
 * caller's deps (the browser adds its per-batch save and lorebook mirror).
 * Throws on a subsystem failure or a cancelled request; the caller records it.
 */
export async function runPassBatches(store, plan, { chat, settings, analyze, onBatch = () => {} }) {
    let startIndex = plan.startIndex;
    const finalIndex = plan.finalIndex;
    let latestResult = null;
    while (startIndex <= finalIndex) {
        const batchEnd = completedRebuildBatchEnd(chat, startIndex, finalIndex, settings.lookbackMessages);
        if (batchEnd < startIndex) break;
        onBatch(startIndex, batchEnd);
        latestResult = await analyze(store, startIndex, batchEnd, {
            curatorEnabled: plan.runCurator,
            progressionEnabled: plan.runProgression,
            progressionFlush: plan.runProgression,
            gameEnabled: plan.runGame,
            // Prepare places once, against the newest reply.
            plannerEnabled: batchEnd >= finalIndex,
        });
        throwForSubsystemFailure(latestResult);
        startIndex = batchEnd + 1;
    }
    const expectedProgressionIndex = lastCompletedStoryIndex(chat, finalIndex);
    while (plan.runProgression
        && !latestResult?.progressionError
        && store.progression.lastProcessedIndex < expectedProgressionIndex) {
        const before = store.progression.lastProcessedIndex;
        latestResult = await analyze(store, before + 1, expectedProgressionIndex, {
            progressionFlush: true,
            curatorEnabled: false,
            progressionEnabled: true,
            gameEnabled: false,
        });
        throwForSubsystemFailure(latestResult);
        if (store.progression.lastProcessedIndex <= before) break;
    }
    settlePass(store, plan, settings);
    return latestResult;
}

/** The bookkeeping a successful pass leaves on a store: the turn counter, the decision record, a clean failure state, a checkpoint. */
export function settlePass(store, plan, settings) {
    if (plan.runCurator) {
        store.assistantTurnsSincePass = Math.max(0, (Number(store.assistantTurnsSincePass) || 0) - plan.assistantTurnsCoveredAtStart);
    }
    store.lastMaintenanceDecision = {
        ...plan.decision,
        runCurator: plan.runCurator,
        runProgression: plan.runProgression,
        forced: Boolean(plan.force),
        completedAt: Date.now(),
    };
    store.lastError = '';
    store.lastFailureAt = 0;
    store.consecutiveFailures = 0;
    store.nextRetryAt = 0;
    maybeRecordCheckpoint(store, settings);
}

// ---- the rebuild ----

/**
 * Re-derives the world from the chat into a fresh store: from the newest
 * checkpoint whose recorded history still matches the chat when the change
 * was a late one (automatic rebuilds), from the card's seeds otherwise.
 * World Progression is rebuilt fully in both cases; the game journal
 * rewinds to the first changed message (a manual rebuild re-reads every
 * reply but keeps the planner's places and the starting kit). Returns the
 * rebuilt store without saving it; the caller replaces the old one. Throws
 * with `resumedFromCheckpoint` and `transient` set, for the retry policy.
 */
export async function rebuildStore({ chat, oldStore, settings, automatic = false, cardSeeds = [], analyze, onBatch = () => {}, chatId = oldStore.chatId }) {
    const completedHistoryIndex = lastCompletedStoryIndex(chat);
    // The first message whose content no longer matches what any subsystem
    // read (the curator, world progression or the game ledger).
    const divergenceIndex = Math.min(
        firstDivergenceIndex(chat, oldStore.processedFingerprints || {}),
        firstDivergenceIndex(chat, normalizeProgressionState(oldStore.progression).processedFingerprints || {}),
        firstDivergenceIndex(chat, normalizeGameState(oldStore.game).processedFingerprints || {}),
    );
    // Nothing derived came from a changed message (an unprocessed reply was
    // deleted or swiped, or a pass was discarded before it committed): the
    // world stands as it is, and the next pass reads what is new.
    if (automatic && !Number.isFinite(divergenceIndex)) {
        return { store: null, nothingToRebuild: true, resumedFrom: -1, completedHistoryIndex };
    }
    const resumeCheckpoint = automatic && Number.isFinite(divergenceIndex)
        ? selectResumeCheckpoint(oldStore.checkpoints, chat, divergenceIndex)
        : null;
    const temporary = createEmptyStore(chatId);
    let rebuildStartIndex = 0;
    // A full replay starts from the same card-declared canon a new chat gets.
    // Checkpoints already carry the seeds they were captured with.
    if (!resumeCheckpoint && cardSeeds.length) {
        mergeEntityOperations(temporary, cardSeeds, {
            enabledTypes: settings.enabledEntityTypes,
            minimumImportance: 0,
            maximumOperations: Math.max(1, cardSeeds.length),
            messageIndex: -1,
        });
    }
    if (resumeCheckpoint) {
        applyStoreCheckpoint(temporary, resumeCheckpoint);
        temporary.checkpoints = (oldStore.checkpoints || [])
            .filter(checkpoint => Number.isInteger(checkpoint?.index) && checkpoint.index <= resumeCheckpoint.index);
        rebuildStartIndex = resumeCheckpoint.index + 1;
    }
    temporary.expressionFoundationVersion = 0;
    temporary.progression = createProgressionState();
    temporary.progression.eventDefinitions = Object.fromEntries(Object.entries(
        clone(normalizeProgressionState(oldStore.progression).eventDefinitions),
    ).filter(([, definition]) => definition.origin !== 'automatic_director'));
    // User-authored definitions are chat configuration, while generated
    // proposals and runtime are derived. If a deletion moved the end of
    // history before an event's old creation point, keep it but re-arm it at
    // the new end of history.
    for (const definition of Object.values(temporary.progression.eventDefinitions)) {
        if (definition.createdAtMessage > completedHistoryIndex) {
            definition.createdAtMessage = completedHistoryIndex;
            definition.createdAtElapsedSeconds = 0;
        }
    }
    temporary.progression = resetTriggerEventRuntime(temporary.progression, { replayCreationAnchors: true });
    temporary.lorebookName = oldStore.lorebookName;
    // Portraits are not derived from the chat; they travel with the world.
    temporary.portraits = clone(oldStore.portraits || {});
    temporary.pictures = clone(oldStore.pictures || {});
    const oldGame = normalizeGameState(oldStore.game);
    temporary.game = automatic
        ? gameStateBefore(oldGame, Math.min(
            firstDivergenceIndex(chat, oldGame.processedFingerprints),
            completedHistoryIndex + 1,
        ))
        // The player's own acts (game tools, the trade screen, confirmed
        // exchanges) are facts, not readings of prose: a manual rebuild keeps
        // them, and the ledger's re-read does not count them twice.
        : gameStateBefore(oldGame, completedHistoryIndex + 1, { keepSources: ['planner', 'scene', 'action'] });
    const eventCreationBoundaries = new Set(Object.values(temporary.progression.eventDefinitions)
        .map(definition => definition.createdAtMessage)
        .filter(index => Number.isInteger(index) && index >= 0 && index <= completedHistoryIndex));
    try {
        let start = rebuildStartIndex;
        const batchMessages = Math.max(2, Math.min(Number(settings.lookbackMessages) || 10, REBUILD_BATCH_MESSAGES));
        while (start <= completedHistoryIndex) {
            let end = completedRebuildBatchEnd(chat, start, completedHistoryIndex, batchMessages);
            if (end < start) break;
            const creationBoundary = [...eventCreationBoundaries]
                .filter(index => index >= start && index <= end)
                .sort((a, b) => a - b)[0];
            if (Number.isInteger(creationBoundary)) end = creationBoundary;
            onBatch(start, end, chat.length - 1);
            const result = await analyze(temporary, start, end, {
                persist: false,
                sync: false,
                progressionMode: 'rebuild',
                progressionFlush: end === completedHistoryIndex || eventCreationBoundaries.has(end),
            });
            // A rebuild is one replacement transaction. Never publish a
            // partially reconstructed store when either background subsystem
            // failed; the quarantined prior store remains available for retry.
            throwForSubsystemFailure(result);
            start = end + 1;
            // Capture a checkpoint of the curator fold after each completed
            // batch so a later edit/swipe can resume from here instead of
            // replaying the whole chat.
            temporary.checkpoints = recordCheckpoint(temporary.checkpoints, createStoreCheckpoint(temporary));
        }
        const expectedProgressionIndex = completedHistoryIndex;
        while (settings.worldProgressionEnabled
            && !temporary.progression.lastError
            && temporary.progression.lastProcessedIndex < expectedProgressionIndex) {
            const before = temporary.progression.lastProcessedIndex;
            const result = await analyze(temporary, before + 1, expectedProgressionIndex, {
                persist: false,
                sync: false,
                progressionMode: 'rebuild',
                progressionFlush: true,
                gameEnabled: false,
            });
            throwForSubsystemFailure(result);
            if (temporary.progression.lastProcessedIndex <= before) break;
        }
        const curatorEnabled = settings.innerSelfEnabled || settings.autoLoreEnabled;
        if (curatorEnabled && temporary.lastProcessedIndex < completedHistoryIndex) {
            throw new Error(`Continuity rebuild stopped at message ${temporary.lastProcessedIndex}; expected ${completedHistoryIndex}. The previous complete state was preserved.`);
        }
        if (settings.worldProgressionEnabled
            && normalizeProgressionState(temporary.progression).lastProcessedIndex < expectedProgressionIndex) {
            throw new Error(`World Progression rebuild stopped at message ${temporary.progression.lastProcessedIndex}; expected ${expectedProgressionIndex}. The previous complete state was preserved. ${temporary.progression.lastError || ''}`.trim());
        }
        // Records whose whole story lies before the change cannot depend on
        // it: an automatic rebuild keeps any the re-read missed, and every
        // rebuild keeps the names a record was known by.
        if (automatic) carryUntouchedRecords(oldStore, temporary, divergenceIndex);
        carryIdentity(oldStore, temporary);
        carryManualState(oldStore, temporary);
        copyCardExpressionFoundation(temporary, oldStore, { copyCurrentMind: false });
        temporary.lorebookName = oldStore.lorebookName;
        temporary.lastProcessedIndex = completedHistoryIndex;
        temporary.assistantTurnsSincePass = 0;
        temporary.needsRebuild = false;
        // A final checkpoint at the completed head, so the next edit can
        // resume from the very end of this rebuild.
        temporary.checkpoints = recordCheckpoint(temporary.checkpoints, createStoreCheckpoint(temporary));
        return { store: temporary, resumedFrom: resumeCheckpoint ? resumeCheckpoint.index : -1, completedHistoryIndex };
    } catch (error) {
        if (error && typeof error === 'object') {
            error.resumedFromCheckpoint = Boolean(resumeCheckpoint);
            error.transient = isTransientRequestError(error);
        }
        throw error;
    }
}
