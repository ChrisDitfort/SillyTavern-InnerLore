import assert from 'node:assert/strict';
import test from 'node:test';

import {
    TONE_NAMES,
    toneText,
    castVoices,
    cleanForSpeech,
    normalizeTone,
    stripVoiceTags,
    dropDialogueTags,
    settledSegmentCount,
    inferAge,
    isChild,
    statedAge,
    inferGender,
    prosodyFor,
    segmentSpeech,
    voiceForSegment,
} from '../speech.js';

const CAST = [
    { name: 'Mara Quell', description: 'The innkeeper, a broad woman with grey in her hair; she keeps the Salt Lantern.' },
    { name: 'Pip', description: 'A stable boy of twelve, all elbows.' },
    { name: 'Old Tam', summary: 'An elderly fisherman, bent and grizzled, who mends nets on the quay.' },
];
const VOICES = [
    { id: 's0', gender: 'female', pitch: 186 }, { id: 's1', gender: 'female', pitch: 181 }, { id: 's2', gender: 'female', pitch: 165 },
    { id: 's5', gender: 'male', pitch: 132 }, { id: 's6', gender: 'male', pitch: 85 }, { id: 's7', gender: 'male', pitch: 98 },
];

test('cleaning strips markup, links and stage asides', () => {
    assert.equal(cleanForSpeech('**Mara** *leans in*. <em>Quiet</em>. [the map](http://x.y/z) (OOC: skip this) https://a.b/c ```code```'), 'Mara leans in. Quiet. the map');
    assert.equal(cleanForSpeech('# Heading\n\n- one\n- two'), 'Heading\n\none\ntwo');
});

test('quotes become speech attributed by speech verbs, lead-ins, pronouns and the only person near', () => {
    const text = `Mara wiped the counter and leaned closer. "The lantern's yours for three shillings," she said, "but I would not light it near the powder store."

"Three?" Pip asked from the doorway. "Last week it was two."

Old Tam snorted. "Last week it had a cracked pane."

"I'll take it," Jet said, counting out the coins.

Someone in the back room laughed. "Robbery, that is."`;
    const segments = segmentSpeech(text, { cast: CAST, playerName: 'Jet' });
    const speech = segments.filter(segment => segment.kind === 'speech');
    assert.deepEqual(speech.map(segment => segment.speaker), ['Mara Quell', 'Mara Quell', 'Pip', 'Pip', 'Old Tam', 'Jet', '']);
    assert.equal(speech[5].player, true, 'the player\'s own line is marked');
    assert.equal(speech[2].tone, 'question');
    assert.equal(segments[0].kind, 'narration');
    assert.match(segments[0].text, /Mara wiped the counter/u);
    assert.ok(!segments.some(segment => segment.kind === 'narration' && /^she said\.?$/u.test(segment.text)), 'a bare dialogue tag between attributed lines is not read');
    const kept = segmentSpeech(text, { cast: CAST, playerName: 'Jet', keepTags: true });
    assert.ok(kept.some(segment => segment.kind === 'narration' && /she said/u.test(segment.text)), 'unless tags are kept');
    assert.ok(segments.some(segment => segment.kind === 'narration' && /Pip asked from the doorway/u.test(segment.text)), 'a tag with action in it stays');
    assert.ok(segments.every(segment => segment.text.length <= 420));
    assert.ok(segments.every((segment, index) => index === 0 || segment.end >= segments[index - 1].end), 'ends never go backwards');
    const clean = cleanForSpeech(text);
    assert.equal(segments.at(-1).end, clean.length, 'the last segment ends with the text');
    const settled = settledSegmentCount(segments, clean.length, 60);
    assert.ok(settled < segments.length && settled >= segments.length - 3, `while streaming, the last segments wait for more text (${settled} of ${segments.length})`);
    assert.equal(settledSegmentCount(segments, Number.POSITIVE_INFINITY), segments.length);
    assert.equal(settledSegmentCount(segments, 10), 0);
    assert.deepEqual(dropDialogueTags([{ kind: 'speech', speaker: 'Mara', text: 'No.' }, { kind: 'narration', text: 'Mara said.' }, { kind: 'narration', text: 'The rain kept on.' }]).map(segment => segment.text), ['No.', 'The rain kept on.']);
});

