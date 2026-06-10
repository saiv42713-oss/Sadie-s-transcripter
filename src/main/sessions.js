// Session storage: one folder per lecture under the configured save location.
//   YYYY-MM-DD_HH-MM/ { audio.wav, transcript.txt, summary.md, metadata.json }
const fs = require('fs');
const path = require('path');
const config = require('./config');

function two(n) { return String(n).padStart(2, '0'); }

function newSessionDir() {
  const base = config.load().saveLocation;
  const d = new Date();
  let name = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}_${two(d.getHours())}-${two(d.getMinutes())}`;
  let dir = path.join(base, name);
  let suffix = 1;
  while (fs.existsSync(dir)) dir = path.join(base, `${name}-${suffix++}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function writeSessionFiles(dir, { transcript, summary, metadata }) {
  if (transcript !== undefined) fs.writeFileSync(path.join(dir, 'transcript.txt'), transcript);
  if (summary !== undefined) fs.writeFileSync(path.join(dir, 'summary.md'), summary);
  if (metadata !== undefined) fs.writeFileSync(path.join(dir, 'metadata.json'), JSON.stringify(metadata, null, 2));
}

function titleFromTranscript(transcript) {
  const firstSentence = (transcript || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s/)[0] || '';
  const words = firstSentence.split(' ').slice(0, 9).join(' ');
  return words.length > 2 ? words.replace(/[.!?,;:]$/, '') : 'Untitled lecture';
}

function readSession(dir) {
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return { dir, metadata };
  } catch {
    return null;
  }
}

function listSessions() {
  const base = config.load().saveLocation;
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => readSession(path.join(base, e.name)))
    .filter(Boolean)
    .sort((a, b) => (b.metadata.date || '').localeCompare(a.metadata.date || ''));
}

function loadSessionContent(dir) {
  const read = (f) => {
    const p = path.join(dir, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const session = readSession(dir);
  return {
    dir,
    metadata: session ? session.metadata : {},
    transcript: read('transcript.txt'),
    summary: read('summary.md')
  };
}

// Keyword search across transcripts; cheap linear scan, fine for personal use.
function searchSessions(query) {
  const q = query.trim().toLowerCase();
  if (!q) return listSessions();
  return listSessions().filter((s) => {
    if ((s.metadata.title || '').toLowerCase().includes(q)) return true;
    const t = path.join(s.dir, 'transcript.txt');
    try {
      return fs.readFileSync(t, 'utf8').toLowerCase().includes(q);
    } catch {
      return false;
    }
  });
}

function deleteSession(dir) {
  // Only delete directories inside the configured save location.
  const base = path.resolve(config.load().saveLocation);
  const target = path.resolve(dir);
  if (!target.startsWith(base + path.sep)) throw new Error('Refusing to delete outside the library');
  fs.rmSync(target, { recursive: true, force: true });
}

module.exports = { newSessionDir, writeSessionFiles, titleFromTranscript, listSessions, loadSessionContent, searchSessions, deleteSession };
