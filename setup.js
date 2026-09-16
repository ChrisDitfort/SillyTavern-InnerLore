#!/usr/bin/env node
/**
 * InnerLore one-step server-plugin setup (cross-platform).
 *
 * Run from anywhere after installing the InnerLore extension:
 *   node setup.js [path-to-sillytavern]
 *
 * Requires only Node.js — the same runtime SillyTavern already needs — so it
 * behaves identically on Linux, macOS, and Windows.
 *
 * What it does:
 *   1. Locates your SillyTavern root (argument, $ST_ROOT, or auto-detect).
 *   2. Links this repository's bundled SQLite plugin into plugins/
 *      (junction/symlink where available, plain copy otherwise).
 *   3. Enables enableServerPlugins in config.yaml if needed (backup kept).
 *   4. Prints the one remaining step: restart SillyTavern.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname);
const PLUGIN_SRC = path.join(REPO_ROOT, 'server', 'innerlore-storage');
const PLUGIN_NAME = 'innerlore-storage';

const say = message => console.log(`\x1b[1;34m[InnerLore]\x1b[0m ${message}`);
const die = message => {
    console.error(`\x1b[1;31m[InnerLore]\x1b[0m ${message}`);
    process.exit(1);
};

function looksLikeSillyTavernRoot(candidate) {
    try {
        return fs.statSync(path.join(candidate, 'server.js'), { mode: fs.constants.F_OK }).isFile()
            && fs.statSync(path.join(candidate, 'src'), { mode: fs.constants.F_OK }).isDirectory();
    } catch {
        return false;
    }
}

function findSillyTavernRoot() {
    const candidates = [];
    if (process.argv[2]) candidates.push(process.argv[2]);
    if (process.env.ST_ROOT) candidates.push(process.env.ST_ROOT);
    // ST installs extensions at data/<user>/extensions/third-party/<name>:
    // walk up to five levels, and also probe sibling "SillyTavern" folders
    // for standalone clones parked next to the server.
    let dir = REPO_ROOT;
    for (let level = 0; level <= 6; level++) {
        candidates.push(dir);
        for (const guess of ['SillyTavern', 'sillytavern']) {
            candidates.push(path.join(dir, guess));
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    candidates.push(process.cwd());
    for (const candidate of candidates) {
        if (looksLikeSillyTavernRoot(candidate)) return path.resolve(candidate);
    }
    return null;
}

function installPlugin(stRoot) {
    const pluginsDir = path.join(stRoot, 'plugins');
    fs.mkdirSync(pluginsDir, { recursive: true });
    const destination = path.join(pluginsDir, PLUGIN_NAME);
    let alreadyPresent = false;
    try {
        fs.lstatSync(destination);
        alreadyPresent = true;
    } catch {
        alreadyPresent = false;
    }
    if (alreadyPresent) {
        say(`Plugin already present at ${destination} (leaving untouched).`);
        return;
    }
    // Directory symlinks need a junction on Windows; fall back to a plain
    // recursive copy when neither is available.
    try {
        fs.symlinkSync(PLUGIN_SRC, destination, process.platform === 'win32' ? 'junction' : 'dir');
        say(`Linked plugin: ${destination} -> ${PLUGIN_SRC}`);
    } catch {
        fs.cpSync(PLUGIN_SRC, destination, { recursive: true });
        say(`Copied plugin to ${destination}`);
    }
}

function enableServerPlugins(stRoot) {
    const configPath = path.join(stRoot, 'config.yaml');
    if (!fs.existsSync(configPath)) {
        say(`No config.yaml found at ${configPath} — it is created on first launch.`);
        say('After it exists, ensure: enableServerPlugins: true');
        return;
    }
    const original = fs.readFileSync(configPath, 'utf8');
    let updated = original;
    if (/^\s*enableServerPlugins:\s*true\b/m.test(updated)) {
        say('Server plugins already enabled in config.yaml.');
        return;
    }
    if (/^\s*#\s*enableServerPlugins:/m.test(updated)) {
        updated = updated.replace(/^\s*#\s*(enableServerPlugins:.*)$/m, '$1');
    }
    if (/^\s*enableServerPlugins:/m.test(updated)) {
        updated = updated.replace(/^(\s*enableServerPlugins:)\s*\S+.*$/m, '$1 true');
    } else {
        updated = `${updated.replace(/\s*$/, '')}\nenableServerPlugins: true\n`;
    }
    fs.copyFileSync(configPath, `${configPath}.bak`);
    fs.writeFileSync(configPath, updated);
    say(`Enabled enableServerPlugins in config.yaml (backup: config.yaml.bak).`);
}

const stRoot = findSillyTavernRoot();
if (!stRoot) {
    die('Could not find your SillyTavern folder. Run: node setup.js /path/to/SillyTavern');
}
say(`SillyTavern root: ${stRoot}`);
installPlugin(stRoot);
enableServerPlugins(stRoot);
say('Setup complete. Restart SillyTavern, then verify:');
console.log(`    curl http://127.0.0.1:8000/api/plugins/${PLUGIN_NAME}/v1/health`);
