const path = require('path');
const fs = require('fs');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), '.lecturevault');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULTS = {
  apiKey: '',
  whisperModel: 'Xenova/whisper-small.en',
  theme: 'pink',
  autoScroll: true,
  keyPointInterval: 30000
};

function ensureDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Older versions of the app stored bare names like "small" — those are not
// valid Hugging Face model IDs and make Whisper fail to load entirely.
const LEGACY_MODEL_MAP = {
  tiny: 'Xenova/whisper-tiny.en',
  base: 'Xenova/whisper-base.en',
  small: 'Xenova/whisper-small.en',
  medium: 'Xenova/whisper-medium.en'
};

function normalizeModel(model) {
  if (!model) return DEFAULTS.whisperModel;
  if (LEGACY_MODEL_MAP[model]) return LEGACY_MODEL_MAP[model];
  if (!/^(Xenova|onnx-community|distil-whisper)\/(distil-)?whisper-/.test(model)) {
    return DEFAULTS.whisperModel;
  }
  return model;
}

function readConfig() {
  try {
    ensureDir();
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const config = { ...DEFAULTS, ...JSON.parse(raw) };
    config.whisperModel = normalizeModel(config.whisperModel);
    return config;
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
