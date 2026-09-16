export const INNERLORE_CONTEXT_MACROS = Object.freeze({
    innerlore_state_context: 'rendered',
    innerlore_state_json: 'json',
    innerlore_scene_context: 'scene',
    innerlore_npc_context: 'minds',
    innerlore_lore_context: 'lore',
    innerlore_progression_context: 'progression',
});

const value = (input, fallback = '') => typeof input === 'string' ? input : fallback;

export function createLocalContextPacket(compilation, key) {
    const blocks = compilation?.blocks ?? {};
    const state = {
        schema: 'innerlore.local-fallback.v1',
        snapshot: { key, fallback: true },
        scene: compilation?.scene ?? null,
        bounds: { characters: Number(compilation?.characters) || value(compilation?.text).length },
    };
    return {
        key,
        source: 'local-fallback',
        rendered: value(compilation?.text),
        compact: value(compilation?.text),
        json: JSON.stringify(state),
        sections: {
            scene: value(blocks.scene), minds: value(blocks.minds),
            lore: value(blocks.lore), progression: value(blocks.progression),
        },
        state,
        diagnostics: { fallback: true },
    };
}

export function normalizePreparedContext(result, key) {
    if (!result || typeof result !== 'object') return null;
    const sections = result.sections && typeof result.sections === 'object' ? result.sections : {};
    return {
        key,
        source: 'server',
        rendered: value(result.rendered, value(result.compact)),
        compact: value(result.compact, value(result.rendered)),
        json: value(result.json, JSON.stringify(result.state ?? {})),
        sections: {
            scene: value(sections.scene), minds: value(sections.minds),
            lore: value(sections.lore), progression: value(sections.progression),
        },
        state: result.state ?? null,
        diagnostics: result.diagnostics ?? {},
        revision: result.revision ?? null,
        cache: result.cache ?? null,
    };
}

export function selectedContextPacket({ prepared, local, key }) {
    if (prepared?.key === key && prepared.rendered) return prepared;
    if (local?.key === key) return local;
    return null;
}

export function macroContextValue(macroName, { enabled, deliveryMode, prepared, local, key } = {}) {
    if (!enabled || deliveryMode !== 'macro') return '';
    const field = INNERLORE_CONTEXT_MACROS[macroName];
    if (!field) return '';
    const packet = selectedContextPacket({ prepared, local, key });
    if (!packet) return '';
    if (field === 'rendered' || field === 'json') return value(packet[field]);
    return value(packet.sections?.[field]);
}