test('curly quotes, whispers and shouts, and long narration split into sentences', () => {
    const text = `“Keep your voice down,” Mara whispered. “The Watch is upstairs.”\n\nPip shouted after her: “THEY KNOW!”\n\nThe quay was long and the evening longer. Gulls wheeled. The tide came in over the stones, slow and grey, and the lamps along the harbour wall were lit one by one by a boy with a taper who did not look up.`;
    const segments = segmentSpeech(text, { cast: CAST, playerName: 'Jet' });
    const speech = segments.filter(segment => segment.kind === 'speech');
    assert.equal(speech[0].speaker, 'Mara Quell');
    assert.equal(speech[0].tone, 'quiet');
    assert.equal(speech[2].speaker, 'Pip');
    assert.equal(speech[2].tone, 'loud');
    const narration = segments.filter(segment => segment.kind === 'narration');
    assert.ok(narration.length >= 1 && narration.every(segment => segment.text.length <= 240), `narration reads in runs of a few sentences (${narration.length})`);
    assert.ok(narration.some(segment => /Gulls wheeled\. The tide/u.test(segment.text)), 'short sentences join into one run');
});

test('gender and age are read from descriptions; voices are cast without clashes', () => {
    assert.equal(inferGender('a broad woman with grey in her hair; she keeps the inn'), 'female');
    assert.equal(inferGender('the harbour master, a tall man; his coat'), 'male');
    assert.equal(inferGender('the stranger at the door'), '');
    assert.equal(inferAge('an elderly fisherman, grizzled'), 'old');
    assert.equal(inferAge('a stable boy of twelve'), 'young');
    const assignment = castVoices({ people: CAST, voices: VOICES, narratorVoice: 's2' });
    assert.equal(VOICES.find(voice => voice.id === assignment.get('mara quell')).gender, 'female');
    assert.notEqual(assignment.get('mara quell'), 's2', 'the narrator keeps its voice');
    assert.equal(assignment.get('old tam'), 's6', 'the oldest gets the deepest voice');
    assert.equal(assignment.get('pip'), 's5', 'the boy gets the highest free male voice');
    const again = castVoices({ people: [...CAST].reverse(), voices: VOICES, narratorVoice: 's2' });
    assert.deepEqual([...again.entries()].sort(), [...assignment.entries()].sort(), 'stable regardless of order');
    const chosen = castVoices({ people: CAST, voices: VOICES, narratorVoice: 's2', chosen: { pip: 's5' } });
    assert.equal(chosen.get('pip'), 's5', 'a chosen voice wins');
    const noisy = castVoices({ people: [{ name: 'Mara Quell', description: 'a woman' }], voices: [{ id: 'h', gender: 'female', pitch: 180, noisy: true }, { id: 'c', gender: 'female', pitch: 170 }], narratorVoice: 'x' });
    assert.equal(noisy.get('mara quell'), 'c', 'a noisy voice is passed over while a clean one is free');
});

