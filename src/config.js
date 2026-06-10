const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.lecturevault');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  apiKey: '',
  whisperModel: 'Xenova/whisper-base.en',
  theme: 'dark',
  autoScroll: true,
  keyPointInterval: 30000
};

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readConfig() {
  try {
    ensureDir();
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeConfig(updates) {
  ensureDir();
  const current = readConfig();
  const next = { ...current, ...updates };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

function getModelCacheDir() {
  const dir = path.join(CONFIG_DIR, 'models');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { readConfig, writeConfig, getModelCacheDir, CONFIG_DIR };
