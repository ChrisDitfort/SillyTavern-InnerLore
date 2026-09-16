/** Pure adaptive scheduling for the curator and World Progression agents. */

import { cleanString, contextTokens } from './core.js';
import { explicitUserTimeAdvanceSeconds } from './event-delivery.js?v=2';
import { listTriggerEventRecords } from './trigger-events.js';

function completedAssistantTurns(messages, startIndex, endIndex) {
    let count = 0;
    for (let index = Math.max(0, startIndex); index <= Math.min(messages.length - 1, endIndex); index++) {
        const message = messages[index];
        if (message && !message.is_user && !message.is_system && cleanString(message.mes)) count++;
    }
    return count;
}

function passage(messages, startIndex, endIndex) {
    return messages.slice(Math.max(0, startIndex), Math.min(messages.length, endIndex + 1))
        .filter(message => message && !message.is_system)
        .map(message => cleanString(message.mes, 20_000))
        .filter(Boolean)
        .join('\n');
}

function hasPendingCreationAnchor(progression) {
    return Object.values(progression?.eventDefinitions || {}).some(definition => (
        progression?.eventRuntime?.[definition.id]?.creationAnchorPending === true
    ));
}

const ACTION_PREDICATE_TOKENS = new Set([
    'accept', 'agree', 'arrive', 'attack', 'break', 'bring', 'cancel', 'carry', 'choose', 'close',
    'collapse', 'complete', 'cut', 'deliver', 'depart', 'destroy', 'dismiss', 'enter', 'fire', 'give',
    'hand', 'kill', 'leave', 'lock', 'loos', 'lower', 'meet', 'open', 'pull', 'raise', 'reach',
    'recover', 'refuse', 'release', 'repair', 'resolve', 'return', 'say', 'secure', 'shoot',
    'sign', 'strike', 'take', 'travel', 'unlock', 'visit', 'wait', 'warn',
]);

function relevantActionWatchers(records, text) {
    const passageTokens = new Set(contextTokens(text, 600));
    if (!passageTokens.size) return [];
    const matches = [];
    for (const record of records) {
        if (!record.enabled || record.status !== 'armed' || !record.actionCondition) continue;
        const conditionTokens = contextTokens(record.actionCondition, 80);
        if (!conditionTokens.length) continue;
        const overlap = conditionTokens.filter(token => passageTokens.has(token));
        const predicateTokens = conditionTokens.filter(token => ACTION_PREDICATE_TOKENS.has(token));
        const predicateMatched = !predicateTokens.length
            ? overlap.length >= Math.max(3, Math.ceil(conditionTokens.length * 0.7))
            : predicateTokens.some(token => passageTokens.has(token));
        const requiredOverlap = Math.max(3, Math.ceil(conditionTokens.length * 0.6));
        if (!predicateMatched || overlap.length < Math.min(conditionTokens.length, requiredOverlap)) continue;
        matches.push({
            key: record.key,
            matchedTokens: overlap,
            predicateTokens: predicateTokens.filter(token => passageTokens.has(token)),
            coverage: Number((overlap.length / conditionTokens.length).toFixed(3)),
        });
    }
    return matches;
}

