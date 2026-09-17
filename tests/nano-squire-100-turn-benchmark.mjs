/**
 * Resumable 1–100-turn live roleplay benchmark for the InnerLore extension.
 *
 * This optional harness is intentionally excluded from the ordinary node:test
 * glob. It uses saved SillyTavern connection profiles without logging credentials,
 * runs the production curator/progression cadence, projects each branch through
 * the SQLite/Ladybug storage plugin, and writes checkpoint/result JSON for the
 * PDF renderer.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
    alignExplicitLocationOperations,
    buildLatestTurnContract,
    canonicalNameKey,
    createEmptyStore,
    extractJsonObject,
    generatedProseIssue,
    mergeEntityOperations,
    mergeMindOperations,
    messageFingerprint,
    refreshMentionRecency,
    snapshotMessageRange,
} from '../core.js';
import { compileContext } from '../context-compiler.js';
import { compileTriggerEventDeliveryPreview } from '../event-delivery.js';
import {
    addEventProposal,
    decideAutomaticEventGeneration,
    eventDefinitionFromProposal,
    expireEventProposals,
    markEventProposalArmed,
    recordEventDirectorAttempt,
    validateEventDirectorPayload,
} from '../event-director.js';
import { buildEventDirectorMessages, buildEventDirectorRepairMessages } from '../event-director-prompts.js';
import { decideInnerLoreMaintenance } from '../maintenance-scheduler.js';
import { syncLorebook } from '../lorebook.js';
import { buildAnalysisMessages, buildRepairMessages, formatTranscript } from '../prompts.js';
import { validateProgressionPayload } from '../progression-client.js';
import { buildProgressionMessages, buildProgressionRepairMessages } from '../progression-prompts.js';
import { applyProgressionPatch, createProgressionState, getProgressionStats } from '../progression.js';
import {
    appendDslEvaluationKeyContract,
    normalizeOutputFormat,
    outputParseDiagnostics,
    parseInnerLoreOutput,
    prepareOutputMessages,
} from '../output-codec.js';
import {
    listTriggerEventRecords,
    markTriggerEventDeliveriesInjected,
    removeTriggerEventDefinition,
    triggerEventAgentSnapshot,
    upsertTriggerEventDefinition,
    verifyTriggerEventDeliveriesFromStory,
} from '../trigger-events.js';

const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const storageRoot = '/home/chris/airpg-storage';
const playerName = 'Rowan';
const storyName = 'Your useless squire';
const runDate = new Date().toISOString().slice(0, 10);

function argumentsMap(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index++) {
        const item = argv[index];
        if (!item.startsWith('--')) continue;
        const [rawKey, inlineValue] = item.slice(2).split('=', 2);
        if (inlineValue !== undefined) result[rawKey] = inlineValue;
        else if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[rawKey] = argv[++index];
        else result[rawKey] = true;
    }
    return result;
}

const cli = argumentsMap(process.argv.slice(2));
const targetTurns = Math.max(1, Math.min(100, Number(cli.turns) || 100));
// Node realpath's the entry script, which breaks the ../../.. derivation when
// the extension is symlinked into SillyTavern from a separate repository.
// --st-root overrides it explicitly for that dev-deploy layout.
const sillyTavernRoot = cli['st-root']
    ? path.resolve(String(cli['st-root']))
    : path.resolve(extensionRoot, '../../../..');
const runId = String(cli['run-id'] || `squire-${targetTurns}-turn-${runDate}`).replace(/[^a-z0-9._-]+/giu, '-');
const resultRoot = path.resolve(String(cli['output-dir'] || path.join(storageRoot, 'benchmark-results', runId)));
const requestedProfiles = String(cli.profiles || '').split(',').map(item => item.trim()).filter(Boolean);
const fresh = cli.fresh === true || cli.fresh === 'true';
const reaudit = cli.reaudit === true || cli.reaudit === 'true';
const rejudge = cli.rejudge === true || cli.rejudge === 'true';
const skipJudge = cli['skip-judge'] === true || cli['skip-judge'] === 'true';
const maintenanceOutputFormat = normalizeOutputFormat(cli['maintenance-format'] || 'json');
if (cli['maintenance-format'] && !['json', 'dsl'].includes(String(cli['maintenance-format']).trim().toLocaleLowerCase())) {
    throw new Error("--maintenance-format must be either 'json' or 'dsl'.");
}
const replayResultPath = cli['replay-result']
    ? path.resolve(String(cli['replay-result']))
    : '';
const replayResult = replayResultPath
    ? JSON.parse(fs.readFileSync(replayResultPath, 'utf8'))
    : null;
const replayTranscript = Array.isArray(replayResult?.transcript) ? replayResult.transcript : null;
if (replayResultPath && (!replayTranscript || replayTranscript.length < targetTurns)) {
    throw new Error(`--replay-result must contain at least ${targetTurns} prompt/output pairs.`);
}
const eventDirectorMode = String(cli['event-director'] || 'off').trim().toLowerCase();
if (!['off', 'review', 'auto_arm'].includes(eventDirectorMode)) {
    throw new Error("--event-director must be 'off', 'review', or 'auto_arm'.");
}
const eventDirectorActivity = String(cli['event-director-activity'] || 'balanced').trim().toLowerCase();
if (!['quiet', 'balanced', 'lively'].includes(eventDirectorActivity)) {
    throw new Error("--event-director-activity must be 'quiet', 'balanced', or 'lively'.");
}
const eventDirectorMinimumConfidence = Math.max(0, Math.min(1,
    Number(cli['event-director-minimum-confidence']) || 0.82));
const eventDirectorIncludePrivateMinds = cli['event-director-private-minds'] === true
    || cli['event-director-private-minds'] === 'true';
const eventDirectorExpirationTurns = Math.max(4, Math.min(200,
    Number(cli['event-director-expiration-turns']) || 40));
const glmProvider = String(cli['glm-provider'] || 'zai').trim().toLowerCase();
if (!['nanogpt', 'zai'].includes(glmProvider)) {
    throw new Error("--glm-provider must be either 'zai' or 'nanogpt'.");
}
const requestTimeoutMs = Math.max(15_000, Math.min(300_000, Number(cli['request-timeout-ms']) || 150_000));
const requestCircuitBreakerMs = Math.max(
    requestTimeoutMs,
    Math.min(600_000, Number(cli['request-circuit-breaker-ms']) || 480_000),
);
fs.mkdirSync(resultRoot, { recursive: true });

const allModelSpecs = [
    {
        key: 'deepseek-v4-pro-0813',
        label: 'DeepSeek V4 Pro 0813 (non-thinking)',
        profileName: 'NanoDeepseekV4Pro0813',
        model: 'deepseek/deepseek-v4-pro-0813',
        reasoningEffort: 'none',
        api: 'nanogpt',
    },
    glmProvider === 'zai' ? {
        key: 'glm-5.3-flash',
        label: 'GLM 5.3 Flash via Z.AI Coding (non-thinking/minimal)',
        profileName: 'Z-Ai-GLM5.3-Flash',
        model: 'glm-5.3-flash',
        reasoningEffort: 'disabled',
        api: 'zai',
    } : {
        key: 'glm-5.3-flash',
        label: 'GLM 5.3 Flash via NanoGPT (minimum reasoning; provider-required)',
        profileName: 'NanoGLM5.3Flash',
        model: 'z-ai/glm-5.3-flash-uncensored',
        reasoningEffort: 'minimal',
        api: 'nanogpt',
    },
    {
        key: 'glm-5.3',
        label: 'GLM 5.3 via Z.AI Coding (non-thinking/minimal)',
        profileName: 'Z-Ai-GLM5.3',
        model: 'glm-5.3',
        reasoningEffort: 'disabled',
        api: 'zai',
    },
];
const modelSpecs = allModelSpecs.filter(spec => !requestedProfiles.length
    || requestedProfiles.includes(spec.key)
    || requestedProfiles.includes(spec.profileName)
    || requestedProfiles.includes(spec.model));

if (!modelSpecs.length) throw new Error('No requested saved model profile matched.');

const settingsFile = JSON.parse(fs.readFileSync(path.join(sillyTavernRoot, 'data/default-user/settings.json'), 'utf8'));
const savedProfiles = settingsFile.extension_settings?.connectionManager?.profiles || [];
const savedSettings = settingsFile.extension_settings?.inner_lore || {};
const secretsFile = JSON.parse(fs.readFileSync(path.join(sillyTavernRoot, 'data/default-user/secrets.json'), 'utf8'));

const providerConfiguration = {
    nanogpt: {
        label: 'NanoGPT',
        secretKey: 'api_key_nanogpt',
        endpoint: () => 'https://nano-gpt.com/api/v1/chat/completions',
        endpointMode: () => 'standard',
    },
    zai: {
        label: 'Z.AI',
        secretKey: 'api_key_zai',
        endpoint: profile => profile['api-url'] === 'coding'
            ? 'https://api.z.ai/api/coding/paas/v4/chat/completions'
            : 'https://api.z.ai/api/paas/v4/chat/completions',
        endpointMode: profile => profile['api-url'] === 'coding' ? 'coding' : 'common',
    },
};

function secretRecords(secretKey) {
    const value = secretsFile[secretKey];
    return Array.isArray(value) ? value : [{ value, active: true }];
}

function resolveProfile(spec) {
    const profile = savedProfiles.find(item => item?.name === spec.profileName
        && item?.model === spec.model
        && item?.api === spec.api);
    if (!profile) throw new Error(`Saved ${spec.api} profile '${spec.profileName}' for '${spec.model}' was not found.`);
    const preset = JSON.parse(fs.readFileSync(
        path.join(sillyTavernRoot, 'data/default-user/OpenAI Settings', `${profile.preset}.json`),
        'utf8',
    ));
    const provider = providerConfiguration[profile.api];
    if (!provider) throw new Error(`Unsupported saved profile provider '${profile.api}'.`);
    const credential = secretRecords(provider.secretKey)
        .find(item => item?.id === profile['secret-id'] && item?.value)?.value;
    if (!credential) throw new Error(`The credential bound to saved profile '${spec.profileName}' is unavailable.`);
    return {
        ...spec,
        profile,
        preset,
        credential,
        providerApi: profile.api,
        providerLabel: provider.label,
        apiUrl: provider.endpoint(profile),
        endpointMode: provider.endpointMode(profile),
    };
}

const profiles = modelSpecs.map(resolveProfile);
const deepseekMaintenanceSpec = allModelSpecs.find(item => item.key === 'deepseek-v4-pro-0813');

function extractCardJson(pngPath) {
    const buffer = fs.readFileSync(pngPath);
    let offset = 8;
    let fallback = null;
    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
        const data = buffer.subarray(offset + 8, offset + 8 + length);
        if (type === 'tEXt') {
            const separator = data.indexOf(0);
            const key = data.subarray(0, separator).toString('latin1');
            if (key === 'chara' || key === 'ccv3') {
                const decoded = Buffer.from(data.subarray(separator + 1).toString('latin1'), 'base64').toString('utf8');
                const parsed = JSON.parse(decoded);
                if (key === 'ccv3') return parsed;
                fallback = parsed;
            }
        }
        offset += length + 12;
        if (type === 'IEND') break;
    }
    if (!fallback) throw new Error(`No character-card JSON found in ${pngPath}`);
    return fallback;
}

const cardFile = path.join(sillyTavernRoot, 'data/default-user/characters/Your useless squire.png');
const cardEnvelope = extractCardJson(cardFile);
const card = cardEnvelope.data || cardEnvelope;
const replaceMacros = value => String(value ?? '')
    .replaceAll('{{user}}', playerName)
    .replaceAll('{{char}}', storyName);
const characterCard = [
    `<character_card name="${storyName}">`,
    replaceMacros(card.description),
    '',
    '<scenario>',
    replaceMacros(card.scenario),
    '</scenario>',
    '</character_card>',
].join('\n');
const initialGreeting = replaceMacros(card.first_mes);

const benchmarkSettings = {
    ...savedSettings,
    enabled: true,
    innerSelfEnabled: true,
    autoLoreEnabled: true,
    worldProgressionEnabled: true,
    processEveryAssistantTurns: 3,
    progressionEveryAssistantTurns: 4,
    adaptiveMaintenanceEnabled: true,
    minimumAdaptiveBatchTurns: 2,
    maintenanceSchedulingVersion: 1,
    minimumImportance: Math.min(35, Number(savedSettings.minimumImportance) || 35),
    maximumEntitiesPerPass: Math.max(12, Number(savedSettings.maximumEntitiesPerPass) || 12),
    maximumMindOperationsPerPass: Math.max(20, Number(savedSettings.maximumMindOperationsPerPass) || 20),
    maximumThoughtChangesPerBrain: Math.max(6, Number(savedSettings.maximumThoughtChangesPerBrain) || 6),
    maximumSceneThoughtsPerBrain: Math.max(4, Number(savedSettings.maximumSceneThoughtsPerBrain) || 4),
    maximumActiveBrains: Math.max(12, Number(savedSettings.maximumActiveBrains) || 12),
    maximumInjectedEntities: Math.max(7, Number(savedSettings.maximumInjectedEntities) || 7),
    brainInjectionBudget: Math.max(5_000, Number(savedSettings.brainInjectionBudget) || 5_000),
    loreInjectionBudget: Math.max(6_500, Number(savedSettings.loreInjectionBudget) || 6_500),
    progressionInjectionBudget: Math.max(3_500, Number(savedSettings.progressionInjectionBudget) || 3_500),
    sceneContextEnabled: true,
    sceneLookbackMessages: 4,
    sceneInjectionBudget: Math.max(1_200, Number(savedSettings.sceneInjectionBudget) || 1_200),
    automaticEventDirectorEnabled: eventDirectorMode !== 'off',
    automaticEventDirectorMode: eventDirectorMode === 'review' ? 'review' : 'auto_arm',
    automaticEventDirectorActivity: eventDirectorActivity,
    automaticEventDirectorMinimumConfidence: eventDirectorMinimumConfidence,
    automaticEventDirectorIncludePrivateMinds: eventDirectorIncludePrivateMinds,
    automaticEventDirectorExpirationTurns: eventDirectorExpirationTurns,
    maintenanceOutputFormat,
};

const promptTexts = [
    'I take the sealed writ without making Freesia wait on the threshold. “Come in. Tell me why you still want this post despite the barracks gossip.” I leave her answer and movements to her.',
    'I show Freesia the house so we both have the same landmarks: the oak door faces east beneath a weathered blue-and-cream shield; a stone hearth is fixed to the north wall; a three-legged oak table stands beneath the west window; and an iron key on a red cord hangs from the peg beside the door. “Remember where things belong.”',
    'I give Freesia space to set down her pack, then ask to see the lucky charm she carries. I do not touch it or decide what she tells me.',
    'I set six mundane items on the west-window table—a whetstone, lamp, coil of cord, two buckles, and a sealed jar—and ask Freesia to inventory them aloud without moving the iron key.',
    'I compare her inventory with the table, correct only any factual mistake, and ask which duty she fears failing first.',
    'I lead her out through the east-facing oak door to the adjoining archery range. Establish the range clearly: six straw butts face an earthen north bank; a chalk firing line runs east to west; a black-fletched practice arrow is stuck high in target three; and a frayed blue cord beside the south rail operates the iron safety bell.',
    'Keeping Freesia behind the chalk line, I pull the frayed blue cord once. I wait for the range mechanism and make no other move.',
    'I ask Freesia to explain the range-clear procedure in her own words, then let the waiting trainees react for themselves.',
    'I hand her an unstrung practice bow and ask her to inspect limb, string, grip, and nocking point before anyone shoots.',
    'We continue careful equipment work until six full hours have passed. I return with Freesia to the east door of my house and look for anything newly arrived there.',
    'I read the courier’s notice exactly as presented and ask Freesia what preparation for Marshal Vane’s inspection should come first.',
    'After eight hours of sleep, I make oat porridge at the north-wall hearth. I ask Freesia to outline today’s training without pretending yesterday’s nerves vanished.',
    'I lock the east door with the iron key, return the key to its red cord, and walk with Freesia toward the garrison barracks.',
    'At the Garrison Training Yard I stop to establish fixed landmarks: a square sand court lies at the centre; a roofed weapon rack runs along the west wall; a dry stone well stands in the southeast corner; and a bronze practice ring hangs from a crossbeam over the northern target lane.',
    'I introduce Freesia to Captain Ilyra Dane and armourer Oren Pike. I let both NPCs form their own impressions and ask Ilyra for a basic footwork drill.',
    'I watch Freesia perform Ilyra’s footwork drill. I offer one concise correction only after she completes it.',
    'At the west-wall rack, I let Freesia choose between two safe practice bows and ask her to explain the choice.',
    'I place her at the northern target lane and tell her to shoot three ordinary arrows at a broad straw butt before attempting anything difficult.',
    'I give Freesia a whistle-tipped practice arrow and say, “When you are ready, loose it cleanly through the bronze practice ring.” I do not perform the shot for her.',
    'I stay beside the firing line, observe the actual result, and ask Freesia what she learned from the attempt.',
    'I gather our gear and start toward the Copper Mare Stable with Freesia, remaining alert to any consequence of what just happened in the training yard.',
    'At the Copper Mare Stable I establish the layout before saddling: twelve stalls line two facing rows; Bracken, my bay gelding with one white forefoot, occupies stall three; a cracked green stone trough stands by the north doors; and an empty brass lantern hook is fixed beside the tack-room door.',
    'I ask Freesia to groom Bracken in stall three while I watch his ears and her handling. I intervene only if immediate safety requires it.',
    'I have her inspect Bracken’s saddle, girth, bridle, and silver-trimmed spare tack, naming any wear she actually finds.',
    'We saddle Bracken correctly and leave through the stable’s north doors at a walk, heading for the East Gate.',
    'At the East Gate Watchhouse I establish fixed landmarks: a chipped stone lion sits left of the outer arch; a clockwise spiral stair climbs the south tower; a slate duty board hangs inside the guardroom; and a narrow bench is bolted beneath its east window.',
    'I show our patrol writ to the gate sergeant and ask Freesia to read the road conditions from the duty board.',
    'After a short patrol of the east fields, we return to the Copper Mare Stable after sunset. I ask Freesia to compare its twelve stalls, cracked green trough, brass hook, and Bracken’s third stall with our earlier visit.',
    'I unsaddle Bracken and check that his bay coat, single white forefoot, stall number, and tack placement remain consistent. Freesia may report any witnessed change.',
    'One full day passes while Freesia and I perform routine drills elsewhere in the garrison. We receive no report from inside the Copper Mare Stable during that day.',
    'The next morning I enter the Copper Mare Stable through the north doors and ask the stablemaster for the ordinary overnight report. I do not yet assume theft or accuse anyone.',
    'I wait while the stablemaster strikes the cracked handbell and states, “The third stall was opened from inside.” I listen without supplying an explanation.',
    'I remain at the entrance to stall three and inspect only what is visible. I ask Freesia to note any concrete problem before either of us touches the scene.',
    'I ask Freesia to separate observed clues from guesses about the stable incident. I write her observations down verbatim.',
    'I follow the muddy prints from the stable lane toward Market Square, with Freesia beside me and no conclusion yet about their maker.',
    'At Market Square I establish stable landmarks: an octagonal fountain occupies the centre; the Red Finch bakery has a copper bird sign on the west side; a covered weigh-station stands to the north; and three linden trees line the south edge.',
    'I question the fletcher at the covered weigh-station about silver-trimmed tack, asking only what they personally saw.',
    'I refuse to accuse the nervous stablehand on hearsay. I ask Freesia what further evidence would distinguish theft from a misplaced item.',
    'I return with Freesia to the East Gate Watchhouse and compare the chipped lion, clockwise south-tower stair, slate duty board, and bolted east-window bench with our first visit.',
    'I take the late watch at the East Gate, then sleep there for six hours while Freesia uses the guardroom cot. No one enters the south tower during our watch.',
    'I return to my house beside the archery range after our absence. From the threshold I compare the east oak door, weathered blue-and-cream shield, north-wall hearth, west-window table, and iron key on its red cord with the arrangement Freesia learned.',
    'I inspect the key, table, and shield for actual signs of interference, then ask Freesia what she remembers without feeding her an answer.',
    'At the range I ask Freesia to repeat the safe bow inspection and notice whether her manner has changed since her first morning.',
    'I leave the garrison with Freesia for the Old Quarry, following the tack clue rather than assuming guilt.',
    'At the Old Quarry I establish fixed landmarks: a timber winch stands on the east ledge; a taut red warning rope crosses the upper path; a rain-filled stone basin lies below a split granite face; and a rusted ore cart rests on the southern siding.',
    'Standing clear of the ledge, I cut the taut red warning rope with my knife and wait. I make no claim about what its mechanism will do.',
    'I observe the quarry mechanism’s actual response and ask Freesia to trace its connection without climbing onto the moving equipment.',
    'Near the rusted ore cart I find a loose silver buckle in the mud. I bag it as evidence rather than declaring it came from Bracken’s tack.',
    'I ask Freesia whether any witnessed detail links the buckle to the Copper Mare Stable, and I allow her uncertainty.',
    'We return to the Copper Mare Stable. Before discussing the buckle, I compare all twelve stalls, the cracked green trough, the empty brass hook, and Bracken in stall three against our earlier visits.',
    'I ask the stablemaster for a precise timeline of who entered stall three during our day away.',
    'With permission, Freesia and I search the hayloft above the tack room without moving unrelated property.',
    'I inspect a disturbed patch of hay and ask Freesia to describe what she sees before I reach into it.',
    'I recover the missing silver-trimmed tack from beneath the hay, return it to its proper place by stall three, and ask the stablemaster to confirm both recovery and custody.',
    'I question the stablehand Nella privately and calmly about the inside-opened stall, making clear that uncertainty is acceptable.',
    'I compare Nella’s account with the mud, buckle, and recovered tack. I ask Freesia to identify contradictions without deciding anyone’s punishment.',
    'We return to Market Square to investigate whether the disturbance relates to the approaching guild festival.',
    'I watch preparations around the octagonal fountain and verify that the Red Finch sign, northern weigh-station, and three southern lindens remain where established.',
    'To prevent violence between the carters’ and fletchers’ guilds, I read and sign the ivory peace tally with Guildmaster Sen, then watch both delegations countersign it.',
    'I ask Freesia what the signed tally changes and what risks remain, without asking her to invent secret conspirators.',
    'Two full days pass as Freesia and I patrol north into Ashwood. No message reaches us from the garrison during the journey.',
    'At the Ashwood Way-Shrine I establish fixed landmarks: five waist-high marker stones form a semicircle; a split ash tree grows behind them; a shallow roof shelters a dry offering shelf; and a square stone well stands ten paces east.',
    'I make camp outside the marker-stone semicircle and ask Freesia to choose a sensible watch order.',
    'By the low fire, I ask Freesia what part of her upbringing she is willing to discuss. I do not demand the rumour about her parentage be true.',
    'At dawn I ask Freesia to inspect tracks near the square well while I remain by the shrine roof.',
    'Rain begins steadily. I move our bedrolls beneath the shallow roof but leave the five stones, split ash, dry shelf, and square well undisturbed.',
    'I share the shelter with Freesia and ask her to reassess the tracks under the changed weather conditions.',
    'We return to the East Gate Watchhouse after the patrol. I compare the chipped stone lion, clockwise spiral stair, slate duty board, and bolted bench with both prior visits.',
    'I give Captain Ilyra a factual patrol report, separating the Ashwood observations from the earlier stable case.',
    'I ask Freesia to file our written evidence and rest. I do not tell her what she must feel about the investigation.',
    'I return with Freesia to the Garrison Training Yard after the long absence and compare the square sand court, west weapon rack, southeast dry well, and bronze ring over the northern lane with their established positions.',
    'Marshal Elric Vane arrives for the scheduled inspection. I greet him formally and let him set the first test.',
    'I ask Freesia to demonstrate equipment inspection for the marshal using a safe, unstrung bow.',
    'I tell Freesia, “Climb the west tower and raise the blue signal basket when Captain Ilyra gives the word.” I remain below and do not perform her action.',
    'I watch the tower and the garrison’s actual response to Freesia’s signal, intervening only for immediate danger.',
    'I ask Marshal Vane for specific feedback on Freesia’s preparation rather than a verdict based on her old reputation.',
    'I inspect the trainee line with Freesia and ask her to identify one unsafe stance.',
    'I invite Freesia to teach a nervous novice the bow check she has practised, leaving the words and method to her.',
    'I supervise a short mock bout in the square sand court and stop it at the first clean touch.',
    'At evening review, I ask Freesia to name one success, one mistake, and one next step from the inspection day.',
    'Three full days pass while Freesia and I escort a grain convoy home. At the north milestone we stop and look for anyone awaiting the returning patrol.',
    'I offer reasonable aid to the person at the north milestone and ask what brought them to the garrison road.',
    'We return to my house through its east-facing oak door. Before unpacking, I compare the weathered shield, north hearth, west-window three-legged table, and iron key on the red cord with the original arrangement.',
    'I put the travel ledger on the west-window table without moving the key, then ask Freesia to update our inventory.',
    'At the adjoining range I compare the six straw butts, north earthen bank, east-west chalk line, target-three arrow, and frayed blue bell cord with the first week.',
    'I ask Freesia to shoot another ordinary arrow through the bronze practice ring at the Garrison Training Yard. I expect no repeat of a one-time consequence unless current events justify it.',
    'I review Freesia’s notebook with her and ask her to correct any entry that conflicts with what we actually observed at the house, stable, gate, quarry, market, or shrine.',
    'I visit the Copper Mare Stable again and pause at the north doors before touching anything.',
    'I ask Freesia to verify the twelve stalls, cracked green trough, brass hook, Bracken’s bay coat and white forefoot, third-stall identity, and restored tack custody against her notes.',
    'I rest for eight hours in the loft guest room while Freesia takes the adjoining cot. Routine stable noises continue below.',
    'One full week passes through ordinary garrison duties. Freesia trains, reads, and serves, but no extraordinary event is assumed unless the established systems produce one.',
    'I return to the Old Quarry with Freesia and compare the east-ledge timber winch, upper-path warning rope location, rain-filled basin, split granite face, and rusted southern ore cart with our prior investigation.',
    'I inspect only changes that could follow from the cut warning rope, weather, or documented work. I ask Freesia to flag any impossible relocation.',
    'We revisit the Ashwood Way-Shrine and stop outside the marker stones.',
    'I compare the five-stone semicircle, split ash tree, shallow roof and offering shelf, and square well ten paces east with our earlier camp, allowing only plausible rain and time effects.',
    'I ask Freesia to lead the route back toward the garrison using landmarks she has learned. I follow without silently correcting her choices.',
    'At the East Gate Watchhouse I compare its persistent anchors once more and ask the gate sergeant about any documented repairs.',
    'Captain Ilyra mentions the sealed crypt beneath the south tower. I explicitly tell her not to open it, do not touch its seal, and ask Freesia to keep clear as well.',
    'I return to the house beside the range at dusk. From the doorway I compare every original house anchor, then ask Freesia how her understanding of being a squire has changed over these weeks.',
    'For our hundredth exchange, I take Freesia to the familiar chalk line, let her prepare the bow herself, and ask her to take the first supervised shot of tomorrow’s practice. End on the immediate result and an open next beat, without summarising the whole campaign.',
];

if (promptTexts.length !== 100) throw new Error(`Expected 100 scripted prompts, found ${promptTexts.length}.`);
const turns = promptTexts.map((user, index) => ({ number: index + 1, user }));

const locationSpecs = [
    {
        key: 'house',
        names: ["rowan's house"],
        establish: 2,
        returns: [41, 83, 99],
        anchors: ['east-facing oak door', 'weathered blue-and-cream shield', 'north-wall stone hearth', 'three-legged oak table beneath the west window', 'iron key on a red cord'],
    },
    {
        key: 'copper_mare_stable',
        names: ['copper mare stable'],
        establish: 22,
        returns: [28, 50, 88, 89],
        anchors: ['twelve stalls', 'Bracken in stall three', 'bay coat and one white forefoot', 'cracked green stone trough', 'brass lantern hook beside the tack-room door'],
    },
    {
        key: 'east_gate_watchhouse',
        names: ['east gate watchhouse'],
        establish: 26,
        returns: [39, 68, 97],
        anchors: ['chipped stone lion', 'clockwise spiral stair in the south tower', 'slate duty board', 'bolted bench beneath the east window'],
    },
    {
        key: 'garrison_training_yard',
        names: ['garrison training yard'],
        establish: 14,
        returns: [71, 86],
        anchors: ['square central sand court', 'roofed west-wall weapon rack', 'dry southeast stone well', 'bronze practice ring over the northern target lane'],
    },
    {
        key: 'old_quarry',
        names: ['old quarry'],
        establish: 45,
        returns: [92, 93],
        anchors: ['timber winch on the east ledge', 'red warning rope across the upper path', 'rain-filled stone basin', 'split granite face', 'rusted ore cart on the southern siding'],
    },
    {
        key: 'ashwood_way_shrine',
        names: ['ashwood way-shrine', 'ashwood way shrine'],
        establish: 62,
        returns: [94, 95],
        anchors: ['five marker stones in a semicircle', 'split ash tree', 'shallow roof and dry offering shelf', 'square stone well ten paces east'],
    },
];

const eventDefinitions = [
    {
        id: 'trigger:range_clear_bell', key: 'range_clear_bell', title: 'The range-clear bell responds',
        description: 'The iron safety bell rings twice and the waiting trainees lower their bows and step back from the chalk firing line.',
        consequences: 'Do not make Rowan pull the cord more than once.',
        enabled: true, actionCondition: 'Rowan pulls the frayed blue safety-bell cord at the archery range.',
        actionTiming: 'same_reply_attempt', actorScope: 'player', activationVisibility: 'observable', priority: 100,
        resolutionCondition: 'The firing line is formally reopened after the safety check.',
    },
    {
        id: 'trigger:marshal_inspection_writ', key: 'marshal_inspection_writ', title: 'Marshal Vane sends an inspection writ',
        description: 'An unnamed mud-spattered courier reaches Rowan’s east-facing house door, pins a yellow writ beneath the weathered shield, and says, “Marshal Vane inspects the squire at noon tomorrow.”',
        enabled: true, triggerAfterSeconds: 21_600, timeBasis: 'after_creation', triggerTimeCertainty: 'definite',
        activationVisibility: 'observable', priority: 98,
        resolutionCondition: 'Marshal Elric Vane completes the scheduled inspection of Freesia.',
    },
    {
        id: 'trigger:freesia_ring_shot', key: 'freesia_ring_shot', title: 'Freesia’s whistle-arrow opens the dovecote',
        description: 'After Freesia sends the whistle-tipped arrow through the bronze practice ring, its clear note trips the dovecote latch and a grey pigeon bearing a green ribbon circles down into the training yard.',
        enabled: true, actionCondition: 'Freesia looses the whistle-tipped practice arrow cleanly through the bronze practice ring.',
        actionTiming: 'after_outcome', actorScope: 'named', actorName: 'Freesia', activationVisibility: 'observable', priority: 94,
        resolutionCondition: 'The green-ribbon pigeon and its message are safely handed to Captain Ilyra Dane.',
    },
    {
        id: 'trigger:missing_silver_tack', key: 'missing_silver_tack', title: 'The silver-trimmed tack is missing',
        description: 'The silver-trimmed spare tack is absent from its proper peg by Bracken’s third stall, and fresh mud marks the inside of the stall latch.',
        enabled: true, triggerAfterSeconds: 86_400, timeBasis: 'after_creation', triggerTimeCertainty: 'definite',
        activationVisibility: 'hidden', revealCondition: 'The stablemaster strikes the cracked handbell and says that the third stall was opened from inside.',
        resolutionCondition: 'Rowan recovers the missing silver-trimmed tack and returns it to its proper place by stall three with the stablemaster confirming custody.',
        priority: 96,
    },
    {
        id: 'trigger:quarry_warning_winch', key: 'quarry_warning_winch', title: 'The quarry warning winch responds',
        description: 'The cut red warning rope releases a striped warning pennant and the timber winch on the east ledge begins lowering its empty hook toward the quarry floor.',
        consequences: 'The hook only begins lowering; do not claim it reaches the quarry floor in the same reply.',
        enabled: true, actionCondition: 'Rowan cuts the taut red warning rope at the Old Quarry.',
        actionTiming: 'same_reply_attempt', actorScope: 'player', activationVisibility: 'observable', priority: 92,
        resolutionCondition: 'The quarry winch is secured and the cut warning rope is documented for repair.',
    },
    {
        id: 'trigger:festival_ambush', key: 'festival_ambush', title: 'The guild-festival ambush',
        description: 'Masked agitators overturn the northern weigh-station table and begin an ambush beside the octagonal fountain.',
        enabled: true, actionCondition: 'The carters’ and fletchers’ peace talks collapse without a signed ivory tally.',
        actionTiming: 'after_outcome', actorScope: 'any', activationVisibility: 'hidden',
        cancellationCondition: 'Rowan and Guildmaster Sen sign the ivory peace tally and both guild delegations countersign it.',
        priority: 90,
    },
    {
        id: 'trigger:west_tower_signal', key: 'west_tower_signal', title: 'Freesia raises the west-tower signal',
        description: 'When Freesia raises the blue signal basket from the west tower, two yard sentries answer with blue pennants and the north-gate patrol begins forming below.',
        enabled: true, actionCondition: 'Freesia raises the blue signal basket from the west tower after Captain Ilyra gives the word.',
        actionTiming: 'after_outcome', actorScope: 'named', actorName: 'Freesia', activationVisibility: 'observable', priority: 93,
        resolutionCondition: 'Captain Ilyra dismisses the correctly formed north-gate patrol after inspection.',
    },
    {
        id: 'trigger:north_road_healer', key: 'north_road_healer', title: 'A travelling healer reaches the north milestone',
        description: 'At the north milestone, an unnamed travelling healer in a rain-grey cloak waits beside a handcart of bandages and asks Rowan for directions to the garrison infirmary.',
        enabled: true, triggerAfterSeconds: 432_000, timeBasis: 'after_creation', triggerTimeCertainty: 'definite',
        activationVisibility: 'observable', priority: 88,
        resolutionCondition: 'The travelling healer receives accurate directions or an escort to the garrison infirmary.',
    },
    {
        id: 'trigger:sealed_crypt', key: 'sealed_crypt', title: 'The sealed south-tower crypt opens',
        description: 'Captain Ilyra opens the sealed crypt beneath the south tower and a cold blue light spills onto the clockwise stair.',
        enabled: true, actionCondition: 'Captain Ilyra deliberately breaks the seal and opens the crypt beneath the south tower.',
        actionTiming: 'after_outcome', actorScope: 'named', actorName: 'Captain Ilyra Dane', activationVisibility: 'observable', priority: 70,
    },
];

function expectedEventOutcomesAtTurn(turn) {
    return {
        range_clear_bell: turn >= 8 ? ['revealed', 'resolved'] : turn >= 7 ? ['observable', 'revealed', 'resolved'] : ['armed'],
        marshal_inspection_writ: turn >= 75 ? ['resolved'] : turn >= 10 ? ['observable', 'revealed'] : ['armed'],
        freesia_ring_shot: turn >= 21 ? ['revealed', 'resolved'] : turn >= 19 ? ['armed', 'observable', 'revealed'] : ['armed'],
        missing_silver_tack: turn >= 54 ? ['resolved'] : turn >= 32 ? ['observable', 'revealed'] : turn >= 30 ? ['armed', 'active'] : ['armed'],
        quarry_warning_winch: turn >= 47 ? ['revealed', 'resolved'] : turn >= 46 ? ['observable', 'revealed'] : ['armed'],
        festival_ambush: turn >= 59 ? ['cancelled'] : ['armed'],
        west_tower_signal: turn >= 75 ? ['revealed', 'resolved'] : turn >= 74 ? ['armed', 'observable', 'revealed'] : ['armed'],
        north_road_healer: turn >= 82 ? ['revealed', 'resolved'] : turn >= 81 ? ['observable', 'revealed'] : ['armed'],
        sealed_crypt: ['armed'],
    };
}

function eventNarrativeConditions(campaign) {
    const assistantAt = turn => clean(campaign.chat[turn * 2]?.mes);
    const ringAttempt = assistantAt(19);
    // Failure language must describe the shot, arrow, or ring interaction. A
    // bare location word such as "the lane's edge" is not evidence of a miss.
    const ringNegative = /(?:\b(?:arrow|shot)\b[^.!?\n]{0,100}\b(?:clips?|clipped|strikes?|struck|hits?|miss(?:es|ed)?)\b[^.!?\n]{0,80}\b(?:ring|rim|edge)\b|\b(?:ring|rim)\b[^.!?\n]{0,80}\b(?:deflects?|turns?|sends?)\b[^.!?\n]{0,80}\b(?:arrow|shot)\b|\b(?:arrow|shot)\b[^.!?\n]{0,120}\b(?:does not|doesn't|did not|didn't|fails? to|failed to)\b[^.!?\n]{0,50}\b(?:pass|fly|go)\b[^.!?\n]{0,50}\bthrough\b)/iu.test(ringAttempt);
    const ringPositive = /\bwhistle(?:-tipped)?\b/iu.test(ringAttempt)
        && /\bthrough\b[^.!?\n]{0,100}\b(?:bronze\s+)?(?:practice\s+)?ring\b/iu.test(ringAttempt)
        && !ringNegative;
    const inspectionSequence = Array.from({ length: 10 }, (_, index) => assistantAt(72 + index)).join('\n');
    const inspectionComplete = /(?:\b(?:inspection|assessment)\b[^.!?\n]{0,100}\b(?:complete(?:d)?|concluded?|ended|finished|over)\b|\bmarshal\s+(?:elric\s+)?vane\b[^.!?\n]{0,120}\b(?:dismiss(?:es|ed)?|depart(?:s|ed)?|leaves?|left)\b)/iu.test(inspectionSequence);
    const towerAttempt = `${assistantAt(74)}\n${assistantAt(75)}`;
    const towerNegative = /\b(?:wait(?:s|ed|ing)?|remain(?:s|ed|ing)?|hold(?:s|ing)?|held)\b[^.!?\n]{0,100}\b(?:word|signal|order|cue)\b|\b(?:basket|signal)\b[^.!?\n]{0,80}\b(?:does not|doesn't|did not|didn't|has not|hasn't)\b[^.!?\n]{0,50}\b(?:rise|raised|move)/iu.test(towerAttempt);
    const towerDirectRaise = /\b(?:raise(?:s|d|ing)?|hoist(?:s|ed|ing)?|lift(?:s|ed|ing)?)\b[^.!?\n]{0,100}\bblue\b[^.!?\n]{0,60}\b(?:signal\s+)?basket\b/iu.test(towerAttempt);
    // The same completed action can be narrated through the mechanism rather
    // than the abstract verb: Freesia hauls the halyard, then the basket rides
    // to the crossarm with its blue cloth visible. Require both actor/action
    // and observable arrival evidence so merely touching the line cannot pass.
    const towerHalyardRaise = /\bfreesia\b[^.!?\n]{0,180}\b(?:haul(?:s|ed|ing)?|pull(?:s|ed|ing)?)\b/iu.test(towerAttempt)
        && /\b(?:signal\s+)?basket\b[^.!?\n]{0,140}\b(?:ride(?:s|d|ing)?|rise(?:s|n|ing)?|rose|reach(?:es|ed|ing)?|catch(?:es|ing)?|caught|ascend(?:s|ed|ing)?)\b[^.!?\n]{0,160}\b(?:blue|crossarm|aloft|visible)\b/iu.test(towerAttempt);
    const towerPositive = /\bfreesia\b/iu.test(towerAttempt) && (towerDirectRaise || towerHalyardRaise);
    return {
        marshalInspection: {
            observedComplete: inspectionComplete,
            evidence: inspectionSequence.slice(0, 2_000),
        },
        freesiaRingShot: {
            observed: ringPositive,
            explicitlyFailed: ringNegative,
            evidence: ringAttempt.slice(0, 1_000),
        },
        westTowerSignal: {
            observed: towerPositive,
            explicitlyDeferred: towerNegative && !towerPositive,
            evidence: towerAttempt.slice(0, 1_500),
        },
    };
}

function clean(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function words(value) {
    return clean(value).match(/\S+/gu)?.length || 0;
}

function slug(value) {
    return String(value).toLocaleLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}

function writeJsonAtomic(file, value) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, file);
}

function parseSseEvent(raw) {
    const data = raw.split(/\r?\n/u)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
        .join('\n');
    if (!data || data === '[DONE]') return null;
    try { return JSON.parse(data); } catch { return null; }
}

class ApiSemaphore {
    constructor(maximum) {
        this.maximum = maximum;
        this.active = 0;
        this.queue = [];
    }

    async acquire() {
        if (this.active < this.maximum) {
            this.active++;
            return;
        }
        await new Promise(resolve => this.queue.push(resolve));
        this.active++;
    }

    release() {
        this.active--;
        this.queue.shift()?.();
    }
}

const apiSemaphore = new ApiSemaphore(Math.max(1, Math.min(2, Number(cli.concurrency) || 2)));

function createChatClient(resolved, metricSink, logPrefix) {
    return async function providerChat(label, messages, options = {}) {
        const maximumAttempts = Math.max(1, Math.min(5, Number(options.attempts) || 3));
        const circuitBreakerMs = Math.max(
            requestTimeoutMs,
            Math.min(600_000, Number(options.circuitBreakerMs) || requestCircuitBreakerMs),
        );
        const circuitStarted = performance.now();
        let lastError;
        for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
            const remainingMs = circuitBreakerMs - (performance.now() - circuitStarted);
            if (remainingMs <= 0) throw lastError || new Error(`${label}: request circuit breaker expired.`);
            await apiSemaphore.acquire();
            const started = performance.now();
            try {
                const category = options.category || 'other';
                const thinkingType = resolved.providerApi === 'zai'
                    ? (options.thinkingType || (category === 'judge' ? 'enabled' : 'disabled'))
                    : null;
                // Z.AI counts hidden reasoning against max_tokens. Complex
                // story prompts can consume a small prose preset's entire
                // allowance before the first visible token, so retain the
                // prose length contract while reserving reasoning headroom.
                const requestedMaxTokens = options.maxTokens ?? 2_000;
                const responseMaxTokens = resolved.providerApi === 'zai'
                    ? Math.max(4_096, requestedMaxTokens)
                    : requestedMaxTokens;
                const requestBody = {
                    model: resolved.model,
                    messages,
                    temperature: options.temperature ?? resolved.preset.temperature ?? 0.85,
                    top_p: resolved.preset.top_p ?? 0.95,
                    max_tokens: responseMaxTokens,
                    stream: true,
                    stream_options: { include_usage: true },
                };
                if (resolved.providerApi === 'zai') {
                    requestBody.thinking = { type: thinkingType };
                    const maintenanceStructuredCategory = [
                        'curator', 'curator_repair', 'progression', 'progression_repair',
                        'event_director', 'event_director_repair',
                    ].includes(category);
                    if (category === 'judge'
                        || (maintenanceStructuredCategory
                            && normalizeOutputFormat(options.outputFormat) === 'json')) {
                        requestBody.response_format = { type: 'json_object' };
                    }
                } else {
                    Object.assign(requestBody, {
                        min_p: resolved.preset.min_p ?? 0.02,
                        repetition_penalty: resolved.preset.repetition_penalty ?? 1.05,
                        frequency_penalty: resolved.preset.frequency_penalty ?? 0,
                        presence_penalty: resolved.preset.presence_penalty ?? 0,
                        reasoning_effort: resolved.reasoningEffort,
                    });
                }
                const response = await fetch(resolved.apiUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${resolved.credential}`,
                        'Content-Type': 'application/json',
                        ...(resolved.providerApi === 'zai' ? { 'Accept-Language': 'en-US,en' } : {}),
                    },
                    body: JSON.stringify(requestBody),
                    signal: AbortSignal.timeout(Math.floor(Math.max(1, Math.min(
                        Number(options.timeoutMs) || requestTimeoutMs,
                        remainingMs,
                    )))),
                });
                if (!response.ok) {
                    const body = await response.text();
                    const error = new Error(`${label}: ${resolved.providerLabel} returned ${response.status}: ${body.slice(0, 500)}`);
                    error.retryable = response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500;
                    throw error;
                }
                if (!response.body) throw new Error(`${label}: ${resolved.providerLabel} returned no stream.`);
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                let content = '';
                let reasoningCharacters = 0;
                let usage = null;
                let firstTextMs = null;
                let firstEventMs = null;
                let finishReason = '';
                const consume = raw => {
                    const event = parseSseEvent(raw);
                    if (!event) return;
                    const elapsed = performance.now() - started;
                    firstEventMs ??= elapsed;
                    const choice = event.choices?.[0];
                    const delta = choice?.delta || {};
                    const nextText = typeof delta.content === 'string' ? delta.content : '';
                    const nextReasoning = clean(delta.reasoning ?? delta.reasoning_content ?? delta.thinking);
                    if (nextText) {
                        firstTextMs ??= elapsed;
                        content += nextText;
                    }
                    reasoningCharacters += nextReasoning.length;
                    if (event.usage) usage = event.usage;
                    if (choice?.finish_reason) finishReason = choice.finish_reason;
                };
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const events = buffer.split(/\r?\n\r?\n/u);
                    buffer = events.pop() || '';
                    for (const event of events) consume(event);
                }
                buffer += decoder.decode();
                if (buffer.trim()) consume(buffer);
                const result = {
                    label,
                    category: options.category || 'other',
                    attempt,
                    content: clean(content),
                    performance: {
                        firstEventMs: firstEventMs === null ? null : Number(firstEventMs.toFixed(1)),
                        firstTextMs: firstTextMs === null ? null : Number(firstTextMs.toFixed(1)),
                        totalMs: Number((performance.now() - started).toFixed(1)),
                    },
                    usage: usage || {},
                    reasoningCharacters,
                    finishReason,
                    providerApi: resolved.providerApi,
                    endpointMode: resolved.endpointMode,
                    thinkingType,
                    responseMaxTokens,
                    outputFormat: options.outputFormat || (category === 'judge' ? 'json' : null),
                };
                if (!result.content && options.allowEmpty !== true) {
                    throw new Error(`${label}: ${resolved.providerLabel} returned no final content `
                        + `(finish=${finishReason || 'unknown'}, reasoningCharacters=${reasoningCharacters}, maxTokens=${responseMaxTokens}).`);
                }
                metricSink.push({
                    label: result.label,
                    category: result.category,
                    attempt: result.attempt,
                    performance: result.performance,
                    usage: result.usage,
                    reasoningCharacters: result.reasoningCharacters,
                    finishReason: result.finishReason,
                    providerApi: result.providerApi,
                    endpointMode: result.endpointMode,
                    thinkingType: result.thinkingType,
                    responseMaxTokens: result.responseMaxTokens,
                    outputFormat: result.outputFormat,
                });
                return result;
            } catch (error) {
                lastError = error;
                metricSink.push({
                    label,
                    category: options.category || 'other',
                    attempt,
                    failed: true,
                    errorName: clean(error?.name || 'Error'),
                    error: clean(error?.message || String(error)).slice(0, 300),
                    performance: { totalMs: Number((performance.now() - started).toFixed(1)) },
                    usage: {},
                    reasoningCharacters: 0,
                    finishReason: '',
                    providerApi: resolved.providerApi,
                    endpointMode: resolved.endpointMode,
                    thinkingType: resolved.providerApi === 'zai'
                        ? (options.thinkingType || ((options.category || 'other') === 'judge' ? 'enabled' : 'disabled'))
                        : null,
                    outputFormat: options.outputFormat || ((options.category || 'other') === 'judge' ? 'json' : null),
                });
                const canRetry = attempt < maximumAttempts && error?.name !== 'AbortError'
                    && (error?.retryable !== false);
                if (!canRetry) throw error;
            } finally {
                apiSemaphore.release();
            }
            const delay = Math.min(20_000, 1_000 * (2 ** (attempt - 1)));
            if (performance.now() - circuitStarted + delay >= circuitBreakerMs) {
                throw lastError || new Error(`${label}: request circuit breaker expired.`);
            }
            process.stderr.write(`[${logPrefix}] ${label} attempt ${attempt} failed; retrying in ${delay} ms\n`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        throw lastError || new Error(`${label}: live request failed.`);
    };
}

function presetPrompt(preset, identifier) {
    return preset.prompts?.find(item => item.identifier === identifier)?.content || '';
}

function storyIssue(text) {
    const issue = generatedProseIssue(text);
    if (issue) return issue;
    if (/^\s*(?:roughly|approximately|about)?\s*\d+\s*[–—-]\s*\d+\s+words?\b/iu.test(text)) {
        return 'reply exposed the private target-length instruction';
    }
    if (words(text) < 35) return 'reply was too short to be a complete narrative turn';
    return '';
}

function recentStoryText(chat, maximumMessages = 4) {
    return chat.slice(-maximumMessages)
        .filter(message => !message.is_system)
        .map(message => clean(message.mes))
        .filter(Boolean)
        .join('\n');
}

function entityText(record) {
    if (!record) return '';
    return [
        record.name,
        record.summary,
        record.description,
        record.currentState,
        ...(record.facts || []),
        ...(record.relationships || []),
        ...(record.history || []),
        ...(record.unresolved || []),
    ].filter(Boolean).join('\n');
}

function summarizeEntity(record) {
    return {
        id: record.id,
        name: record.name,
        type: record.type,
        entryUid: record.entryUid ?? null,
        revision: record.revision ?? null,
        importance: record.importance ?? null,
        summary: record.summary || '',
        currentState: record.currentState || '',
        facts: record.facts || [],
        history: record.history || [],
        unresolved: record.unresolved || [],
    };
}

function summarizeBrain(brain) {
    if (!brain) return null;
    const relationships = Object.values(brain.persistentSelf?.relationships || {}).flatMap(relationship => (
        Object.values(relationship.aspects || {}).map(aspect => ({ target: relationship.target, ...aspect }))
    ));
    return {
        id: brain.id,
        name: brain.name,
        revision: brain.revision,
        facets: Object.values(brain.persistentSelf?.facets || {}).map(item => ({
            key: item.key, kind: item.kind, statement: item.statement, confidence: item.confidence,
            observations: item.observations ?? item.observationCount ?? null, basis: item.basis,
        })),
        voice: Object.values(brain.persistentSelf?.voice || {}).map(item => ({
            key: item.key, kind: item.kind, statement: item.statement, confidence: item.confidence,
            observations: item.observations ?? item.observationCount ?? null, basis: item.basis,
        })),
        relationships,
        currentMind: brain.currentMind ? {
            sourceMessage: brain.currentMind.sourceMessage,
            interpretation: brain.currentMind.interpretation,
            emotions: brain.currentMind.emotions,
            expectation: brain.currentMind.expectation,
            immediateGoal: brain.currentMind.immediateGoal,
            innerThoughts: brain.currentMind.innerThoughts,
            conflict: brain.currentMind.conflict,
            intention: brain.currentMind.intention,
        } : null,
    };
}

function findBrain(store, namePattern) {
    return Object.values(store.brains || {}).find(brain => namePattern.test(brain?.name || '')) || null;
}

function eventContracts(definitions) {
    return Object.fromEntries(definitions.map(definition => [definition.key, {
        createdAtMessage: definition.created_at_message,
        actionCondition: definition.action_condition,
        actorScope: definition.actor_scope,
        actorName: definition.actor_name,
        cancellationCondition: definition.cancellation_condition,
        revealCondition: definition.reveal_condition,
        resolutionCondition: definition.resolution_condition,
    }]));
}

function initializeStore(chatId) {
    const store = createEmptyStore(chatId);
    store.expressionFoundationVersion = 2;
    store.progression = createProgressionState();
    for (const definition of eventDefinitions) {
        store.progression = upsertTriggerEventDefinition(store.progression, definition, {
            clock: store.progression.clock,
            messageIndex: -2,
            playerName,
        }).state;
    }
    return store;
}

const priorSillyTavern = globalThis.SillyTavern;
const books = new Map();
globalThis.SillyTavern = {
    getContext: () => ({
        loadWorldInfo: async name => books.has(name) ? structuredClone(books.get(name)) : null,
        saveWorldInfo: async (name, data) => { books.set(name, structuredClone(data)); },
        updateWorldInfoList: async () => {},
    }),
};

const helpersUrl = pathToFileURL(path.join(storageRoot, 'test/helpers.js')).href;
const { temporaryWorld } = await import(helpersUrl);

function restoreBook(checkpoint) {
    if (checkpoint?.lorebook?.name && checkpoint.lorebook.data) {
        books.set(checkpoint.lorebook.name, structuredClone(checkpoint.lorebook.data));
    }
}

function restoreCommittedCheckpointChat(checkpoint) {
    if (!checkpoint || !Array.isArray(checkpoint.chat)) return checkpoint;
    const completed = Math.max(0, Math.min(targetTurns, Number(checkpoint.assistantTurns) || 0));
    const rebuilt = [checkpoint.chat[0] || {
        is_user: false, is_system: false, name: storyName, mes: initialGreeting,
    }];
    let cursor = 1;
    for (let turnIndex = 0; turnIndex < completed; turnIndex++) {
        const expectedPrompt = promptTexts[turnIndex];
        const userIndex = checkpoint.chat.findIndex((message, index) => (
            index >= cursor && message?.is_user && clean(message.mes) === clean(expectedPrompt)
        ));
        if (userIndex < 0) throw new Error(`Checkpoint is missing committed user turn ${turnIndex + 1}.`);
        const assistantIndex = checkpoint.chat.findIndex((message, index) => (
            index > userIndex && !message?.is_user && !message?.is_system && clean(message?.mes)
        ));
        if (assistantIndex < 0) throw new Error(`Checkpoint is missing committed assistant turn ${turnIndex + 1}.`);
        rebuilt.push(checkpoint.chat[userIndex], checkpoint.chat[assistantIndex]);
        cursor = assistantIndex + 1;
    }
    if (rebuilt.length !== checkpoint.chat.length) {
        process.stderr.write(`[checkpoint] removed ${checkpoint.chat.length - rebuilt.length} uncommitted or duplicate messages\n`);
    }
    checkpoint.chat = rebuilt;
    checkpoint.timeline = Array.isArray(checkpoint.timeline)
        ? checkpoint.timeline.slice(0, completed)
        : [];
    return checkpoint;
}

function compactEventState(state) {
    return Object.fromEntries(listTriggerEventRecords(state).map(record => [record.key, {
        title: record.title,
        origin: record.origin || 'user_authored',
        proposalId: record.proposalId || null,
        status: record.status,
        actionMatched: record.runtime.actionMatched,
        actionActor: record.runtime.actionActor,
        timeMatchedAtMessage: record.runtime.timeMatchedAtMessage,
        conditionSatisfiedAtMessage: record.runtime.conditionSatisfiedAtMessage,
        stateTransitionRecordedAtMessage: record.runtime.stateTransitionRecordedAtMessage,
        triggeredAtMessage: record.runtime.triggeredAtMessage,
        deliveryStatus: record.runtime.deliveryStatus,
        deliveryAttempts: record.runtime.deliveryAttempts,
        deliveryFirstInjectedAtMessage: record.runtime.deliveryFirstInjectedAtMessage,
        deliveredAtMessage: record.runtime.deliveryDeliveredAtMessage,
        deliveryInjectionReceipts: record.runtime.deliveryInjectionReceipts || [],
        resolutionEvidence: record.runtime.resolutionEvidence || [],
        cancellationEvidence: record.runtime.cancellationEvidence || [],
        revealEvidence: record.runtime.revealEvidence || [],
    }]));
}

function campaignSnapshot(campaign, turnNumber, contextPacket, sync, curator, progressionPass, delivery, eventDirector) {
    const entities = Object.values(campaign.store.entities || {});
    const freesia = findBrain(campaign.store, /\bfreesia\b/iu);
    return {
        turn: turnNumber,
        messageIndex: campaign.chat.length - 1,
        entityCount: entities.length,
        brainCount: Object.keys(campaign.store.brains || {}).length,
        lorebookEntryCount: sync.entryCount ?? Object.keys(books.get(sync.name)?.entries || {}).length,
        locations: entities.filter(record => record.type === 'location').map(record => ({
            id: record.id, name: record.name, entryUid: record.entryUid ?? null, revision: record.revision ?? null,
        })),
        freesia: freesia ? {
            id: freesia.id,
            revision: freesia.revision,
            facets: Object.keys(freesia.persistentSelf?.facets || {}).length,
            voice: Object.keys(freesia.persistentSelf?.voice || {}).length,
            relationships: Object.values(freesia.persistentSelf?.relationships || {})
                .reduce((sum, relationship) => sum + Object.keys(relationship.aspects || {}).length, 0),
            currentMindSource: freesia.currentMind?.sourceMessage ?? null,
            currentThoughts: freesia.currentMind?.innerThoughts?.length ?? 0,
        } : null,
        progression: {
            clock: structuredClone(campaign.store.progression.clock),
            stats: getProgressionStats(campaign.store.progression),
            events: compactEventState(campaign.store.progression),
        },
        context: contextPacket ? {
            characters: contextPacket.narrator.rendered.length,
            cache: contextPacket.narrator.cache?.status || '',
            candidateCount: contextPacket.narrator.diagnostics?.candidateCount ?? null,
            selectedCount: contextPacket.narrator.diagnostics?.selectedCount ?? null,
            elapsedMs: contextPacket.narrator.diagnostics?.elapsedMs ?? null,
            sceneLocation: contextPacket.local.scene?.location?.name || '',
            loreNames: contextPacket.narrator.state?.entities?.map(item => item.name) || [],
            mindNames: [...new Set((contextPacket.narrator.state?.minds || [])
                .map(item => item.content?.brainName || item.name).filter(Boolean))],
            progressionNames: contextPacket.narrator.state?.progression?.map(item => item.name) || [],
            resolvedTargets: contextPacket.narrator.diagnostics?.resolvedTargets || [],
            selectedTargets: contextPacket.narrator.diagnostics?.selectedTargets || [],
            missingTargets: contextPacket.narrator.diagnostics?.missingTargets || [],
            selectedTargetInvariantCount: contextPacket.narrator.diagnostics?.selectedTargetInvariantCount ?? null,
        } : null,
        delivery: {
            previewSeconds: delivery.previewSeconds,
            mandatory: delivery.deliveries.filter(item => item.kind !== 'attempt_preview').map(item => item.definitionId),
            conditional: delivery.deliveries.filter(item => item.kind === 'attempt_preview').map(item => item.definitionId),
        },
        curator,
        progressionPass,
        eventDirector,
    };
}

function summarizeCalls(calls) {
    const categories = {};
    for (const call of calls) {
        const category = call.category || 'other';
        const bucket = categories[category] ||= {
            calls: 0, successfulCalls: 0, failedAttempts: 0,
            promptTokens: 0, completionTokens: 0, reasoningTokens: 0,
            totalMs: 0, firstTextSamples: [],
        };
        bucket.calls++;
        if (call.failed) bucket.failedAttempts++;
        else bucket.successfulCalls++;
        bucket.promptTokens += Number(call.usage?.prompt_tokens) || 0;
        bucket.completionTokens += Number(call.usage?.completion_tokens) || 0;
        bucket.reasoningTokens += Number(call.usage?.reasoning_tokens
            ?? call.usage?.completion_tokens_details?.reasoning_tokens) || 0;
        bucket.totalMs += Number(call.performance?.totalMs) || 0;
        if (Number.isFinite(call.performance?.firstTextMs)) bucket.firstTextSamples.push(call.performance.firstTextMs);
    }
    const percentile = (values, fraction) => {
        if (!values.length) return null;
        const sorted = [...values].sort((a, b) => a - b);
        return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))].toFixed(1));
    };
    for (const bucket of Object.values(categories)) {
        bucket.averageMs = bucket.calls ? Number((bucket.totalMs / bucket.calls).toFixed(1)) : null;
        bucket.firstTextP50Ms = percentile(bucket.firstTextSamples, 0.5);
        bucket.firstTextP95Ms = percentile(bucket.firstTextSamples, 0.95);
        delete bucket.firstTextSamples;
    }
    const total = Object.values(categories).reduce((sum, item) => ({
        calls: sum.calls + item.calls,
        successfulCalls: sum.successfulCalls + item.successfulCalls,
        failedAttempts: sum.failedAttempts + item.failedAttempts,
        promptTokens: sum.promptTokens + item.promptTokens,
        completionTokens: sum.completionTokens + item.completionTokens,
        reasoningTokens: sum.reasoningTokens + item.reasoningTokens,
        totalMs: sum.totalMs + item.totalMs,
    }), {
        calls: 0, successfulCalls: 0, failedAttempts: 0,
        promptTokens: 0, completionTokens: 0, reasoningTokens: 0, totalMs: 0,
    });
    return { total, categories };
}

function duplicateGroups(records, keyForName = canonicalNameKey) {
    const groups = new Map();
    for (const record of records) {
        const key = keyForName(record.name);
        if (!key) continue;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(record.id);
    }
    return [...groups.entries()].filter(([, ids]) => ids.length > 1).map(([name, ids]) => ({ name, ids }));
}

function locationIdentityAudit(timeline) {
    return locationSpecs.filter(spec => spec.establish <= targetTurns).map(spec => {
        const relevantTurns = [spec.establish, ...spec.returns].filter(turn => turn <= targetTurns);
        const observations = relevantTurns.map(turn => {
            const lastPermittedTurn = turn === spec.establish
                ? Math.min(targetTurns, turn + Math.max(0, benchmarkSettings.processEveryAssistantTurns - 1))
                : turn;
            const candidates = timeline.filter(item => item.turn >= turn && item.turn <= lastPermittedTurn);
            for (const snapshot of candidates) {
                const matches = (snapshot?.locations || []).filter(location => spec.names.some(name => (
                    canonicalNameKey(location.name) === canonicalNameKey(name)
                )));
                if (matches.length) return { turn, observedAtTurn: snapshot.turn, matches };
            }
            return { turn, observedAtTurn: null, matches: [] };
        });
        const ids = observations.flatMap(item => item.matches.map(record => record.id));
        const uids = observations.flatMap(item => item.matches.map(record => record.entryUid)).filter(value => value !== null);
        return {
            ...spec,
            observations,
            uniqueRecordIds: [...new Set(ids)],
            uniqueLorebookUids: [...new Set(uids)],
            oneCanonicalRecordAtAuditedTurns: observations.every(item => item.matches.length === 1),
            stableRecordId: ids.length > 0 && new Set(ids).size === 1,
            stableLorebookUid: uids.length > 0 && new Set(uids).size === 1,
        };
    });
}

function buildDeterministicAudit(campaign, storageStats, health) {
    const assistantMessages = campaign.chat.filter((message, index) => index > 0 && !message.is_user && !message.is_system);
    const entities = Object.values(campaign.store.entities || {});
    const brains = Object.values(campaign.store.brains || {});
    const freesia = findBrain(campaign.store, /\bfreesia\b/iu);
    const eventState = compactEventState(campaign.store.progression);
    const narrativeConditions = eventNarrativeConditions(campaign);
    const stageExpectations = { ...expectedEventOutcomesAtTurn(targetTurns) };
    // The ring shot is an NPC-owned attempted action. A narrated miss must
    // remain armed; treating strict rejection as a delivery failure would
    // reward the event engine for overriding the roleplay outcome.
    if (targetTurns >= 19 && !narrativeConditions.freesiaRingShot.observed) {
        stageExpectations.freesia_ring_shot = ['armed'];
    }
    // A scheduled appearance is not proof that a multi-turn inspection has
    // concluded. Require completed-story evidence before demanding the final
    // resolution transition from the event engine.
    if (targetTurns >= 75 && !narrativeConditions.marshalInspection.observedComplete) {
        stageExpectations.marshal_inspection_writ = ['revealed'];
    }
    // This event is NPC-owned and conditional on Captain Ilyra's cue. If the
    // narration leaves Freesia waiting, an armed watcher is the correct state.
    if (targetTurns >= 74 && !narrativeConditions.westTowerSignal.observed) {
        stageExpectations.west_tower_signal = ['armed'];
    }
    const outcomes = Object.fromEntries(Object.entries(stageExpectations).map(([key, accepted]) => [key, {
        expected: accepted,
        actual: eventState[key]?.status || 'missing',
        passed: accepted.includes(eventState[key]?.status),
    }]));
    const returnTurns = new Set(locationSpecs.flatMap(spec => spec.returns));
    const returnSnapshots = campaign.timeline.filter(item => returnTurns.has(item.turn));
    const wordCounts = assistantMessages.map(message => words(message.mes));
    const mindSources = campaign.timeline.map(item => item.freesia?.currentMindSource).filter(Number.isInteger);
    const eventDeliveryTurns = campaign.timeline.filter(item => item.delivery.mandatory.length || item.delivery.conditional.length)
        .map(item => ({ turn: item.turn, ...item.delivery }));
    const automaticEvents = Object.fromEntries(Object.entries(eventState)
        .filter(([, item]) => item.origin === 'automatic_director'));
    const directorTurns = campaign.timeline.filter(item => item.eventDirector?.attempted || item.eventDirector?.generated)
        .map(item => ({ turn: item.turn, ...item.eventDirector }));
    return {
        completedPromptOutputPairs: assistantMessages.length,
        exactlyRequestedTurns: assistantMessages.length === targetTurns,
        prose: {
            allNonempty: assistantMessages.every(message => clean(message.mes)),
            allPassControlLeakCheck: assistantMessages.every(message => !generatedProseIssue(message.mes)),
            minimumWords: Math.min(...wordCounts),
            maximumWords: Math.max(...wordCounts),
            averageWords: Number((wordCounts.reduce((sum, count) => sum + count, 0) / wordCounts.length).toFixed(1)),
            recoveries: campaign.recoveries,
        },
        events: {
            outcomes,
            narrativeConditions,
            allExpectedOutcomes: Object.values(outcomes).every(item => item.passed),
            deliveryTurns: eventDeliveryTurns,
            pendingDelivery: Object.entries(eventState).filter(([, item]) => ['pending', 'injected'].includes(item.deliveryStatus)).map(([key]) => key),
            failedDelivery: Object.entries(eventState).filter(([, item]) => item.deliveryStatus === 'failed').map(([key]) => key),
            automatic: automaticEvents,
            final: eventState,
        },
        eventDirector: {
            enabled: benchmarkSettings.automaticEventDirectorEnabled,
            mode: eventDirectorMode,
            activity: eventDirectorActivity,
            includePrivateMinds: eventDirectorIncludePrivateMinds,
            attempts: directorTurns,
            stats: getProgressionStats(campaign.store.progression).eventDirector,
            proposals: Object.values(campaign.store.progression.eventProposals || {}),
        },
        locations: locationIdentityAudit(campaign.timeline),
        lore: {
            finalEntities: entities.length,
            typeCounts: Object.groupBy
                ? Object.fromEntries(Object.entries(Object.groupBy(entities, item => item.type)).map(([key, items]) => [key, items.length]))
                : entities.reduce((counts, item) => ({ ...counts, [item.type]: (counts[item.type] || 0) + 1 }), {}),
            duplicateCanonicalNames: duplicateGroups(entities),
            duplicateLocationNamesIgnoringLeadingArticles: duplicateGroups(
                entities.filter(item => item.type === 'location'),
                name => canonicalNameKey(name).replace(/^(?:a|an|the)\s+/u, ''),
            ),
            finalLorebookEntries: campaign.timeline.at(-1)?.lorebookEntryCount ?? 0,
        },
        npcBrain: {
            finalBrains: brains.length,
            duplicateCanonicalNames: duplicateGroups(brains),
            freesia: summarizeBrain(freesia),
            currentMindDistinctSources: [...new Set(mindSources)],
            currentMindEvolved: new Set(mindSources).size >= 5,
            noPlayerBrain: !brains.some(brain => canonicalNameKey(brain.name) === canonicalNameKey(playerName)),
        },
        progression: {
            clock: campaign.store.progression.clock,
            stats: getProgressionStats(campaign.store.progression),
            duplicateGoalTitles: duplicateGroups(Object.values(campaign.store.progression.goals || {}).map(item => ({
                id: item.key, name: item.title,
            }))),
            duplicateProcessTitles: duplicateGroups(Object.values(campaign.store.progression.processes || {}).map(item => ({
                id: item.key, name: item.title,
            }))),
            noPlayerOwnedGoal: !Object.values(campaign.store.progression.goals || {})
                .some(goal => canonicalNameKey(goal.owner) === canonicalNameKey(playerName)),
        },
        context: {
            returnsWithDetectedScene: returnSnapshots.filter(item => item.context?.sceneLocation).length,
            auditedReturnCount: returnSnapshots.length,
            averageCharacters: Number((campaign.timeline.reduce((sum, item) => sum + (item.context?.characters || 0), 0)
                / campaign.timeline.length).toFixed(1)),
            maximumCharacters: Math.max(...campaign.timeline.map(item => item.context?.characters || 0)),
            averageBuildMs: Number((campaign.timeline.reduce((sum, item) => sum + (item.context?.elapsedMs || 0), 0)
                / campaign.timeline.length).toFixed(2)),
            targetResolution: campaign.timeline.map(item => ({
                turn: item.turn,
                resolved: item.context?.resolvedTargets || [],
                selected: item.context?.selectedTargets || [],
                missing: item.context?.missingTargets || [],
            })).filter(item => item.resolved.length || item.selected.length || item.missing.length),
        },
        maintenance: {
            adaptive: true,
            curatorPasses: campaign.timeline.filter(item => item.curator).length,
            progressionPasses: campaign.timeline.filter(item => item.progressionPass).length,
            legacyEveryTurnCuratorPasses: targetTurns,
            legacyTwoTurnProgressionPasses: Math.ceil(targetTurns / 2),
        },
        database: {
            schemaVersion: storageStats.schemaVersion,
            sqliteBytes: storageStats.sqliteBytes,
            sqliteIntegrity: health.sqlite?.integrity,
            sqliteAuthoritative: health.sqlite?.authoritative,
            graph: storageStats.graph,
            projection: storageStats.projection,
            selectedCounts: Object.fromEntries(Object.entries(storageStats.counts)
                .filter(([key]) => key.startsWith('innerlore_'))),
        },
        performance: summarizeCalls(campaign.calls),
    };
}

function selectedTranscript(chat) {
    const allTurns = [];
    for (let index = 1, number = 1; index < chat.length; index += 2, number++) {
        const user = chat[index];
        const assistant = chat[index + 1];
        if (user?.is_user && assistant && !assistant.is_user) {
            allTurns.push({ turn: number, prompt: user.mes, output: assistant.mes });
        }
    }
    const keyTurns = new Set([
        1, 2, 6, 7, 10, 11, 14, 19, 20, 21, 22, 28, 30, 31, 32, 33, 39, 41,
        45, 46, 47, 50, 54, 59, 61, 62, 68, 71, 74, 75, 81, 83, 85, 88, 89,
        91, 92, 94, 95, 97, 98, 99, 100,
    ]);
    return allTurns.filter(item => keyTurns.has(item.turn));
}

function compactFinalState(store) {
    return {
        entities: Object.values(store.entities || {}).map(summarizeEntity),
        brains: Object.values(store.brains || {}).map(summarizeBrain),
        progression: {
            clock: store.progression.clock,
            goals: Object.values(store.progression.goals || {}),
            processes: Object.values(store.progression.processes || {}),
            events: Object.values(store.progression.events || {}),
            eventProposals: Object.values(store.progression.eventProposals || {}),
            triggerEvents: compactEventState(store.progression),
        },
    };
}

const judgeScoreKeys = [
    'card_fidelity',
    'narrative_coherence',
    'player_agency',
    'trigger_event_delivery',
    'hidden_event_boundaries',
    'return_location_continuity',
    'auto_lore_quality',
    'npc_brain_evolution',
    'world_progression',
    'context_efficiency',
];

function judgePayloadIssue(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Audit root must be an object.';
    if (!payload.scores || typeof payload.scores !== 'object' || Array.isArray(payload.scores)) {
        return 'scores must be an object.';
    }
    for (const key of judgeScoreKeys) {
        const value = payload.scores[key];
        if (!Number.isInteger(value) || value < 0 || value > 10) {
            return `scores.${key} must be an integer from 0 to 10; received ${JSON.stringify(value)}.`;
        }
    }
    if (!Number.isInteger(payload.overall_score) || payload.overall_score < 0 || payload.overall_score > 10) {
        return `overall_score must be an integer from 0 to 10; received ${JSON.stringify(payload.overall_score)}.`;
    }
    for (const key of [
        'event_findings', 'location_findings', 'strengths', 'weaknesses',
        'critical_failures', 'extension_findings', 'model_findings',
    ]) {
        if (!Array.isArray(payload[key])) return `${key} must be an array.`;
    }
    if (typeof payload.verdict !== 'string' || !payload.verdict.trim()) return 'verdict must be a non-empty string.';
    return '';
}

async function requestQualityJudge(campaign, deterministic) {
    const judgeProfile = campaign.maintenanceProfile;
    const judgeCalls = [];
    const judgeChat = createChatClient(judgeProfile, judgeCalls, `${campaign.spec.key}:judge`);
    const judgeMessages = [
        {
            role: 'system',
            content: `You are a strict long-form roleplay and memory-system auditor. Return one valid JSON object only. Assess evidence, not intentions. Scores are integers from 0 to 10. Missing repetition of every location detail is not itself a failure; contradictions, unexplained relocation, identity duplication, premature hidden knowledge, missed mandatory events, repeated one-shot events, loss of Freesia's card identity, player-character puppeting, incoherent progression, or bloated low-value state are failures. Separate model prose quality from InnerLore storage/context quality. Schema: {"scores":{"card_fidelity":0,"narrative_coherence":0,"player_agency":0,"trigger_event_delivery":0,"hidden_event_boundaries":0,"return_location_continuity":0,"auto_lore_quality":0,"npc_brain_evolution":0,"world_progression":0,"context_efficiency":0},"event_findings":[{"key":"","result":"pass|partial|fail","evidence":[""]}],"location_findings":[{"location":"","result":"pass|partial|fail","evidence":[""]}],"strengths":[""],"weaknesses":[""],"critical_failures":[""],"extension_findings":[""],"model_findings":[""],"overall_score":0,"verdict":""}.`,
        },
        {
            role: 'user',
            content: JSON.stringify({
                run: {
                    model: campaign.spec.model,
                    profile: campaign.spec.profileName,
                    reasoningEffort: campaign.spec.reasoningEffort,
                    turns: targetTurns,
                },
                characterCard: { description: card.description, scenario: replaceMacros(card.scenario) },
                fixedLocations: locationSpecs.filter(spec => spec.establish <= targetTurns).map(spec => ({
                    ...spec,
                    returns: spec.returns.filter(turn => turn <= targetTurns),
                })),
                editorAuthoredEvents: eventDefinitions,
                expectedEventOutcomes: deterministic.events.outcomes,
                deterministic,
                selectedPromptOutputPairs: selectedTranscript(campaign.chat),
                finalState: compactFinalState(campaign.store),
            }),
        },
    ];
    const first = await judgeChat('quality-judge', judgeMessages, {
        category: 'judge', temperature: 0, maxTokens: 6_000, attempts: 3,
        thinkingType: judgeProfile.providerApi === 'zai' ? 'disabled' : undefined,
    });
    let firstResult = null;
    let firstError = '';
    try {
        firstResult = extractJsonObject(first.content);
        firstError = judgePayloadIssue(firstResult);
    } catch (error) {
        firstError = error.message;
    }
    if (!firstError) return { parsed: true, result: firstResult, calls: judgeCalls };
    {
        const repair = await judgeChat('quality-judge-repair', [
            {
                role: 'system',
                content: 'Repair the supplied audit JSON without reassessing or adding evidence. Preserve its findings and category scores wherever valid. Return one JSON object only. Every category score and overall_score must be an integer from 0 to 10. If only overall_score uses a 100-point scale, replace it with the rounded mean of the ten category scores.',
            },
            {
                role: 'user',
                content: JSON.stringify({ validationError: firstError, invalidAudit: first.content }),
            },
        ], {
            category: 'judge', temperature: 0, maxTokens: 6_000, attempts: 2,
            thinkingType: judgeProfile.providerApi === 'zai' ? 'disabled' : undefined,
        });
        try {
            const repairedResult = extractJsonObject(repair.content);
            const repairIssue = judgePayloadIssue(repairedResult);
            if (repairIssue) throw new Error(repairIssue);
            return { parsed: true, repaired: true, firstError, result: repairedResult, calls: judgeCalls };
        } catch (repairError) {
            return { parsed: false, error: repairError.message, raw: repair.content, calls: judgeCalls };
        }
    }
}

async function runCampaign(spec) {
    const checkpointFile = path.join(resultRoot, `${spec.key}.checkpoint.json`);
    const resultFile = path.join(resultRoot, `${spec.key}.result.json`);
    if (fresh) {
        for (const file of [checkpointFile, resultFile]) {
            if (fs.existsSync(file)) fs.unlinkSync(file);
        }
    }
    const priorCompletedResult = fs.existsSync(resultFile)
        ? JSON.parse(fs.readFileSync(resultFile, 'utf8'))
        : null;
    if (priorCompletedResult && !reaudit && !rejudge) {
        if ((priorCompletedResult.transcript || []).length >= targetTurns) {
            process.stderr.write(`[${spec.key}] existing completed result reused (${priorCompletedResult.transcript.length} turns)\n`);
            return priorCompletedResult;
        }
    }
    const checkpoint = fs.existsSync(checkpointFile)
        ? restoreCommittedCheckpointChat(JSON.parse(fs.readFileSync(checkpointFile, 'utf8')))
        : null;
    restoreBook(checkpoint);
    const fixture = await temporaryWorld(`squire-${slug(spec.key)}-${Date.now()}`, { graphBackend: 'auto' });
    const maintenanceProfile = spec.providerApi === 'zai'
        ? spec
        : resolveProfile(deepseekMaintenanceSpec);
    const checkpointSegments = Array.isArray(checkpoint?.providerSegments)
        ? structuredClone(checkpoint.providerSegments)
        : checkpoint?.assistantTurns > 0 ? [{
            startTurn: 1,
            endTurn: checkpoint.assistantTurns,
            profile: checkpoint.profile || 'unknown',
            model: checkpoint.model || 'unknown',
            providerApi: /^Nano/iu.test(checkpoint.profile || '') ? 'nanogpt' : 'unknown',
            endpointMode: 'unknown',
        }] : [];
    const campaign = {
        spec,
        store: checkpoint?.store || initializeStore(`${runId}:${spec.key}`),
        chat: checkpoint?.chat || [{ is_user: false, is_system: false, name: storyName, mes: initialGreeting }],
        timeline: checkpoint?.timeline || [],
        calls: reaudit || rejudge
            ? (checkpoint?.calls || []).filter(call => call?.category !== 'judge')
            : (checkpoint?.calls || []),
        codecDiagnostics: checkpoint?.codecDiagnostics || [],
        recoveries: checkpoint?.recoveries || [],
        failures: checkpoint?.failures || [],
        nextProgressionStart: checkpoint?.nextProgressionStart ?? 0,
        assistantTurns: checkpoint?.assistantTurns || 0,
        storageRevision: 0,
        fixture,
        maintenanceProfile,
        providerSegments: checkpointSegments,
        providerSegmentStart: (checkpoint?.assistantTurns || 0) + 1,
    };
    const storyChat = createChatClient(spec, campaign.calls, `${spec.key}:story`);
    const maintenanceChat = createChatClient(maintenanceProfile, campaign.calls, `${spec.key}:maintenance`);

    function recordCodecDiagnostic(label, task, attempt, error, rawOutput) {
        const raw = String(rawOutput || '');
        campaign.codecDiagnostics.push({
            label,
            task,
            outputFormat: maintenanceOutputFormat,
            attempt,
            errorName: clean(error?.name || 'Error'),
            error: clean(error?.message || String(error)).slice(0, 1_000),
            rawLength: raw.length,
            rawPrefix: raw.slice(0, 1_500),
            rawSuffix: raw.length > 1_500 ? raw.slice(-1_500) : '',
            recordedAt: new Date().toISOString(),
        });
    }

    function recordCodecNormalizations(label, task, attempt, payload) {
        // Per-response record counts attribute coverage regressions: they show
        // what the model actually emitted before merge filtering or repair
        // replacement changed the committed state.
        const recordCounts = task === 'curator'
            ? { entities: payload?.entities?.length ?? 0, minds: payload?.minds?.length ?? 0 }
            : task === 'progression'
                ? {
                    goals: payload?.goals?.length ?? 0,
                    processes: payload?.processes?.length ?? 0,
                    events: payload?.events?.length ?? 0,
                    eventEvaluations: payload?.event_evaluations?.length ?? 0,
                }
                : { proposal: payload?.proposal ? 1 : 0 };
        campaign.codecDiagnostics.push({
            label,
            task,
            outputFormat: maintenanceOutputFormat,
            attempt,
            severity: 'parsed',
            code: 'record_counts',
            recordCounts,
            recordedAt: new Date().toISOString(),
        });
        for (const diagnostic of outputParseDiagnostics(payload)) {
            campaign.codecDiagnostics.push({
                label,
                task,
                outputFormat: maintenanceOutputFormat,
                attempt,
                severity: 'normalized',
                recordCounts,
                ...diagnostic,
                recordedAt: new Date().toISOString(),
            });
        }
    }

    function currentProviderSegments() {
        const segments = structuredClone(campaign.providerSegments);
        if (campaign.assistantTurns < campaign.providerSegmentStart) return segments;
        const next = {
            startTurn: campaign.providerSegmentStart,
            endTurn: campaign.assistantTurns,
            profile: spec.profileName,
            model: spec.model,
            providerApi: spec.providerApi,
            endpointMode: spec.endpointMode,
        };
        const previous = segments.at(-1);
        if (previous
            && previous.endTurn + 1 === next.startTurn
            && previous.profile === next.profile
            && previous.model === next.model
            && previous.providerApi === next.providerApi
            && previous.endpointMode === next.endpointMode) {
            previous.endTurn = next.endTurn;
        } else {
            segments.push(next);
        }
        return segments;
    }

    function currentScene() {
        return compileContext({
            store: campaign.store,
            messages: campaign.chat,
            currentIndex: campaign.chat.length - 1,
            playerName,
            recentText: recentStoryText(campaign.chat, 4),
            settings: benchmarkSettings,
        }).scene;
    }

    async function projectBranch(scene) {
        const head = campaign.chat.at(-1);
        const saved = campaign.fixture.storage.innerLore.put({
            chatId: campaign.store.chatId,
            store: campaign.store,
            expectedRevision: campaign.storageRevision,
            branch: {
                id: 'main',
                headFingerprint: head ? messageFingerprint(head) : '',
                headMessageIndex: campaign.chat.length - 1,
                sourceMessageIndex: campaign.store.lastProcessedIndex,
            },
            scene,
        });
        campaign.storageRevision = saved.revision;
        return saved;
    }

    async function prepareContext() {
        const local = compileContext({
            store: campaign.store,
            messages: campaign.chat,
            currentIndex: campaign.chat.length - 1,
            playerName,
            recentText: recentStoryText(campaign.chat, 4),
            settings: benchmarkSettings,
        });
        await projectBranch(local.scene);
        const latest = campaign.chat.at(-1);
        const input = {
            branchId: 'main',
            expectedRevision: campaign.storageRevision,
            headFingerprint: messageFingerprint(latest),
            currentMessageIndex: campaign.chat.length - 1,
            scene: local.scene,
            recentText: recentStoryText(campaign.chat, 4),
            turn: {
                status: 'uncommitted_input',
                speakerName: playerName,
                messageIndex: campaign.chat.length - 1,
                fingerprint: messageFingerprint(latest),
                text: latest.mes,
            },
            audience: { role: 'narrator' },
            overrides: {
                maximumCharacters: 16_000,
                graphDepth: 1,
                sections: {
                    scene: { maximumItems: 1, maximumCharacters: benchmarkSettings.sceneInjectionBudget },
                    minds: { maximumItems: 18, maximumParents: 3, maximumItemsPerParent: 8, maximumCharacters: benchmarkSettings.brainInjectionBudget },
                    lore: { maximumItems: benchmarkSettings.maximumInjectedEntities, maximumCharacters: benchmarkSettings.loreInjectionBudget },
                    progression: { maximumItems: benchmarkSettings.progressionMaximumInjectedEntries, maximumCharacters: benchmarkSettings.progressionInjectionBudget },
                },
            },
        };
        const narrator = await campaign.fixture.storage.innerLoreContext.build(input);
        return { local, narrator };
    }

    function storyMessages(userIndex, contextText, deliveryText, recoveryIssue = '') {
        const prompt = identifier => presetPrompt(spec.preset, identifier);
        const historyStart = Math.max(0, userIndex - 12);
        const history = campaign.chat.slice(historyStart, userIndex).map(message => ({
            role: message.is_user ? 'user' : 'assistant',
            content: message.mes,
        }));
        const messages = [
            { role: 'system', content: replaceMacros(prompt('main')) },
            {
                role: 'system',
                content: `${characterCard}\n\n<benchmark_contract>\nWrite only the next natural roleplay narration in roughly 110–180 words. Preserve Freesia's timid, anxious, self-doubting but quietly determined identity without reducing her to repetitive stammering. Keep spatial anchors, object custody, elapsed time, NPC knowledge, and unresolved causes consistent. A private narrator-state fact may guide causality but must not become public knowledge without observable evidence. Never invent Rowan's unprompted dialogue, thoughts, feelings, decisions, or completed actions. Advance one immediate beat and leave room for the next player turn. Do not quote or mention any control block, schema, context packet, benchmark, target length, or trigger mechanism.\n</benchmark_contract>`,
            },
        ];
        const identity = replaceMacros(prompt('npcIdentityAnchoring'));
        if (identity) messages.push({ role: 'system', content: identity });
        messages.push(...history);
        if (contextText) {
            messages.push({
                role: 'system',
                content: contextText,
            });
        }
        messages.push({ role: 'user', content: campaign.chat[userIndex].mes });
        const contract = buildLatestTurnContract(campaign.chat.slice(0, userIndex + 1), { playerName });
        if (contract) messages.push({ role: 'system', content: contract });
        if (deliveryText) messages.push({ role: 'system', content: deliveryText });
        if (recoveryIssue) {
            messages.push({
                role: 'system',
                content: `The prior draft was invalid (${recoveryIssue}). Regenerate the complete reply as natural story prose. Do not mention any prompt, control data, schema, event block, or failed draft. Preserve player agency and every mandatory event detail.`,
            });
        }
        const jailbreak = replaceMacros(prompt('jailbreak'));
        if (jailbreak) messages.push({ role: 'system', content: jailbreak });
        return messages;
    }

    async function narrate(turnNumber, userIndex, contextText, deliveryText) {
        let response = await storyChat(`turn-${turnNumber}:story`, storyMessages(userIndex, contextText, deliveryText), {
            category: 'story', maxTokens: spec.preset.openai_max_tokens || 600,
            temperature: spec.preset.temperature ?? 0.85,
        });
        const firstIssue = storyIssue(response.content);
        let issue = firstIssue;
        let attempts = 0;
        while (issue && attempts < 2) {
            attempts++;
            response = await storyChat(`turn-${turnNumber}:story-recovery-${attempts}`, storyMessages(
                userIndex, contextText, deliveryText, issue,
            ), {
                category: 'story_recovery', maxTokens: spec.preset.openai_max_tokens || 600,
                temperature: spec.preset.temperature ?? 0.85,
            });
            issue = storyIssue(response.content);
        }
        if (firstIssue) campaign.recoveries.push({ turn: turnNumber, firstIssue, attempts, finalIssue: issue });
        if (issue) throw new Error(`turn ${turnNumber}: invalid story output remained quarantined after ${attempts} recoveries (${issue}).`);
        return response.content;
    }

    async function requestCurator(label, messages) {
        const requestMessages = prepareOutputMessages(messages, {
            format: maintenanceOutputFormat, task: 'curator',
        });
        let response = await maintenanceChat(`${label}:curator`, requestMessages, {
            category: 'curator', temperature: benchmarkSettings.temperature ?? 0.15,
            maxTokens: benchmarkSettings.maximumResponseTokens || 12_000,
            outputFormat: maintenanceOutputFormat,
        });
        let firstError = '';
        let latestError = '';
        // Live benchmark checkpoints are expensive. Permit one more repair
        // than the interactive default and tell the repair model how to handle
        // a truncated final member instead of repeatedly preserving bad JSON.
        const maximumRepairs = Math.max(3, Math.min(4, Number(benchmarkSettings.incompleteRecoveryAttempts) || 3));
        for (let repairAttempt = 0; repairAttempt <= maximumRepairs; repairAttempt++) {
            try {
                const payload = parseInnerLoreOutput(response.content, {
                    format: maintenanceOutputFormat, task: 'curator', salvageTruncated: true,
                });
                recordCodecNormalizations(label, 'curator', repairAttempt, payload);
                if (!Array.isArray(payload?.entities) || !Array.isArray(payload?.minds)) throw new Error('Curator arrays are missing.');
                return { payload, repaired: repairAttempt > 0, repairAttempts: repairAttempt, firstError };
            } catch (error) {
                recordCodecDiagnostic(label, 'curator', repairAttempt, error, response.content);
                firstError ||= error.message;
                latestError = error.message;
                if (repairAttempt >= maximumRepairs) throw error;
            }
            const repairMessages = buildRepairMessages(response.content);
            repairMessages[0].content += ' The prior parser error was: ' + latestError
                + (maintenanceOutputFormat === 'json'
                    ? ' If the source ends inside an array member, discard only that incomplete member, close every array/object, and retain both required arrays.'
                    : ' If the source ends inside a record, discard only that incomplete record, close every retained record with END, and finish with DONE.')
                + ' Keep the result compact and silently validate it before answering.';
            const preparedRepairMessages = prepareOutputMessages(repairMessages, {
                format: maintenanceOutputFormat, task: 'curator',
            });
            response = await maintenanceChat(`${label}:curator-repair-${repairAttempt + 1}`, preparedRepairMessages, {
                category: 'curator_repair', temperature: 0,
                maxTokens: benchmarkSettings.maximumResponseTokens || 12_000,
                outputFormat: maintenanceOutputFormat,
            });
        }
        throw new Error(`${label}: curator repair loop ended unexpectedly.`);
    }

    async function runCurator(turnNumber, startIndex, endIndex) {
        const transcript = formatTranscript(campaign.chat, {
            startIndex,
            endIndex,
            userName: playerName,
            characterName: storyName,
            maximumCharacters: 45_000,
        });
        const recentExpressionText = campaign.chat.slice(Math.max(0, startIndex - 6), startIndex)
            .filter(message => !message.is_user && !message.is_system)
            .map(message => message.mes)
            .join('\n');
        const messages = buildAnalysisMessages({
            transcript,
            store: campaign.store,
            currentIndex: endIndex,
            playerName,
            characterCard,
            recentExpressionText,
            settings: benchmarkSettings,
        });
        const response = await requestCurator(`turn-${turnNumber}`, messages);
        const alignedEntityOperations = alignExplicitLocationOperations(
            campaign.store,
            response.payload.entities,
            transcript,
        );
        const entityResult = mergeEntityOperations(campaign.store, alignedEntityOperations, {
            enabledTypes: benchmarkSettings.enabledEntityTypes,
            minimumImportance: benchmarkSettings.minimumImportance,
            maximumOperations: benchmarkSettings.maximumEntitiesPerPass,
            messageIndex: endIndex,
        });
        const playerKey = canonicalNameKey(playerName);
        const mindOperations = response.payload.minds.filter(operation => canonicalNameKey(operation?.character) !== playerKey);
        const mindResult = mergeMindOperations(campaign.store, mindOperations, {
            maximumOperations: benchmarkSettings.maximumMindOperationsPerPass,
            maximumThoughts: benchmarkSettings.maximumThoughtsPerBrain,
            maximumThoughtChanges: benchmarkSettings.maximumThoughtChangesPerBrain,
            maximumSceneThoughts: benchmarkSettings.maximumSceneThoughtsPerBrain,
            messageIndex: endIndex,
            minimumStoryFacetObservations: benchmarkSettings.minimumStoryFacetObservations,
            consolidationSimilarity: benchmarkSettings.brainConsolidationSimilarity,
        });
        const mentions = refreshMentionRecency(campaign.store, transcript, endIndex, { entities: true, brains: true });
        campaign.store.lastProcessedIndex = endIndex;
        for (const [index, fingerprint] of Object.entries(snapshotMessageRange(campaign.chat, startIndex, endIndex))) {
            if (fingerprint) campaign.store.processedFingerprints[index] = fingerprint;
        }
        return {
            repaired: response.repaired,
            repairAttempts: response.repairAttempts || 0,
            firstError: response.firstError || '',
            proposed: { entities: response.payload.entities.length, minds: response.payload.minds.length },
            committed: { entities: entityResult, minds: mindResult, mentions },
        };
    }

    async function requestProgression(label, messages, startIndex, endIndex) {
        const definitions = triggerEventAgentSnapshot(campaign.store.progression, { currentIndex: endIndex });
        const validation = {
            expectedEventKeys: definitions.map(definition => definition.key),
            expectedEventContracts: eventContracts(definitions),
            passageStartIndex: startIndex,
            passageEndIndex: endIndex,
            playerName,
            discardImpossibleMatches: true,
        };
        const requestMessages = appendDslEvaluationKeyContract(
            prepareOutputMessages(messages, {
                format: maintenanceOutputFormat, task: 'progression',
            }),
            maintenanceOutputFormat,
            validation.expectedEventKeys,
        );
        let response = await maintenanceChat(`${label}:progression`, requestMessages, {
            category: 'progression', temperature: benchmarkSettings.progressionTemperature ?? 0.1,
            maxTokens: benchmarkSettings.progressionMaximumResponseTokens || 10_000,
            outputFormat: maintenanceOutputFormat,
        });
        let firstError = '';
        const maximumRepairs = Math.max(1, Math.min(3, Number(benchmarkSettings.incompleteRecoveryAttempts) || 2));
        for (let repairAttempt = 0; repairAttempt <= maximumRepairs; repairAttempt++) {
            try {
                const parsed = parseInnerLoreOutput(response.content, {
                    format: maintenanceOutputFormat, task: 'progression', salvageTruncated: true,
                });
                recordCodecNormalizations(label, 'progression', repairAttempt, parsed);
                return {
                    payload: validateProgressionPayload(parsed, validation),
                    repaired: repairAttempt > 0,
                    repairAttempts: repairAttempt,
                    firstError,
                };
            } catch (error) {
                recordCodecDiagnostic(label, 'progression', repairAttempt, error, response.content);
                firstError ||= error.message;
                if (repairAttempt >= maximumRepairs) throw error;
            }
            const repairMessages = buildProgressionRepairMessages(response.content, {
                ...validation,
                sourceMessages: requestMessages,
            });
            repairMessages.at(-1).content += ` The local parser or validator error was: ${firstError.slice(0, 1_000)}`;
            response = await maintenanceChat(`${label}:progression-repair-${repairAttempt + 1}`, prepareOutputMessages(repairMessages, {
                format: maintenanceOutputFormat, task: 'progression',
            }), {
                category: 'progression_repair', temperature: 0,
                maxTokens: benchmarkSettings.progressionMaximumResponseTokens || 10_000,
                outputFormat: maintenanceOutputFormat,
            });
        }
        throw new Error(`${label}: progression repair loop ended unexpectedly.`);
    }

    async function runProgression(turnNumber, startIndex, endIndex) {
        const transcript = formatTranscript(campaign.chat, {
            startIndex,
            endIndex,
            userName: playerName,
            characterName: storyName,
            maximumCharacters: 90_000,
        });
        const messages = buildProgressionMessages({
            transcript,
            progression: campaign.store.progression,
            store: campaign.store,
            currentIndex: endIndex,
            playerName,
            characterCard,
            settings: benchmarkSettings,
        });
        const response = await requestProgression(`turn-${turnNumber}`, messages, startIndex, endIndex);
        const applied = applyProgressionPatch(campaign.store.progression, response.payload, {
            messageIndex: endIndex,
            passageStartIndex: startIndex,
            passageText: transcript,
            playerName,
            autonomy: benchmarkSettings.progressionAutonomy,
            maximumGoals: benchmarkSettings.progressionMaximumGoals,
            maximumProcesses: benchmarkSettings.progressionMaximumProcesses,
            maximumEvents: benchmarkSettings.progressionMaximumEvents,
            evaluationCoverageRequired: true,
            deliveryMaximumAttempts: benchmarkSettings.triggerDeliveryMaximumAttempts || 3,
        });
        campaign.store.progression = applied.state;
        campaign.store.progression.lastProcessedIndex = endIndex;
        for (const [index, fingerprint] of Object.entries(snapshotMessageRange(campaign.chat, startIndex, endIndex))) {
            if (fingerprint) campaign.store.progression.processedFingerprints[index] = fingerprint;
        }
        return {
            repaired: response.repaired,
            repairAttempts: response.repairAttempts || 0,
            firstError: response.firstError || '',
            proposed: {
                elapsed: response.payload.time?.elapsed,
                goals: response.payload.goals.length,
                processes: response.payload.processes.length,
                events: response.payload.events.length,
                eventEvaluations: response.payload.event_evaluations.length,
            },
            applied: {
                time: applied.timeResult,
                goals: applied.goalResult,
                processes: applied.processResult,
                events: applied.eventResult,
                scheduler: applied.scheduler,
                triggerEvents: applied.triggerEventResult,
            },
        };
    }

    async function requestDirectorProposal(turnNumber, messages, directorContext) {
        const requestMessages = prepareOutputMessages(messages, {
            format: maintenanceOutputFormat, task: 'event_director',
        });
        let response = await maintenanceChat(`turn-${turnNumber}:event-director`, requestMessages, {
            category: 'event_director', temperature: 0.1, maxTokens: 4_000,
            outputFormat: maintenanceOutputFormat,
        });
        let firstError = '';
        for (let repairAttempt = 0; repairAttempt <= 1; repairAttempt++) {
            try {
                const parsed = parseInnerLoreOutput(response.content, {
                    format: maintenanceOutputFormat, task: 'event_director', salvageTruncated: true,
                });
                recordCodecNormalizations(`turn-${turnNumber}`, 'event_director', repairAttempt, parsed);
                return {
                    ...validateEventDirectorPayload(parsed, {
                        state: campaign.store.progression,
                        sources: directorContext.sources,
                        playerName,
                        minimumConfidence: benchmarkSettings.automaticEventDirectorMinimumConfidence,
                        includePrivateMinds: benchmarkSettings.automaticEventDirectorIncludePrivateMinds,
                        allowGeneratedLineage: false,
                    }),
                    repaired: repairAttempt > 0,
                    firstError,
                };
            } catch (error) {
                recordCodecDiagnostic(`turn-${turnNumber}`, 'event_director', repairAttempt, error, response.content);
                firstError ||= error.message;
                if (repairAttempt >= 1) throw error;
            }
            response = await maintenanceChat(`turn-${turnNumber}:event-director-repair`,
                prepareOutputMessages(buildEventDirectorRepairMessages(response.content, {
                    sourceMessages: requestMessages,
                    validationError: firstError,
                }), { format: maintenanceOutputFormat, task: 'event_director' }), {
                    category: 'event_director_repair', temperature: 0, maxTokens: 4_000,
                    outputFormat: maintenanceOutputFormat,
                });
        }
        throw new Error('Event Director repair loop ended unexpectedly.');
    }

    async function runEventDirector(turnNumber) {
        const currentMessageIndex = campaign.chat.length - 1;
        let mutated = false;
        let expiration = expireEventProposals(campaign.store.progression, {
            branchId: 'main', currentMessageIndex,
        });
        campaign.store.progression = expiration.state;
        for (const item of expiration.expired) {
            const definition = campaign.store.progression.eventDefinitions?.[item.definitionId];
            if (!item.definitionId || definition?.origin !== 'automatic_director') continue;
            campaign.store.progression = removeTriggerEventDefinition(
                campaign.store.progression, item.definitionId,
            ).state;
        }
        mutated ||= expiration.expired.length > 0;

        const decision = decideAutomaticEventGeneration(
            campaign.store.progression,
            benchmarkSettings,
            currentMessageIndex,
        );
        if (!decision.due) return {
            enabled: benchmarkSettings.automaticEventDirectorEnabled,
            attempted: false,
            generated: false,
            reason: decision.reason,
            expired: expiration.expired,
            mutated,
        };

        const sourceRevision = campaign.storageRevision;
        const latest = campaign.chat.at(-1);
        const sourceHead = messageFingerprint(latest);
        try {
            const directorContext = await campaign.fixture.storage.innerLoreEventDirector.context({
                expectedRevision: sourceRevision,
                branchId: 'main',
                headFingerprint: sourceHead,
                includePrivateMinds: benchmarkSettings.automaticEventDirectorIncludePrivateMinds,
            });
            const messages = buildEventDirectorMessages({
                context: directorContext,
                playerName,
                activity: benchmarkSettings.automaticEventDirectorActivity,
                includePrivateMinds: benchmarkSettings.automaticEventDirectorIncludePrivateMinds,
                minimumConfidence: benchmarkSettings.automaticEventDirectorMinimumConfidence,
            });
            const response = await requestDirectorProposal(turnNumber, messages, directorContext);
            if (campaign.storageRevision !== sourceRevision
                || messageFingerprint(campaign.chat.at(-1)) !== sourceHead) {
                return {
                    enabled: true, attempted: true, generated: false,
                    reason: 'state_changed_during_generation', discarded: true, mutated,
                };
            }
            campaign.store.progression = recordEventDirectorAttempt(campaign.store.progression, {
                currentMessageIndex,
                outcome: response.proposal ? 'proposed' : 'no_proposal',
                reason: response.reason,
                repaired: response.repaired,
            });
            mutated = true;
            if (!response.proposal) return {
                enabled: true, attempted: true, generated: false,
                reason: response.reason, repaired: response.repaired,
                firstError: response.firstError, sourceCount: directorContext.sources.length,
                expired: expiration.expired, mutated,
            };

            const added = addEventProposal(campaign.store.progression, response.proposal, {
                sourceStoreRevision: sourceRevision,
                branchId: 'main',
                headFingerprint: sourceHead,
                currentMessageIndex,
                expirationTurns: benchmarkSettings.automaticEventDirectorExpirationTurns,
                profileId: spec.profileName,
            });
            campaign.store.progression = added.state;
            let definition = null;
            if (benchmarkSettings.automaticEventDirectorMode === 'auto_arm') {
                const armed = upsertTriggerEventDefinition(
                    campaign.store.progression,
                    eventDefinitionFromProposal(added.proposal),
                    {
                        clock: campaign.store.progression.clock,
                        messageIndex: currentMessageIndex,
                        playerName,
                    },
                );
                campaign.store.progression = armed.state;
                definition = armed.definition;
                campaign.store.progression = markEventProposalArmed(
                    campaign.store.progression, added.proposal.id, definition.id,
                ).state;
            }
            return {
                enabled: true,
                attempted: true,
                generated: true,
                reason: response.reason,
                repaired: response.repaired,
                firstError: response.firstError,
                sourceCount: directorContext.sources.length,
                proposalId: added.proposal.id,
                key: added.proposal.key,
                title: added.proposal.title,
                confidence: added.proposal.confidence,
                sourceRefs: added.proposal.sourceRefs,
                definitionId: definition?.id || null,
                expired: expiration.expired,
                mutated: true,
            };
        } catch (error) {
            campaign.store.progression = recordEventDirectorAttempt(campaign.store.progression, {
                currentMessageIndex,
                outcome: 'error',
                error: error.message || String(error),
                reason: decision.reason,
            });
            return {
                enabled: true, attempted: true, generated: false,
                reason: decision.reason, error: error.message || String(error),
                expired: expiration.expired, mutated: true,
            };
        }
    }

    function checkpointData() {
        const lorebookName = campaign.store.lorebookName || '';
        return {
            schema: 1,
            runId,
            targetTurns,
            model: spec.model,
            profile: spec.profileName,
            providerApi: spec.providerApi,
            endpointMode: spec.endpointMode,
            providerSegments: currentProviderSegments(),
            assistantTurns: campaign.assistantTurns,
            nextProgressionStart: campaign.nextProgressionStart,
            store: campaign.store,
            chat: campaign.chat,
            timeline: campaign.timeline,
            calls: campaign.calls,
            codecDiagnostics: campaign.codecDiagnostics,
            recoveries: campaign.recoveries,
            failures: campaign.failures,
            lorebook: lorebookName ? { name: lorebookName, data: books.get(lorebookName) || null } : null,
            updatedAt: new Date().toISOString(),
        };
    }

    const startedCampaign = performance.now();
    let turnRollback = null;
    try {
        if (campaign.assistantTurns > 0) {
            await projectBranch(currentScene());
            // A resumed full-state projection can exceed the normal
            // foreground batch size; drain it completely before auditing.
            await campaign.fixture.storage.flushGraph({ limit: 1_000_000 });
        }
        for (const turn of turns.slice(campaign.assistantTurns, targetTurns)) {
            const replayTurn = replayTranscript?.[turn.number - 1] || null;
            const lorebookName = campaign.store.lorebookName || '';
            turnRollback = {
                store: structuredClone(campaign.store),
                chat: structuredClone(campaign.chat),
                timeline: structuredClone(campaign.timeline),
                nextProgressionStart: campaign.nextProgressionStart,
                assistantTurns: campaign.assistantTurns,
                storageRevision: campaign.storageRevision,
                recoveryLength: campaign.recoveries.length,
                lorebook: lorebookName
                    ? { name: lorebookName, data: structuredClone(books.get(lorebookName) || null) }
                    : null,
            };
            const turnStarted = performance.now();
            const userIndex = campaign.chat.length;
            campaign.chat.push({
                is_user: true,
                is_system: false,
                name: playerName,
                mes: clean(replayTurn?.prompt) || turn.user,
            });
            const contextPacket = await prepareContext();
            const delivery = compileTriggerEventDeliveryPreview(campaign.store.progression, campaign.chat, {
                currentIndex: userIndex,
                playerName,
                maximumAttemptPreviews: benchmarkSettings.triggerAttemptPreviewMaximum || 8,
            });
            const storyStarted = performance.now();
            const story = replayTurn
                ? clean(replayTurn.output)
                : await narrate(turn.number, userIndex, contextPacket.narrator.rendered, delivery.text);
            if (!story) throw new Error(`turn ${turn.number}: replay source contained an empty story output.`);
            const storyMs = performance.now() - storyStarted;
            campaign.chat.push({ is_user: false, is_system: false, name: storyName, mes: story });
            campaign.store.progression = markTriggerEventDeliveriesInjected(
                campaign.store.progression,
                delivery.deliveries,
                {
                    messageIndex: campaign.chat.length - 1,
                    generationId: `${runId}:${spec.key}:turn:${turn.number}`,
                    prompt: delivery.text,
                },
            ).state;
            const localDeliveryVerification = verifyTriggerEventDeliveriesFromStory(
                campaign.store.progression,
                story,
                { messageIndex: campaign.chat.length - 1 },
            );
            campaign.store.progression = localDeliveryVerification.state;

            const scheduling = decideInnerLoreMaintenance({
                messages: campaign.chat,
                store: campaign.store,
                settings: benchmarkSettings,
                targetIndex: campaign.chat.length - 1,
            });
            const finalFlush = turn.number === targetTurns;
            const runCuratorNow = scheduling.curatorDue || finalFlush;
            const runProgressionNow = scheduling.progressionDue || finalFlush;
            let curator = null;
            if (runCuratorNow && campaign.store.lastProcessedIndex < campaign.chat.length - 1) {
                curator = await runCurator(
                    turn.number,
                    campaign.store.lastProcessedIndex + 1,
                    campaign.chat.length - 1,
                );
            }
            let progressionPass = null;
            if (runProgressionNow
                && campaign.store.progression.lastProcessedIndex < campaign.chat.length - 1) {
                progressionPass = await runProgression(
                    turn.number,
                    campaign.store.progression.lastProcessedIndex + 1,
                    campaign.chat.length - 1,
                );
                campaign.nextProgressionStart = campaign.chat.length;
            }
            const sync = await syncLorebook(campaign.store, {
                chatId: campaign.store.chatId,
                characterName: storyName,
                removeMissing: true,
            });
            await projectBranch(currentScene());
            await campaign.fixture.storage.flushGraph();
            const eventDirector = await runEventDirector(turn.number);
            if (eventDirector.mutated) {
                await projectBranch(currentScene());
                await campaign.fixture.storage.flushGraph();
            }
            campaign.assistantTurns++;
            campaign.timeline.push(campaignSnapshot(
                campaign, turn.number, contextPacket, sync, curator, progressionPass, delivery, eventDirector,
            ));
            campaign.timeline.at(-1).maintenance = {
                ...scheduling,
                runCurator: Boolean(curator),
                runProgression: Boolean(progressionPass),
                finalFlush,
                locallyVerifiedDeliveries: localDeliveryVerification.confirmed.map(item => item.definitionId),
            };
            writeJsonAtomic(checkpointFile, checkpointData());
            turnRollback = null;
            const totalMs = performance.now() - turnStarted;
            process.stderr.write(`[${spec.key}] turn ${turn.number}/${targetTurns}: story ${(storyMs / 1_000).toFixed(1)}s, total ${(totalMs / 1_000).toFixed(1)}s, state ${contextPacket.narrator.rendered.length} chars\n`);
        }

        await campaign.fixture.storage.flushGraph({ limit: 1_000_000 });
        const storageStats = await campaign.fixture.storage.stats();
        const health = campaign.fixture.storage.health();
        const deterministic = buildDeterministicAudit(campaign, storageStats, health);
        const judge = skipJudge
            ? { parsed: false, skipped: true, reason: 'Skipped for maintenance output-codec comparison.', calls: [] }
            : reaudit && !rejudge && priorCompletedResult?.judge
            ? { ...structuredClone(priorCompletedResult.judge), reusedForDeterministicReaudit: true }
            : await requestQualityJudge(campaign, deterministic);
        campaign.calls.push(...(judge.calls || []));
        deterministic.performance = summarizeCalls(campaign.calls);
        const transcript = [];
        for (let index = 1, number = 1; index < campaign.chat.length; index += 2, number++) {
            transcript.push({
                turn: number,
                prompt: campaign.chat[index]?.mes || '',
                output: campaign.chat[index + 1]?.mes || '',
            });
        }
        const result = {
            schema: 'innerlore.squire-live-benchmark.v2',
            generatedAt: new Date().toISOString(),
            runId,
            configuration: {
                profile: spec.profileName,
                model: spec.model,
                modelLabel: spec.label,
                providerApi: spec.providerApi,
                endpointMode: spec.endpointMode,
                providerSegments: currentProviderSegments(),
                preset: spec.profile.preset,
                reasoningEffort: spec.reasoningEffort,
                maintenanceProfile: maintenanceProfile.profileName,
                maintenanceModel: maintenanceProfile.model,
                maintenanceProviderApi: maintenanceProfile.providerApi,
                maintenanceEndpointMode: maintenanceProfile.endpointMode,
                maintenanceReasoningEffort: maintenanceProfile.reasoningEffort,
                maintenanceOutputFormat,
                requestedTurns: targetTurns,
                curatorEveryAssistantTurns: benchmarkSettings.processEveryAssistantTurns,
                progressionEveryAssistantTurns: benchmarkSettings.progressionEveryAssistantTurns,
                adaptiveMaintenanceEnabled: benchmarkSettings.adaptiveMaintenanceEnabled,
                minimumAdaptiveBatchTurns: benchmarkSettings.minimumAdaptiveBatchTurns,
                recentStoryHistoryMessages: 12,
                contextProfile: 'balanced',
                eventDirector: {
                    enabled: benchmarkSettings.automaticEventDirectorEnabled,
                    mode: eventDirectorMode,
                    activity: eventDirectorActivity,
                    minimumConfidence: eventDirectorMinimumConfidence,
                    includePrivateMinds: eventDirectorIncludePrivateMinds,
                    expirationTurns: eventDirectorExpirationTurns,
                },
                sqliteAuthoritative: true,
                graphRequested: 'auto (Ladybug when available)',
                replay: replayResultPath ? {
                    enabled: true,
                    source: replayResultPath,
                    sourceRunId: replayResult?.runId || '',
                } : { enabled: false },
            },
            scenario: {
                cardName: card.name,
                playerName,
                cardDescription: card.description,
                cardScenario: replaceMacros(card.scenario),
                initialGreeting,
                locations: locationSpecs,
                triggerEvents: eventDefinitions,
            },
            transcript,
            deterministic,
            judge,
            finalState: compactFinalState(campaign.store),
            timeline: campaign.timeline,
            database: { stats: storageStats, health },
            calls: campaign.calls,
            codecDiagnostics: campaign.codecDiagnostics,
            failures: campaign.failures,
            wallClockMs: Number((performance.now() - startedCampaign).toFixed(1)),
        };
        writeJsonAtomic(resultFile, result);
        writeJsonAtomic(checkpointFile, checkpointData());
        process.stderr.write(`[${spec.key}] completed ${transcript.length} turns; result ${resultFile}\n`);
        return result;
    } catch (error) {
        if (turnRollback) {
            const discardedLorebookName = campaign.store.lorebookName || '';
            campaign.store = turnRollback.store;
            campaign.chat = turnRollback.chat;
            campaign.timeline = turnRollback.timeline;
            campaign.nextProgressionStart = turnRollback.nextProgressionStart;
            campaign.assistantTurns = turnRollback.assistantTurns;
            campaign.storageRevision = turnRollback.storageRevision;
            for (let index = turnRollback.recoveryLength; index < campaign.recoveries.length; index++) {
                campaign.recoveries[index].discardedByTurnRollback = true;
            }
            if (discardedLorebookName && discardedLorebookName !== turnRollback.lorebook?.name) {
                books.delete(discardedLorebookName);
            }
            if (turnRollback.lorebook?.name) {
                if (turnRollback.lorebook.data) {
                    books.set(turnRollback.lorebook.name, structuredClone(turnRollback.lorebook.data));
                } else {
                    books.delete(turnRollback.lorebook.name);
                }
            }
        }
        campaign.failures.push({
            afterCompletedTurn: campaign.assistantTurns,
            nextTurn: campaign.assistantTurns + 1,
            errorName: clean(error?.name || 'Error'),
            error: clean(error?.message || String(error)).slice(0, 500),
            recordedAt: new Date().toISOString(),
        });
        writeJsonAtomic(checkpointFile, checkpointData());
        throw error;
    } finally {
        await campaign.fixture.cleanup();
    }
}

let results;
try {
    results = await Promise.all(profiles.map(async spec => {
        try {
            return { ok: true, result: await runCampaign(spec) };
        } catch (error) {
            process.stderr.write(`[${spec.key}] FAILED: ${error.stack || error.message}\n`);
            return { ok: false, key: spec.key, error: error.stack || error.message };
        }
    }));
    const completedResults = allModelSpecs.flatMap(spec => {
        const file = path.join(resultRoot, `${spec.key}.result.json`);
        if (!fs.existsSync(file)) return [];
        const result = JSON.parse(fs.readFileSync(file, 'utf8'));
        if ((result.transcript || []).length !== targetTurns) return [];
        return [{ spec, result }];
    });
    const incompleteRuns = allModelSpecs.flatMap(spec => {
        if (completedResults.some(item => item.spec.key === spec.key)) return [];
        const file = path.join(resultRoot, `${spec.key}.checkpoint.json`);
        if (!fs.existsSync(file)) return [];
        const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
        const turns = Math.max(0, Number(checkpoint.assistantTurns) || 0);
        if (turns >= targetTurns) return [];
        const failures = Array.isArray(checkpoint.failures) ? checkpoint.failures : [];
        return [{
            ok: false,
            key: spec.key,
            modelLabel: spec.label,
            status: 'resumable_checkpoint',
            turns,
            nextTurn: turns + 1,
            checkpoint: `${spec.key}.checkpoint.json`,
            failures: failures.length,
            lastFailure: failures.at(-1) || null,
        }];
    });
    const failureByKey = new Map(results.filter(item => !item.ok).map(item => [item.key, item]));
    for (const item of incompleteRuns) {
        if (!failureByKey.has(item.key)) failureByKey.set(item.key, item);
    }
    writeJsonAtomic(path.join(resultRoot, 'run-summary.json'), {
        generatedAt: new Date().toISOString(),
        runId,
        targetTurns,
        results: completedResults.map(item => ({
            ok: true,
            key: item.result.configuration.modelLabel,
            turns: item.result.transcript.length,
            file: `${item.spec.key}.result.json`,
            overallScore: item.result.judge?.result?.overall_score ?? null,
        })),
        incomplete: incompleteRuns,
        failures: [...failureByKey.values()],
    });
} finally {
    if (priorSillyTavern === undefined) delete globalThis.SillyTavern;
    else globalThis.SillyTavern = priorSillyTavern;
}

if (results.some(item => !item.ok)) process.exitCode = 1;
else process.stdout.write(`${JSON.stringify({
    ok: true,
    resultRoot,
    runs: results.map(item => ({
        model: item.result.configuration.model,
        turns: item.result.transcript.length,
        judgeScore: item.result.judge?.result?.overall_score ?? null,
    })),
}, null, 2)}\n`);
