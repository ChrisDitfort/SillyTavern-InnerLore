import assert from 'node:assert/strict';

const errors = [];
const listeners = [];
const macros = new Map();
const extensionSettings = {
    connectionManager: { profiles: [], selectedProfile: '' },
    disabledExtensions: [],
};
const chatMetadata = {};

globalThis.document = {
    activeElement: null,
    getElementById: () => null,
    querySelectorAll: () => [],
};
globalThis.$ = () => ({ append: () => {} });
globalThis.toastr = {
    error: message => errors.push(String(message)),
    warning: () => {},
    success: () => {},
};
globalThis.confirm = () => true;
globalThis.SillyTavern = {
    getContext: () => ({
        extensionSettings,
        chatMetadata,
        chat: [],
        chatId: '',
        name1: 'Player',
        name2: 'Narrator',
        getCurrentChatId: () => '',
        saveSettingsDebounced: () => {},
        saveMetadata: async () => {},
        saveMetadataDebounced: () => {},
        setExtensionPrompt: () => {},
        registerMacro: (name, handler) => macros.set(name, handler),
        renderExtensionTemplateAsync: async () => '',
        eventSource: { on: (...args) => listeners.push(args) },
        eventTypes: {
            APP_READY: 'app_ready',
            MESSAGE_RECEIVED: 'message_received',
            GENERATION_STARTED: 'generation_started',
            CHAT_CHANGED: 'chat_changed',
            CHAT_DELETED: 'chat_deleted',
            GROUP_CHAT_DELETED: 'group_chat_deleted',
            CHAT_RENAMED: 'chat_renamed',
            MESSAGE_EDITED: 'message_edited',
            MESSAGE_SWIPED: 'message_swiped',
            MESSAGE_DELETED: 'message_deleted',
        },
        SlashCommandParser: null,
        SlashCommand: null,
        ConnectionManagerRequestService: null,
    }),
};

await import(`../index.js?smoke=${Date.now()}`);
await new Promise(resolve => setTimeout(resolve, 20));

assert.deepEqual(errors, []);
assert.equal(listeners.length, 1, 'only the non-blocking APP_READY latch should be installed during SillyTavern startup');
assert.equal(listeners[0][0], 'app_ready');
assert.equal(listeners[0][1](), undefined, 'the APP_READY listener must not return the server initialization promise');
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(listeners.length, 10, 'runtime event listeners should be installed after APP_READY');
assert.ok(extensionSettings.inner_lore, 'default extension settings should initialize');
assert.equal(macros.size, 6);
assert.equal(macros.get('innerlore_state_context')(), '');
console.log('InnerLore mocked initialization OK');
