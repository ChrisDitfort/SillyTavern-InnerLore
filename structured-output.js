const objectItems = Object.freeze({ type: 'object', additionalProperties: true });

export const CURATOR_JSON_SCHEMA = Object.freeze({
    name: 'innerlore_curator_patch',
    description: 'A bounded InnerLore public-lore and private-mind patch.',
    strict: false,
    value: {
        type: 'object',
        properties: {
            entities: { type: 'array', items: objectItems },
            minds: { type: 'array', items: objectItems },
        },
        required: ['entities', 'minds'],
        additionalProperties: false,
    },
});

export const PROGRESSION_JSON_SCHEMA = Object.freeze({
    name: 'innerlore_progression_patch',
    description: 'A bounded time, world-progression, and trigger-evaluation patch.',
    strict: false,
    value: {
        type: 'object',
        properties: {
            time: { type: 'object', additionalProperties: true },
            goals: { type: 'array', items: objectItems },
            processes: { type: 'array', items: objectItems },
            events: { type: 'array', items: objectItems },
            event_evaluations: { type: 'array', items: objectItems },
        },
        required: ['time', 'goals', 'processes', 'events', 'event_evaluations'],
        additionalProperties: false,
    },
});

export const EVENT_DIRECTOR_JSON_SCHEMA = Object.freeze({
    name: 'innerlore_event_director_proposal',
    description: 'At most one grounded future trigger proposal.',
    strict: false,
    value: {
        type: 'object',
        properties: {
            proposal: {
                anyOf: [
                    { type: 'null' },
                    { type: 'object', additionalProperties: true },
                ],
            },
            reason: { type: 'string' },
        },
        required: ['proposal', 'reason'],
        additionalProperties: false,
    },
});