test('italics are thoughts: the player\'s in their voice, others as quiet asides; narration reads in runs', () => {
    const text = `Mara set the lantern down. *I should not have come back here,* Jet thought. The rain ran off the eaves. It pooled by the step. The door stayed shut.\n\n*The old woman knows more than she says.* "Three shillings," Mara said. It was a *very* fair price.`;
    const segments = segmentSpeech(text, { cast: CAST, playerName: 'Jet' });
    const thoughts = segments.filter(segment => segment.kind === 'thought');
    assert.equal(thoughts.length, 2);
    assert.equal(thoughts[0].player, true);
    assert.equal(thoughts[0].text, 'I should not have come back here,');
    assert.equal(thoughts[1].player, false);
    assert.equal(thoughts[0].tone, 'quiet');
    assert.ok(segments.some(segment => segment.kind === 'narration' && /The rain ran off the eaves\. It pooled by the step\. The door stayed shut\./u.test(segment.text)), 'short narration sentences read as one run');
    assert.ok(segments.some(segment => /It was a very fair price/u.test(segment.text)), 'one-word emphasis stays inline');
    assert.equal(voiceForSegment(thoughts[0], { narratorVoice: 's2', playerVoice: 's5', thoughtVoice: 's1' }), 's5');
    assert.equal(voiceForSegment(thoughts[1], { narratorVoice: 's2', playerVoice: 's5', thoughtVoice: 's1' }), 's1');
    assert.equal(prosodyFor(thoughts[1]).speed, 0.83);
    assert.equal(prosodyFor(thoughts[1]).gain, 0.68);
});

