import { clamp, hashString } from './core.js';

export const CONTEXT_CONFIGURATION_VERSION = 1;

export const BUILTIN_CONTEXT_PROFILES = Object.freeze({
    compact: Object.freeze({
        maximumCharacters: 9_000,
        graphDepth: 0,
        targetReservation: Object.freeze({ enabled: true, maximumItems: 8 }),
        sections: Object.freeze({
            scene: Object.freeze({ enabled: true, maximumItems: 1, maximumCharacters: 1_500 }),
            minds: Object.freeze({ enabled: true, maximumItems: 16, maximumCharacters: 3_000, maximumParents: 8, maximumItemsPerParent: 5 }),
            lore: Object.freeze({ enabled: true, maximumItems: 7, maximumCharacters: 3_000 }),
            progression: Object.freeze({ enabled: true, maximumItems: 6, maximumCharacters: 1_500 }),
        }),
    }),
    balanced: Object.freeze({
        maximumCharacters: 18_000,
        graphDepth: 1,
        targetReservation: Object.freeze({ enabled: true, maximumItems: 16 }),
        sections: Object.freeze({
            scene: Object.freeze({ enabled: true, maximumItems: 1, maximumCharacters: 2_500 }),
            minds: Object.freeze({ enabled: true, maximumItems: 30, maximumCharacters: 6_500, maximumParents: 12, maximumItemsPerParent: 8 }),
            lore: Object.freeze({ enabled: true, maximumItems: 12, maximumCharacters: 6_000 }),
            progression: Object.freeze({ enabled: true, maximumItems: 12, maximumCharacters: 3_000 }),
        }),
    }),
    expansive: Object.freeze({
        maximumCharacters: 32_000,
        graphDepth: 1,
        targetReservation: Object.freeze({ enabled: true, maximumItems: 24 }),
        sections: Object.freeze({
            scene: Object.freeze({ enabled: true, maximumItems: 1, maximumCharacters: 3_500 }),
            minds: Object.freeze({ enabled: true, maximumItems: 48, maximumCharacters: 12_000, maximumParents: 20, maximumItemsPerParent: 12 }),
            lore: Object.freeze({ enabled: true, maximumItems: 24, maximumCharacters: 11_000 }),
            progression: Object.freeze({ enabled: true, maximumItems: 24, maximumCharacters: 5_500 }),
        }),
    }),
});

const objectValue = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const integer = (value, fallback, minimum, maximum) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.round(clamp(parsed, minimum, maximum)) : fallback;
};

export function normalizeContextProfileConfig(value, fallback = BUILTIN_CONTEXT_PROFILES.balanced) {
    const source = objectValue(value);
    const base = objectValue(fallback);
    const sections = objectValue(source.sections);
    const baseSections = objectValue(base.sections);
    const section = (name, defaults) => {
        const supplied = objectValue(sections[name]);
        const result = {
            enabled: supplied.enabled === undefined ? defaults.enabled !== false : supplied.enabled === true,
            maximumItems: integer(supplied.maximumItems, defaults.maximumItems, 0, 200),
            maximumCharacters: integer(supplied.maximumCharacters, defaults.maximumCharacters, 0, 80_000),
        };
        if (name === 'minds') {
            result.maximumParents = integer(supplied.maximumParents, defaults.maximumParents ?? 12, 1, 100);
            result.maximumItemsPerParent = integer(supplied.maximumItemsPerParent, defaults.maximumItemsPerParent ?? 8, 1, 50);
        }
        return result;
    };
    return {
        maximumCharacters: integer(source.maximumCharacters, base.maximumCharacters ?? 18_000, 2_000, 100_000),
        graphDepth: integer(source.graphDepth, base.graphDepth ?? 1, 0, 1),
        targetReservation: {
            enabled: objectValue(source.targetReservation).enabled === undefined
                ? objectValue(base.targetReservation).enabled !== false
                : objectValue(source.targetReservation).enabled === true,
            maximumItems: integer(
                objectValue(source.targetReservation).maximumItems,
                objectValue(base.targetReservation).maximumItems ?? 16,
                0,
                64,
            ),
        },
        sections: {
            scene: section('scene', baseSections.scene ?? BUILTIN_CONTEXT_PROFILES.balanced.sections.scene),
            minds: section('minds', baseSections.minds ?? BUILTIN_CONTEXT_PROFILES.balanced.sections.minds),
            lore: section('lore', baseSections.lore ?? BUILTIN_CONTEXT_PROFILES.balanced.sections.lore),
            progression: section('progression', baseSections.progression ?? BUILTIN_CONTEXT_PROFILES.balanced.sections.progression),
        },
    };
}

export function contextProfileById(profileId, profiles = []) {
    const id = String(profileId || 'balanced').toLocaleLowerCase();
    const supplied = (Array.isArray(profiles) ? profiles : []).find(profile => profile?.id === id);
    if (supplied?.config) {
        return { ...supplied, id, config: normalizeContextProfileConfig(supplied.config, BUILTIN_CONTEXT_PROFILES[id] ?? BUILTIN_CONTEXT_PROFILES.balanced) };
    }
    const builtin = BUILTIN_CONTEXT_PROFILES[id] ?? BUILTIN_CONTEXT_PROFILES.balanced;
    return { id: BUILTIN_CONTEXT_PROFILES[id] ? id : 'balanced', name: id[0]?.toUpperCase() + id.slice(1), builtin: true, config: normalizeContextProfileConfig(builtin) };
}

