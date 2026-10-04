/**
 * Context Compiler v2
 *
 * Combines deterministic scene focus, selected private minds, public lore, and
 * World Progression into one bounded prompt without adding an LLM call.
 */

import { cleanString, compilePromptInjection } from './core.js';
import { contextProfileOverrides } from './context-config.js';
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
    const recentExpressionText = collectRecentStoryExpressions(options.messages, {
        endIndex: options.currentIndex,
        maximumReplies: settings.expressionCooldownReplies ?? 3,
        maximumCharacters: settings.expressionCooldownBudget ?? 1_600,
    });
    // The effective allowance (derived mode, custom budgets, or profile) is a
    // hard cap on the assembled packet. Sections that overflow it are
    // recompiled with proportionally shrunken budgets - at most twice - and
    // progression is dropped as the last resort so the delivered packet can
    // never exceed what the context actually has room for.
    const totalBudget = Math.max(0, Math.round(contextProfileOverrides(settings).maximumCharacters || 0));
    let attemptSettings = settings;
    let continuity = null;
    let progression = null;
    let sceneText = '';
    let blocks = { scene: '', minds: '', lore: '', progression: '' };
    let text = '';
    for (let attempt = 0; ; attempt++) {
        progression = compileProgressionInjection(options.store.progression, options.recentText, {
            ...attemptSettings,
            scene,
            latestText: scene.latestText,
        });
        continuity = compilePromptInjection(options.store, options.recentText, {
            ...attemptSettings,
            scene,
            latestText: scene.latestText,
            externalConcepts: progression.concepts,
            recentExpressionText,
        });
        sceneText = attemptSettings.sceneContextEnabled === false
            ? ''
            : renderSceneState(scene, attemptSettings.sceneInjectionBudget ?? 1_200);
        blocks = {
            scene: sceneText,
            minds: continuity.blocks.minds,
            lore: continuity.blocks.lore,
            progression: progression.text,
        };
        text = cleanString(Object.values(blocks).filter(Boolean).join('\n\n'), 120_000);
        if (!totalBudget || text.length <= totalBudget || attempt >= 2) break;
        const factor = Math.max(0.2, (totalBudget / Math.max(1, text.length)));
        const scaled = (value, floor) => Math.max(floor, Math.floor((Number(value) || floor) * factor));
        attemptSettings = {
            ...attemptSettings,
            sceneInjectionBudget: scaled(attemptSettings.sceneInjectionBudget ?? 1_200, 400),
            brainInjectionBudget: scaled(attemptSettings.brainInjectionBudget ?? 6_000, 320),
            loreInjectionBudget: scaled(attemptSettings.loreInjectionBudget ?? 6_500, 240),
            progressionInjectionBudget: scaled(attemptSettings.progressionInjectionBudget ?? 3_000, 240),
        };
    }
    if (totalBudget && text.length > totalBudget && blocks.progression) {
        blocks.progression = '';
        text = cleanString(Object.values(blocks).filter(Boolean).join('\n\n'), 120_000);
    }
    // The expression cooldown normally rides inside the private-minds block,
    // which only renders when a relevant NPC mind exists. Quiet scenes still
    // need the anti-repetition guard: emit it standalone whenever minds did
    // not render but recent story expression text was collected.
    if (recentExpressionText && !blocks.minds) {
        const cooldownHeader = `<narration_freshness_cooldown priority="hard">
The excerpts below are distinctive wording already spent in the most recent replies. Do not reuse their imagery, descriptors, sentence shapes, or closing constructions; express continuity through fresh language and a fresh final beat.

`;
        const cooldownFooter = '\n</narration_freshness_cooldown>';
        // The packet's derived allowance stays a hard cap: the excerpt list is
        // clipped to whatever room remains after the compiled sections.
        const room = totalBudget
            ? Math.max(0, totalBudget - text.length - cooldownHeader.length - cooldownFooter.length - 2)
            : recentExpressionText.length;
        const excerpt = room > 80 ? recentExpressionText.slice(-room) : '';
        if (excerpt) {
            blocks.minds = `${cooldownHeader}${excerpt}${cooldownFooter}`;
            text = cleanString(Object.values(blocks).filter(Boolean).join('\n\n'), 120_000);
        }
    }
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
