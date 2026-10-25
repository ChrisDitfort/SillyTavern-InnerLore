/**
 * What the plugin borrows from the SillyTavern that loaded it. The plugin
 * lives in the extension's folder, reached through a symlink, so bare package
 * names and relative paths do not lead to SillyTavern; its modules are
 * imported by absolute file URL from the server's working directory (the
 * same instances SillyTavern already loaded) and `ws` through its
 * package.json. Under the tests nothing of this exists and every helper is
 * null; the callers fall back to their own readers or skip the step.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

let helpersPromise = null;

async function serverModule(relativePath) {
    const target = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(target)) return null;
    try {
        return await import(pathToFileURL(target).href);
    } catch (error) {
        console.warn(`[innerlore-storage] could not load ${relativePath}:`, error?.message || error);
        return null;
    }
}

/** SillyTavern's own helpers, loaded once; each is null when unavailable. */
export function stHelpers() {
    helpersPromise ??= (async () => {
        const [secrets, converters, util, jimp, users] = await Promise.all([
            serverModule('src/endpoints/secrets.js'),
            serverModule('src/prompt-converters.js'),
            serverModule('src/util.js'),
            serverModule('src/jimp.js'),
            serverModule('src/users.js'),
        ]);
        return {
            readSecret: typeof secrets?.readSecret === 'function' ? secrets.readSecret : null,
            postProcessPrompt: typeof converters?.postProcessPrompt === 'function' ? converters.postProcessPrompt : null,
            mergeObjectWithYaml: typeof util?.mergeObjectWithYaml === 'function' ? util.mergeObjectWithYaml : null,
            Jimp: jimp?.Jimp || null,
            JimpMime: jimp?.JimpMime || null,
            getUserDirectories: typeof users?.getUserDirectories === 'function' ? users.getUserDirectories : null,
        };
    })();
    return helpersPromise;
}

/** The `ws` package SillyTavern depends on, or null. */
export function requireWs() {
    try {
        return createRequire(path.join(process.cwd(), 'package.json'))('ws');
    } catch {
        return null;
    }
}

/**
 * A key from the user's secret store, read from the file directly: both the
 * flat format and the list format, the entry with the given id, else the
 * active one. Used when SillyTavern's secrets module is not importable.
 */
export function readSecretFromFile(directories, key, id = '') {
    const root = directories?.root || path.join(process.cwd(), 'data', 'default-user');
    try {
        const file = path.join(root, 'secrets.json');
        if (!fs.existsSync(file)) return '';
        const secrets = JSON.parse(fs.readFileSync(file, 'utf8'));
        const entries = secrets?.[key];
        if (typeof entries === 'string') return entries;
        if (Array.isArray(entries)) {
            const entry = (id && entries.find(item => item?.id === id)) || entries.find(item => item?.active);
            return String(entry?.value || '');
        }
    } catch (error) {
        console.warn('[innerlore-storage] could not read the secret store:', error?.message || error);
    }
    return '';
}

/** The user's directories as SillyTavern's middleware attaches them, or the default user's. */
export function directoriesOf(request) {
    const directories = request?.user?.directories;
    if (directories?.root) return directories;
    const root = path.join(process.cwd(), 'data', 'default-user');
    return { root, userImages: path.join(root, 'user', 'images'), chats: path.join(root, 'chats'), characters: path.join(root, 'characters') };
}
