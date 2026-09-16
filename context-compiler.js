/**
 * Context Compiler v2
 *
 * Combines deterministic scene focus, selected private minds, public lore, and
 * World Progression into one bounded prompt without adding an LLM call.
 */

import { cleanString, compilePromptInjection } from './core.js';
import { collectRecentStoryExpressions } from './expression-cooldown.js';
import { compileProgressionInjection } from './progression.js';
import { deriveSceneState, renderSceneState } from './scene.js?v=4';

function reasonText(reasons) {
    return Array.isArray(reasons) && reasons.length ? reasons.join(', ') : 'not active in current scene';
}

export function formatContextDiagnostics(compilation) {
    if (!compilation) return 'Context Compiler v2 has no active chat state.';
    const lines = ['Context Compiler v2'];
    const scene = compilation.scene;
    lines.push(`Scene location: ${scene?.location?.name || '(not yet established)'}`);
    lines.push(`Engaged characters: ${(scene?.participants || []).map(item => item.name).join(', ') || '(none identified)'}`);
    lines.push(`Newest player source: ${scene?.latestUserName || '(unknown)'}`);
    lines.push(
        `Prompt size: ${compilation.characters} characters (~${Math.ceil(compilation.characters / 4)} tokens)`,
        `  Scene ${compilation.blocks.scene.length} · Minds ${compilation.blocks.minds.length} · Lore ${compilation.blocks.lore.length} · Progression ${compilation.blocks.progression.length}`,
        `Near-duplicate lines suppressed: ${compilation.duplicatesSuppressed}`,
        `Expression cooldown: ${compilation.surfaceCooldownCharacters ? `${compilation.surfaceCooldownCharacters} recent-story characters` : 'inactive'}`,
    );

    lines.push('', 'Selected private minds:');
    if (!compilation.selectedBrains.length) lines.push('- (none)');
    for (const brain of compilation.selectedBrains) {
        const current = brain.currentMindIncluded ? 'current mind included' : 'no fresh current mind';
        const cooled = brain.cooledSurfaceDetails
            ? `; ${brain.cooledSurfaceDetails} spent surface detail${brain.cooledSurfaceDetails === 1 ? '' : 's'} suppressed`
            : '';
        const rotated = brain.expressionAnchorRotated ? '; private lens rotated' : '';
        lines.push(`- ${brain.name}: ${brain.facetsSelected}/${brain.facetsAvailable} persistent facets, ${brain.voiceSelected} voice cues, ${brain.relationshipAspectsSelected} relationship aspects; ${current}${cooled}${rotated}; ${reasonText(brain.reasons)}; ${brain.characters} chars`);
    }

    lines.push('', 'Selected lore:');
    if (!compilation.selectedEntities.length) lines.push('- (none)');
    for (const entity of compilation.selectedEntities) {
        lines.push(`- [${entity.type}] ${entity.name}: ${reasonText(entity.reasons)}; ${entity.characters} chars${entity.clipped ? '; boundary-clipped' : ''}`);
    }

    lines.push('', 'Selected progression:');
    if (!compilation.selectedProgression.length) lines.push('- (none)');
    for (const record of compilation.selectedProgression) {
        lines.push(`- [${record.kind}] ${record.title}: ${reasonText(record.reasons)}`);
    }

    const omitted = compilation.omittedEntities
        .filter(item => item.reasons.includes('dormant/elsewhere') || item.score > 0)
        .slice(0, 12);
    lines.push('', 'Saved but not injected:');
    if (!omitted.length) lines.push('- (none)');
    for (const entity of omitted) {
        lines.push(`- [${entity.type}] ${entity.name}: ${reasonText(entity.reasons)}`);
    }
    return lines.join('\n');
}

export function compileContext(options = {}) {
    const settings = options.settings || {};
    if (!settings.enabled || !options.store) {
        const empty = {
            text: '',
            scene: null,
            blocks: { scene: '', minds: '', lore: '', progression: '' },
            selectedBrains: [],
            selectedEntities: [],
            selectedProgression: [],
            omittedEntities: [],
            duplicatesSuppressed: 0,
            expressionCaseStressPermitted: false,
            expressionCaseStressRequired: false,
            expressionCharacterName: '',
            expressionIdentityAnchor: '',
            expressionVoiceAnchor: '',
            expressionOuterVoiceAnchor: '',
            expressionEmphasisAnchor: '',
            expressionAnchorTerms: [],
            expressionSurfaceCooldown: false,
            surfaceCooldownCharacters: 0,
            characters: 0,
        };
        return { ...empty, diagnostics: formatContextDiagnostics(empty) };
    }

    const scene = deriveSceneState(options.messages, options.store, {
        currentIndex: options.currentIndex,
        playerName: options.playerName,
        lookbackMessages: settings.sceneLookbackMessages ?? 4,
    });
    const progression = compileProgressionInjection(options.store.progression, options.recentText, {
        ...settings,
        scene,
        latestText: scene.latestText,
    });
    const recentExpressionText = collectRecentStoryExpressions(options.messages, {
        endIndex: options.currentIndex,
        maximumReplies: settings.expressionCooldownReplies ?? 3,
        maximumCharacters: settings.expressionCooldownBudget ?? 1_600,
    });
    const continuity = compilePromptInjection(options.store, options.recentText, {
        ...settings,
        scene,
        latestText: scene.latestText,
        externalConcepts: progression.concepts,
        recentExpressionText,
    });
    const sceneText = settings.sceneContextEnabled === false
        ? ''
        : renderSceneState(scene, settings.sceneInjectionBudget ?? 1_200);
    const blocks = {
        scene: sceneText,
        minds: continuity.blocks.minds,
        lore: continuity.blocks.lore,
        progression: progression.text,
    };
    const text = cleanString(Object.values(blocks).filter(Boolean).join('\n\n'), 120_000);
    const expressionBrain = continuity.selectedBrains.find(brain => (
        brain.caseStressPermitted && brain.pressuredCurrentMind && brain.expressionAnchor
    )) || continuity.selectedBrains.find(brain => (
        brain.caseStressPermitted && brain.expressionAnchor
    )) || continuity.selectedBrains.find(brain => brain.expressionAnchor) || null;
    const compilation = {
        text,
        scene,
        blocks,
        selectedBrains: continuity.selectedBrains,
        selectedEntities: continuity.selectedEntities,
        selectedProgression: progression.selected,
        omittedEntities: continuity.omittedEntities,
        duplicatesSuppressed: continuity.duplicatesSuppressed,
        expressionCaseStressPermitted: continuity.selectedBrains.some(brain => brain.caseStressPermitted),
        expressionCaseStressRequired: continuity.selectedBrains.some(brain => (
            brain.caseStressPermitted && brain.pressuredCurrentMind
        )),
        expressionCharacterName: expressionBrain?.name || '',
        expressionIdentityAnchor: expressionBrain?.expressionAnchor || '',
        expressionVoiceAnchor: expressionBrain?.expressionVoiceAnchor || '',
        expressionOuterVoiceAnchor: expressionBrain?.expressionOuterVoiceAnchor || '',
        expressionEmphasisAnchor: expressionBrain?.expressionEmphasisAnchor || '',
        expressionAnchorTerms: expressionBrain?.expressionAnchorTerms || [],
        expressionSurfaceCooldown: Boolean(recentExpressionText),
        surfaceCooldownCharacters: recentExpressionText.length,
        characters: text.length,
    };
    return { ...compilation, diagnostics: formatContextDiagnostics(compilation) };
}