export function decideInnerLoreMaintenance(input = {}) {
    const messages = Array.isArray(input.messages) ? input.messages : [];
    const store = input.store && typeof input.store === 'object' ? input.store : {};
    const progression = input.progression && typeof input.progression === 'object'
        ? input.progression
        : (store.progression || {});
    const settings = input.settings && typeof input.settings === 'object' ? input.settings : {};
    const targetIndex = Number.isInteger(input.targetIndex) ? input.targetIndex : messages.length - 1;
    const curatorStart = Math.max(0, (Number.isInteger(store.lastProcessedIndex) ? store.lastProcessedIndex : -1) + 1);
    const progressionStart = Math.max(0, (Number.isInteger(progression.lastProcessedIndex) ? progression.lastProcessedIndex : -1) + 1);
    const curatorPendingTurns = completedAssistantTurns(messages, curatorStart, targetIndex);
    const progressionPendingTurns = completedAssistantTurns(messages, progressionStart, targetIndex);
    const curatorText = passage(messages, curatorStart, targetIndex);
    const progressionText = passage(messages, progressionStart, targetIndex);
    const userText = messages.slice(progressionStart, targetIndex + 1)
        .filter(message => message?.is_user && !message.is_system)
        .map(message => cleanString(message.mes, 20_000))
        .join('\n');
    const explicitTimeSeconds = explicitUserTimeAdvanceSeconds(userText);
    const locationTransition = /\b(?:arriv(?:e|es|ed|ing)|enter(?:s|ed|ing)?|return(?:s|ed|ing)?|revisit(?:s|ed|ing)?|leave|leaves|left|depart(?:s|ed|ing)?|travel(?:s|led|ed|ing)?|head(?:s|ed|ing)?\s+(?:for|to|toward)|walk(?:s|ed|ing)?\s+(?:to|into|through)|ride(?:s|rode|den|ing)?\s+(?:to|into|through)|reach(?:es|ed|ing)?)\b/iu.test(curatorText);
    const custodyOrWorldChange = /\b(?:hand(?:s|ed|ing)?\s+(?:over|to)|give|gives|gave|given|take|takes|took|taken|open(?:s|ed|ing)?|close(?:s|d|ing)?|lock(?:s|ed|ing)?|unlock(?:s|ed|ing)?|break(?:s|ing)?|broke|broken|repair(?:s|ed|ing)?|find|finds|found|lose|loses|lost|missing|st(?:eal|ole|olen)|recover(?:s|ed|ing)?|destroy(?:s|ed|ing)?|dies?|died|kill(?:s|ed|ing)?)\b/iu.test(curatorText);
    const durableDecision = /\b(?:promise(?:s|d|ing)?|swear(?:s|ing)?|swore|vow(?:s|ed|ing)?|decide(?:s|d|ing)?|agree(?:s|d|ing)?|refuse(?:s|d|ing)?|learn(?:s|ed|ing)?|realize(?:s|d|ing)?|discover(?:s|ed|ing)?|reveal(?:s|ed|ing)?)\b/iu.test(curatorText);
    const records = listTriggerEventRecords(progression);
    const awaitingDelivery = records.some(record => record.runtime.deliveryStatus === 'injected');
    const actionWatcherMatches = relevantActionWatchers(records, progressionText);
    const actionWatcherMatchedLexically = actionWatcherMatches.length > 0;
    const bootstrap = curatorPendingTurns > 0
        && (Number.isInteger(store.lastProcessedIndex) ? store.lastProcessedIndex : -1) < 0
        && ((settings.autoLoreEnabled !== false && !Object.keys(store.entities || {}).length)
            || (settings.innerSelfEnabled !== false && !Object.keys(store.brains || {}).length));
    const adaptive = settings.adaptiveMaintenanceEnabled !== false;
    const curatorCadence = Math.max(1, Number(settings.processEveryAssistantTurns) || 3);
    const progressionCadence = Math.max(1, Number(settings.progressionEveryAssistantTurns) || 4);
    const minimumAdaptiveBatch = Math.max(1, Number(settings.minimumAdaptiveBatchTurns) || 2);
    const curatorReasons = [];
    const progressionReasons = [];

    if (bootstrap) curatorReasons.push('bootstrap');
    if (curatorPendingTurns >= curatorCadence) curatorReasons.push('cadence');
    if (adaptive && curatorPendingTurns >= minimumAdaptiveBatch && locationTransition) curatorReasons.push('location_transition');
    if (adaptive && curatorPendingTurns >= minimumAdaptiveBatch && custodyOrWorldChange) curatorReasons.push('world_state_change');
    if (adaptive && curatorPendingTurns >= minimumAdaptiveBatch && durableDecision) curatorReasons.push('durable_character_change');

    if (progressionPendingTurns >= progressionCadence) progressionReasons.push('cadence');
    // An armed time-trigger event means the story clock must keep ticking for
    // it to ever fire; the chronologist should not wait for the full cadence.
    const hasArmedTimeEvent = records.some(record => record.enabled && record.status === 'armed' && record.triggerAfterSeconds !== null);
    if (progressionPendingTurns > 0 && hasArmedTimeEvent) progressionReasons.push('armed_time_event');
    // Armed action watchers wait for the LLM evaluator rather than a hardcoded
    // lexical check; cap their wait at two assistant turns so a matched action
    // fires on the reply after next at the latest.
    const hasArmedActionEvent = records.some(record => record.enabled && record.status === 'armed' && record.actionCondition);
    if (progressionPendingTurns >= Math.min(2, progressionCadence) && hasArmedActionEvent) {
        progressionReasons.push('armed_action_event');
    }
    if (adaptive && progressionPendingTurns > 0 && explicitTimeSeconds > 0) progressionReasons.push('explicit_time');
    if (adaptive && progressionPendingTurns > 0 && awaitingDelivery) progressionReasons.push('delivery_verification');
    if (adaptive && progressionPendingTurns > 0 && hasPendingCreationAnchor(progression)) progressionReasons.push('creation_anchor');
    if (adaptive && progressionPendingTurns > 0 && actionWatcherMatchedLexically) progressionReasons.push('action_watcher');

    return {
        targetIndex,
        adaptive,
        curatorPendingTurns,
        progressionPendingTurns,
        curatorDue: curatorPendingTurns > 0 && curatorReasons.length > 0,
        progressionDue: progressionPendingTurns > 0 && progressionReasons.length > 0,
        curatorReasons,
        progressionReasons,
        signals: {
            explicitTimeSeconds,
            locationTransition,
            custodyOrWorldChange,
            durableDecision,
            awaitingDelivery,
            actionWatcherMatchedLexically,
            actionWatcherMatches,
            pendingCreationAnchor: hasPendingCreationAnchor(progression),
        },
    };
}
