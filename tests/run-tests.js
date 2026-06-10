// Lightweight test runner — no framework needed.
// Covers the pure logic: extractive summarizer, WAV writing, markdown rendering.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { failed++; console.error(`  ✗ ${name}\n    ${err.message}`); }
}

/* ---- load the browser-style summarizer with a window shim ---- */
global.window = {};
require('../src/renderer/js/summarizer.js');
const Summarizer = global.window.Summarizer;

console.log('\nsummarizer.js');

test('splits sentences and ignores fragments', () => {
  const s = Summarizer.splitSentences('Photosynthesis converts light into energy. Yes. The chloroplast is where this happens!');
  assert.strictEqual(s.length, 2);
});

test('extracts the content-bearing sentences', () => {
  const transcript =
    'Okay so um welcome everyone. Today we will study mitochondria and cellular respiration in depth. ' +
    'The mitochondria produces ATP through oxidative phosphorylation. Right okay so yeah. ' +
    'ATP synthase uses a proton gradient across the inner membrane to generate ATP. ' +
    'Anyway it is what it is. The electron transport chain pumps protons to build that gradient.';
  const kps = Summarizer.extractKeyPoints(transcript, 3);
  assert.strictEqual(kps.length, 3);
  const joined = kps.join(' ');
  assert.ok(/mitochondria|ATP|proton/i.test(joined), 'expected technical sentences to win');
  assert.ok(!joined.includes('Anyway it is what it is'), 'filler should lose');
});

test('key points come back in transcript order', () => {
  const transcript =
    'Thermodynamics governs energy transfer between systems and surroundings constantly. ' +
    'Entropy measures the disorder of a closed thermodynamic system precisely. ' +
    'Enthalpy tracks total heat content during chemical reactions accurately.';
  const kps = Summarizer.extractKeyPoints(transcript, 3);
  assert.ok(kps[0].startsWith('Thermodynamics'));
  assert.ok(kps[2].startsWith('Enthalpy'));
});

test('detects transition phrases', () => {
  assert.ok(Summarizer.detectTransition("So now let's talk about the French Revolution"));
  assert.ok(Summarizer.detectTransition('Moving on, the next era begins'));
  assert.ok(Summarizer.detectTransition('In conclusion, the cell is amazing'));
  assert.strictEqual(Summarizer.detectTransition('The mitochondria is the powerhouse'), null);
});

test('extractive summary markdown includes key points and word count', () => {
  const md = Summarizer.extractiveSummaryMd('one two three four five', ['Point one.'], ['Part 2']);
  assert.ok(md.includes('## Key Points'));
  assert.ok(md.includes('- Point one.'));
  assert.ok(md.includes('5 words'));
});

/* ---- WAV writer ---- */
console.log('\naudio.js');
const { SessionRecorder, wavHeader } = require('../src/main/audio.js');

test('wav header encodes RIFF/WAVE with correct sizes', () => {
  const h = wavHeader(32000);
  assert.strictEqual(h.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(h.toString('ascii', 8, 12), 'WAVE');
  assert.strictEqual(h.readUInt32LE(40), 32000);
  assert.strictEqual(h.readUInt32LE(24), 16000); // sample rate
  assert.strictEqual(h.readUInt16LE(22), 1);     // mono
});

test('SessionRecorder writes a valid finalized wav', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-test-'));
  const rec = new SessionRecorder(dir);
  const oneSecond = Buffer.alloc(16000 * 2); // 1s of silence
  rec.append(oneSecond);
  rec.append(oneSecond);
  const { wavPath, durationSeconds } = rec.finalize();
  assert.strictEqual(Math.round(durationSeconds), 2);
  const data = fs.readFileSync(wavPath);
  assert.strictEqual(data.length, 44 + 16000 * 2 * 2);
  assert.strictEqual(data.readUInt32LE(40), 16000 * 2 * 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('cutChunk produces playable chunk wavs and keeps the remainder', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lv-test-'));
  const rec = new SessionRecorder(dir);
  // 9 seconds: loud first 8s, quiet last 1s (cut should land near the quiet part)
  const loud = Buffer.alloc(16000 * 2 * 8);
  for (let i = 0; i < loud.length - 1; i += 2) loud.writeInt16LE(((i % 100) - 50) * 300, i);
  const quiet = Buffer.alloc(16000 * 2 * 1);
  rec.append(loud);
  rec.append(quiet);
  const chunkPath = rec.cutChunk();
  assert.ok(fs.existsSync(chunkPath));
  const chunk = fs.readFileSync(chunkPath);
  assert.strictEqual(chunk.toString('ascii', 0, 4), 'RIFF');
  assert.ok(chunk.length > 44);
  rec.finalize();
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---- markdown renderer (export) ---- */
console.log('\nexport.js (markdown)');
// export.js requires electron at top level; test the same algorithm via a re-require trick:
const exportSrc = fs.readFileSync(path.join(__dirname, '../src/main/export.js'), 'utf8');
const mdFn = new Function('module', 'require', exportSrc.replace("const { BrowserWindow, shell } = require('electron');", 'const BrowserWindow = null, shell = null;') + '\nreturn mdToHtml;');
const mdToHtml = mdFn({ exports: {} }, require);

test('renders headings, bullets and escapes html', () => {
  const html = mdToHtml('## TL;DR\n- **bold** point\n<script>alert(1)</script>');
  assert.ok(html.includes('<h2>TL;DR</h2>'));
  assert.ok(html.includes('<li><strong>bold</strong> point</li>'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});

/* ---- sessions title helper ---- */
console.log('\nsessions.js');
const sessions = require('../src/main/sessions.js');

test('derives a tidy title from the first sentence', () => {
  const t = sessions.titleFromTranscript('Today we explore the causes of the First World War in Europe. More text.');
  assert.strictEqual(t, 'Today we explore the causes of the First World');
});

test('falls back for empty transcripts', () => {
  assert.strictEqual(sessions.titleFromTranscript(''), 'Untitled lecture');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
