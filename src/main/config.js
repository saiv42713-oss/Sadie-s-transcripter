// Persistent app configuration at ~/.lecturevault/config.json
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.lecturevault');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');
const MODELS_DIR = path.join(CONFIG_DIR, 'models');

const DEFAULTS = {
  apiKey: '',
  whisperModel: 'tiny',
  saveLocation: path.join(os.homedir(), 'LectureVault'),
  silenceGapSeconds: 4,
  aiPolish: true,
  onboarded: false,
  // The model used for the optional AI polish pass.
  anthropicModel: 'claude-sonnet-4-20250514'
};

function ensureDirs() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

function load() {
  ensureDirs();
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(partial) {
  ensureDirs();
  const next = { ...load(), ...partial };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

module.exports = { load, save, CONFIG_DIR, MODELS_DIR, DEFAULTS };