export function applyContextProfileToSettings(settings, profile) {
    const config = normalizeContextProfileConfig(profile?.config, BUILTIN_CONTEXT_PROFILES[profile?.id] ?? BUILTIN_CONTEXT_PROFILES.balanced);
    settings.contextProfileId = profile?.id || 'balanced';
    settings.contextBudgetMode = 'profile';
    settings.contextMaximumCharacters = config.maximumCharacters;
    settings.contextGraphDepth = config.graphDepth;
    settings.sceneInjectionBudget = config.sections.scene.maximumCharacters;
    settings.brainInjectionBudget = config.sections.minds.maximumCharacters;
    settings.loreInjectionBudget = config.sections.lore.maximumCharacters;
    settings.progressionInjectionBudget = config.sections.progression.maximumCharacters;
    settings.maximumActiveBrains = config.sections.minds.maximumParents;
    settings.maximumInjectedThoughtsPerBrain = config.sections.minds.maximumItemsPerParent;
    settings.maximumInjectedEntities = config.sections.lore.maximumItems;
    settings.progressionMaximumInjectedEntries = config.sections.progression.maximumItems;
    return config;
}

export function markContextConfigurationCustom(settings) {
    settings.contextBudgetMode = 'custom';
    settings.contextMaximumCharacters = integer(
        settings.contextMaximumCharacters,
        Number(settings.sceneInjectionBudget || 0)
            + Number(settings.brainInjectionBudget || 0)
            + Number(settings.loreInjectionBudget || 0)
            + Number(settings.progressionInjectionBudget || 0),
        2_000,
        100_000,
    );
    return settings;
}

export function setCustomContextMaximum(settings, maximumCharacters) {
    const previousMaximum = Math.max(2_000, Number(settings.contextMaximumCharacters) || 18_000);
    const nextMaximum = integer(maximumCharacters, previousMaximum, 2_000, 100_000);
    const ratio = nextMaximum / previousMaximum;
    const scale = (key, minimum, maximum) => {
        settings[key] = integer(Math.round((Number(settings[key]) || minimum) * ratio), minimum, minimum, maximum);
    };
    scale('sceneInjectionBudget', 400, 8_000);
    scale('brainInjectionBudget', 500, 50_000);
    scale('loreInjectionBudget', 500, 60_000);
    scale('progressionInjectionBudget', 500, 40_000);
    settings.contextMaximumCharacters = nextMaximum;
    settings.contextBudgetMode = 'custom';
    return nextMaximum;
}

export function contextProfileOverrides(settings) {
    const sceneEnabled = settings.sceneContextEnabled !== false;
    const mindsEnabled = settings.innerSelfEnabled !== false;
    const loreEnabled = settings.autoLoreEnabled !== false;
    const progressionEnabled = settings.worldProgressionEnabled !== false;
    const enabledOnly = {
        sections: {
            scene: { enabled: sceneEnabled },
            minds: { enabled: mindsEnabled },
            lore: { enabled: loreEnabled },
            progression: { enabled: progressionEnabled },
        },
    };
    if (settings.contextBudgetMode !== 'custom') return enabledOnly;
    const sceneCharacters = sceneEnabled ? integer(settings.sceneInjectionBudget, 1_200, 0, 8_000) : 0;
    const mindCharacters = mindsEnabled ? integer(settings.brainInjectionBudget, 6_000, 0, 50_000) : 0;
    const loreCharacters = loreEnabled ? integer(settings.loreInjectionBudget, 8_000, 0, 60_000) : 0;
    const progressionCharacters = progressionEnabled ? integer(settings.progressionInjectionBudget, 5_000, 0, 40_000) : 0;
    return {
        maximumCharacters: integer(settings.contextMaximumCharacters, 18_000, 2_000, 100_000),
        graphDepth: integer(settings.contextGraphDepth, 1, 0, 1),
        targetReservation: { enabled: true, maximumItems: Math.max(8, integer(settings.maximumInjectedEntities, 8, 1, 30)) },
        sections: {
            scene: { enabled: sceneCharacters > 0, maximumItems: 1, maximumCharacters: sceneCharacters },
            minds: {
                enabled: mindCharacters > 0,
                maximumItems: Math.max(1, integer(settings.maximumActiveBrains, 12, 1, 20)
                    * integer(settings.maximumInjectedThoughtsPerBrain, 6, 1, 20)),
                maximumParents: integer(settings.maximumActiveBrains, 12, 1, 20),
                maximumItemsPerParent: integer(settings.maximumInjectedThoughtsPerBrain, 6, 1, 20),
                maximumCharacters: mindCharacters,
            },
            lore: {
                enabled: loreCharacters > 0,
                maximumItems: integer(settings.maximumInjectedEntities, 8, 1, 30),
                maximumCharacters: loreCharacters,
            },
            progression: {
                enabled: progressionCharacters > 0,
                maximumItems: integer(settings.progressionMaximumInjectedEntries, 8, 1, 30),
                maximumCharacters: progressionCharacters,
            },
        },
    };
}

export function contextConfigurationFingerprint(settings) {
    return hashString(JSON.stringify({
        profileId: settings.contextProfileId,
        mode: settings.contextBudgetMode,
        overrides: contextProfileOverrides(settings),
    }));
}

export function approximateContextTokens(characters) {
    return Math.ceil(Math.max(0, Number(characters) || 0) / 4);
}