test('voice tags name the speaker, the thinker and the tone; they never reach the audio text', () => {
    const text = `[[narrator|tense]] The door banged. [[Mara|wary]] "Who's there?" [[Pip|afraid]] *They've found us,* Pip thought, pressing into the wall. [[Mara|firm]] "Show yourself." [[Jet|amused]] "Only me."\n\n[[Tam|sad]] *She never did come home.*`;
    const segments = segmentSpeech(text, { cast: CAST, playerName: 'Jet' });
    assert.ok(segments.every(segment => !/\[\[/u.test(segment.text)), 'tags are stripped');
    const first = segments[0];
    assert.equal(first.kind, 'narration');
    assert.equal(first.tone, 'tense');
    const speech = segments.filter(segment => segment.kind === 'speech');
    assert.deepEqual(speech.map(segment => [segment.speaker, segment.tone]), [['Mara Quell', 'wary'], ['Mara Quell', 'firm'], ['Jet', 'amused']]);
    assert.equal(speech[2].player, true);
    const thoughts = segments.filter(segment => segment.kind === 'thought');
    assert.deepEqual(thoughts.map(segment => [segment.speaker, segment.tone]), [['Pip', 'afraid'], ['Old Tam', 'sad']]);
    assert.equal(normalizeTone('Furious'), 'angry');
    assert.equal(normalizeTone('whispering'), 'whisper');
    assert.equal(normalizeTone('nonsense-xyz'), '');
    assert.ok(TONE_NAMES.includes('wary') && !TONE_NAMES.includes('plain'));
    assert.equal(stripVoiceTags('[[Mara|wary]] "Who?" [[Pip]] *Run.*'), '"Who?" *Run.*');
    const untagged = segmentSpeech('Mara frowned. *He is lying to me,* she decided.', { cast: CAST, playerName: 'Jet' });
    assert.equal(untagged.find(segment => segment.kind === 'thought').speaker, 'Mara Quell', 'without a tag, a thought goes to the person the paragraph points at');
    assert.deepEqual(prosodyFor({ kind: 'speech', tone: 'whisper', text: 'Hush.' }), { speed: 0.9, gain: 0.5, pause: 0.26 });
    assert.equal(prosodyFor({ kind: 'speech', tone: 'shout', text: 'Run!' }).gain, 1.4);
    assert.equal(prosodyFor({ kind: 'narration', tone: 'neutral', text: 'The tide went out…' }).pause, 0.32);
});

test('a third-person thought about the player belongs to the other person, in their own voice', () => {
    const cast = [{ name: 'Lyra', description: 'A silver-haired woman and seeker of patterns; she lives alone.' }, { name: 'Chris', description: 'a 21 year old male' }];
    const text = `Lyra studies you for a long moment. *He offers a menu of capabilities. Most would brag; he merely asks for a direction.* "Your eagerness is... inefficient," she says.\n\nChris shrugs. *A bold assumption of permanence.*\n\n*I should keep my mouth shut,* you think.`;
    const segments = segmentSpeech(text, { cast, playerName: 'Chris' });
    const thoughts = segments.filter(segment => segment.kind === 'thought');
    assert.deepEqual(thoughts.map(segment => [segment.speaker, segment.player]), [['Lyra', false], ['Lyra', false], ['Lyra', false], ['Chris', true]]);
    const assignment = new Map([['lyra', 'b04']]);
    assert.equal(voiceForSegment(thoughts[0], { narratorVoice: 's2', playerVoice: 's5', assignment }), 'b04', 'her thought is read in her voice');
    assert.equal(voiceForSegment(thoughts[3], { narratorVoice: 's2', playerVoice: 's5', assignment }), 's5');
});

test('punctuation carries the tone the voice model can render', () => {
    assert.equal(toneText('Get out of my house.', 'shout'), 'Get out of my house!');
    assert.equal(toneText('Get out of my house!', 'shout'), 'Get out of my house!');
    assert.equal(toneText('"Get out."', 'angry'), '"Get out!"');
    assert.equal(toneText('I do not know, maybe tomorrow.', 'hesitant'), 'I do not know… maybe tomorrow.');
    assert.equal(toneText('I suppose so.', 'afraid'), 'I suppose so…');
    assert.equal(toneText('Is it far?', 'afraid'), 'Is it far?');
    assert.equal(toneText('Come closer', 'lust'), 'Come closer.');
    assert.equal(toneText('Fine.', 'neutral'), 'Fine.');
});

test('voice and speed per segment', () => {
    const assignment = new Map([['mara quell', 's1']]);
    const options = { narratorVoice: 's2', playerVoice: 's5', unknownVoice: 's0', assignment };
    assert.equal(voiceForSegment({ kind: 'narration' }, options), 's2');
    assert.equal(voiceForSegment({ kind: 'speech', speaker: 'Mara Quell' }, options), 's1');
    assert.equal(voiceForSegment({ kind: 'speech', speaker: 'Nobody' }, options), 's0');
    assert.equal(voiceForSegment({ kind: 'speech', player: true }, options), 's5');
    assert.equal(prosodyFor({ kind: 'speech', tone: 'quiet' }).speed, 0.92);
    assert.equal(prosodyFor({ kind: 'speech', tone: 'excited' }, 1.1).speed, 1.23);
    assert.equal(prosodyFor({ kind: 'narration', tone: 'plain' }).speed, 0.98);
});

test('a tagged tone carries over a dialogue-tag interruption to the same speaker\'s continuation', () => {
    const text = `[[Lyra|firm]] "An open-ended lease is a steep price," [[narrator|neutral]] Lyra says, her voice carrying a new gravity. "But I value results over coins. The room is yours." [[narrator|neutral]] She slides the book closer. "The terms are struck. Now, show me the bridge."\n\n[[Lyra|warm]] "Thank you," she says. [[Pip|afraid]] "They're coming." "We should go," Lyra adds.`;
    const cast = [{ name: 'Lyra', description: 'a silver-haired woman' }, { name: 'Pip', description: 'A stable boy of twelve.' }];
    const speech = segmentSpeech(text, { cast, playerName: 'Chris' }).filter(segment => segment.kind === 'speech');
    assert.deepEqual(speech.map(segment => [segment.speaker, segment.tone]), [
        ['Lyra', 'firm'], ['Lyra', 'firm'], ['Lyra', 'firm'],
        ['Lyra', 'warm'], ['Pip', 'afraid'], ['Lyra', 'plain'],
    ], 'the tone carries over the interruption, not past another speaker\'s tagged line');
    assert.equal(normalizeTone('analytical'), 'cold');
    const steady = castVoices({ people: [{ name: 'Lyra', description: 'a woman' }], voices: [{ id: 'w', gender: 'female', pitch: 186, unstable: true }, { id: 'k', gender: 'female', pitch: 180 }], narratorVoice: 'x' });
    assert.equal(steady.get('lyra'), 'k', 'a voice whose pitch wanders between clips is passed over while a steady one is free');
    assert.equal(normalizeTone('Determined'), 'firm');
});

test('a stated age decides over figurative age words; a quote after "Name says, …" is theirs even when another name was quoted', () => {
    assert.equal(inferAge('She is a slight girl of twelve years with a porcelain complexion, her eyes reflecting the ancient, predatory hunger of the Night Courts.'), 'young');
    assert.equal(inferAge('A 34-year-old sailor, weathered.'), '');
    assert.equal(inferAge('An elderly fisherman, bent and grizzled.'), 'old');
    assert.equal(inferAge('The little girl'), 'young');
    assert.equal(statedAge('a boy of twelve'), 12);
    assert.ok(isChild({ name: 'Amy', description: 'a slight girl of twelve years; ancient hunger' }));
    assert.ok(!isChild({ name: 'Old Tam', summary: 'An elderly fisherman' }));
    const cast = [{ name: 'Lyra', description: 'a silver-haired woman' }, { name: 'Amy', description: 'a slight girl of twelve years' }];
    const text = `[[Lyra|cold]] "Amy. A simple name for a complex bloodline," [[narrator|neutral]] Lyra says, her tone clipping the end of the sentence with a sharp, corrective precision. "Now that the introductions are handled, tell me—do you intend to actually use this room?"`;
    const speech = segmentSpeech(text, { cast, playerName: 'Chris' }).filter(segment => segment.kind === 'speech');
    assert.deepEqual(speech.map(segment => [segment.speaker, segment.tone]), [['Lyra', 'cold'], ['Lyra', 'cold']]);
    const untagged = `"Amy. A simple name," Lyra says, her tone clipping the end of the sentence. "Now, do you intend to use this room?"`;
    assert.deepEqual(segmentSpeech(untagged, { cast, playerName: 'Chris' }).filter(segment => segment.kind === 'speech').map(segment => segment.speaker), ['Lyra', 'Lyra']);
    const fallback = `[[Amy|firm]] "My name is Amy," she says, bowing. The candle gutters and the room goes still. "I serve."`;
    assert.deepEqual(segmentSpeech(fallback, { cast, playerName: 'Chris' }).filter(segment => segment.kind === 'speech').map(segment => segment.speaker), ['Amy', 'Amy'], 'an untagged quote in a tagged paragraph goes to the last tagged speaker');
});

test('the subject of the sentence before a quote speaks it, not the person looked at; the unknown voice is nobody\'s', () => {
    const cast = [{ name: 'Lyra', description: 'a silver-haired woman' }, { name: 'Amy', description: 'a slight girl of twelve years' }];
    const text = `"The terms are simple," Lyra says, her voice a melodic chime. "You have a roof and a bed." She tilts her head, her silver hair shimmering as she casts one final, appraising look at Amy. "The arrangement is acceptable. Just ensure your protection does not involve my rugs."\n\nShe steps back into the corridor, the indigo wool of her tunic snapping with the movement. "The door locks from the inside."\n\nAmy bows. "As you command."`;
    const speech = segmentSpeech(text, { cast, playerName: 'Chris' }).filter(segment => segment.kind === 'speech');
    assert.deepEqual(speech.map(segment => segment.speaker), ['Lyra', 'Lyra', 'Lyra', 'Lyra', 'Lyra', 'Amy']);
    const voices = [{ id: 'u', gender: 'female', pitch: 193 }, { id: 'k', gender: 'female', pitch: 180 }];
    const cast2 = castVoices({ people: [{ name: 'Amy', description: 'a girl of twelve' }], voices, narratorVoice: 'n', reserved: ['u'] });
    assert.equal(cast2.get('amy'), 'k', 'the unknown-speaker voice is never given to a cast member, even the brightest for a child');
    const pinned = castVoices({ people: [{ name: 'Amy', description: 'a girl of twelve' }], voices, narratorVoice: 'n', reserved: ['u'], chosen: { amy: 'u' } });
    assert.equal(pinned.get('amy'), 'k', 'a remembered pick equal to a reserved voice is ignored');
});
