const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_DIR = path.join(os.homedir(), 'LectureVault');

function ensureBase() {
  fs.mkdirSync(BASE_DIR, { recursive: true });
}

function createSession() {
  ensureBase();
  const id = `session-${Date.now()}`;
  const dir = path.join(BASE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  return { id, dir };
}

function saveSessionData(id, { audioBuffer, transcript, summary, metadata }) {
  const dir = path.join(BASE_DIR, id);
  fs.mkdirSync(dir, { recursive: true });

  if (audioBuffer) {
    const buf = Buffer.isBuffer(audioBuffer)
      ? audioBuffer
      : Buffer.from(audioBuffer);
    fs.writeFileSync(path.join(dir, 'audio.wav'), buf);
  }
  if (transcript !== undefined) {
    fs.writeFileSync(path.join(dir, 'transcript.txt'), transcript, 'utf-8');
  }
  if (summary !== undefined) {
    fs.writeFileSync(path.join(dir, 'summary.md'), summary, 'utf-8');
  }
  if (metadata !== undefined) {
    fs.writeFileSync(
      path.join(dir, 'metadata.json'),
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );
  }
}

function listSessions() {
  ensureBase();
  let entries;
  try {
    entries = fs.readdirSync(BASE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('session-'))
    .map(e => {
      const metaPath = path.join(BASE_DIR, e.name, 'metadata.json');
      let metadata = {};
      try {
        metadata = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      } catch {}
      return { id: e.name, ...metadata };
    })
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

function getSession(id) {
  const dir = path.join(BASE_DIR, id);
  const result = { id };

  try {
    result.transcript = fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf-8');
  } catch {}
  try {
    result.summary = fs.readFileSync(path.join(dir, 'summary.md'), 'utf-8');
  } catch {}
  try {
    result.metadata = JSON.parse(fs.readFileSync(path.join(dir, 'metadata.json'), 'utf-8'));
  } catch {}

  return result;
}

function deleteSession(id) {
  const dir = path.join(BASE_DIR, id);
  fs.rmSync(dir, { recursive: true, force: true });
}

module.exports = { createSession, saveSessionData, listSessions, getSession, deleteSession, BASE_DIR };
