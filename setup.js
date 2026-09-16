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
 *   4. Restarts SillyTavern automatically when it is running.
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

/**
 * Best-effort detection of a running SillyTavern: a live process whose
 * command line includes server.js resolved inside the detected root.
 */
function findRunningServer(stRoot) {
    const { execFileSync } = require('node:child_process');
    try {
        if (process.platform === 'win32') {
            const output = execFileSync('wmic', [
                'process', 'where', "name like '%node%'", 'get', 'ProcessId,CommandLine',
            ], { encoding: 'utf8', timeout: 10_000 });
            for (const line of output.split('\n')) {
                const match = line.match(/^(\d+)\s+(.*)$/);
                if (!match) continue;
                const command = match[2];
                if (/server\.js\b/.test(command) && command.includes(stRoot)) {
                    return { pid: Number(match[1]), command };
                }
            }
            return null;
        }
        const output = execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8', timeout: 10_000 });
        for (const line of output.split('\n')) {
            const match = line.match(/^\s*(\d+)\s+(.*)$/);
            if (!match) continue;
            const pid = Number(match[1]);
            const command = match[2];
            if (pid === process.pid) continue;
            if (!/server\.js\b/.test(command) || !/\bnode\b/.test(command)) continue;
            // Resolve relative paths in the command against the caller's cwd.
            const serverMatch = command.match(/((?:[\w.:\\/-]+)?server\.js)/);
            if (!serverMatch) continue;
            const target = path.join(stRoot, 'server.js');
            if (path.isAbsolute(serverMatch[1])) {
                if (serverMatch[1] === target) return { pid, command };
                continue;
            }
            // Relative invocations ("node server.js") must be resolved against
            // the process's own working directory: /proc/<pid>/cwd on Linux.
            if (process.platform !== 'win32') {
                try {
                    const cwd = fs.realpathSync(`/proc/${pid}/cwd`);
                    if (path.join(cwd, serverMatch[1]) === target) return { pid, command };
                } catch {
                    // Process cwd unreadable; skip this candidate.
                }
            }
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * Restart SillyTavern detached so it keeps running after this script (and
 * any terminal) exits. Uses the same start command the user already uses.
 */
function restartServer(stRoot) {
    const { spawn } = require('node:child_process');
    const isWin = process.platform === 'win32';
    // Prefer the platform launcher when present; fall back to raw node.
    const launcher = isWin ? 'Start.bat' : 'start.sh';
    const hasLauncher = fs.existsSync(path.join(stRoot, launcher));
    let child;
    if (hasLauncher) {
        child = isWin
            ? spawn('cmd.exe', ['/c', launcher], { cwd: stRoot, detached: true, stdio: 'ignore', windowsHide: true })
            : spawn('bash', [launcher], { cwd: stRoot, detached: true, stdio: 'ignore' });
    } else {
        child = spawn(process.execPath, ['server.js'], { cwd: stRoot, detached: true, stdio: 'ignore' });
    }
    child.unref();
}

async function waitForHealth(port, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 2_000));
        try {
            const response = await fetch(`http://127.0.0.1:${port}/api/plugins/${PLUGIN_NAME}/v1/health`);
            if (response.ok) {
                const payload = await response.json().catch(() => null);
                if (payload?.data?.plugin === PLUGIN_NAME) return true;
            }
        } catch {
            // Not up yet.
        }
    }
    return false;
}

function readPort(stRoot) {
    try {
        const config = fs.readFileSync(path.join(stRoot, 'config.yaml'), 'utf8');
        const match = config.match(/^\s*port:\s*(\d+)\s*$/m);
        if (match) return Number(match[1]);
    } catch {
        // No config or unreadable; fall through to the default.
    }
    return 8000;
}

async function main() {
    const stRoot = findSillyTavernRoot();
    if (!stRoot) {
        die([
            'Could not find your SillyTavern folder.',
            `Run the script from the extension folder:  cd ${REPO_ROOT}`,
            'or pass the path:  node setup.js /path/to/SillyTavern',
        ].join('\n'));
    }
    say(`SillyTavern root: ${stRoot}`);
    installPlugin(stRoot);
    enableServerPlugins(stRoot);

    const port = readPort(stRoot);
    const server = findRunningServer(stRoot);
    if (!server) {
        say('SillyTavern is not currently running. Start it normally; then verify:');
        console.log(`    curl http://127.0.0.1:${port}/api/plugins/${PLUGIN_NAME}/v1/health`);
        return;
    }
    say(`Stopping SillyTavern (pid ${server.pid})…`);
    try {
        process.kill(server.pid, 'SIGTERM');
    } catch {
        say('Could not stop the running server; restart it manually.');
        return;
    }
    // Wait for the pid to exit; force-kill after 20s so a stubborn wrapper
    // cannot leave an orphaned child holding the port.
    let exited = false;
    for (let i = 0; i < 20; i++) {
        await new Promise(resolve => setTimeout(resolve, 1_000));
        try {
            process.kill(server.pid, 0);
        } catch {
            exited = true;
            break;
        }
    }
    if (!exited) {
        say('Server did not exit within 20s; forcing…');
        try { process.kill(server.pid, 'SIGKILL'); } catch { /* already gone */ }
        await new Promise(resolve => setTimeout(resolve, 2_000));
    }
    // Give the OS a moment to release the listening socket.
    await new Promise(resolve => setTimeout(resolve, 2_000));
    say('Restarting SillyTavern…');
    restartServer(stRoot);
    say('Waiting for the storage plugin to come up…');
    const healthy = await waitForHealth(port, 120_000);
    if (healthy) {
        say('Setup complete — SillyTavern restarted and the InnerLore storage plugin is healthy.');
    } else {
        say('SillyTavern was relaunched, but the plugin health check did not pass within 2 minutes.');
        say('It may still be booting; verify manually:');
        console.log(`    curl http://127.0.0.1:${port}/api/plugins/${PLUGIN_NAME}/v1/health`);
    }
}

main().catch(error => die(error?.stack || String(error)));
