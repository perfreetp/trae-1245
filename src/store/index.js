const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');

const STORES = {
  account: path.join(DATA_DIR, 'account.json'),
  codepack: path.join(DATA_DIR, 'codepack.json'),
  batch: path.join(DATA_DIR, 'batch.json'),
  flow: path.join(DATA_DIR, 'flow.json'),
  verify: path.join(DATA_DIR, 'verify.json'),
  report: path.join(DATA_DIR, 'report.json'),
  log: path.join(DATA_DIR, 'log.json'),
  retry: path.join(DATA_DIR, 'retry.json'),
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function load(storeName) {
  ensureDataDir();
  const filePath = STORES[storeName];
  if (!filePath) return [];
  if (!fs.existsSync(filePath)) return [];
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return [];
  }
}

function save(storeName, data) {
  ensureDataDir();
  const filePath = STORES[storeName];
  if (!filePath) return;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function addLog(action, detail) {
  const logs = load('log');
  logs.push({
    id: 'LOG' + Date.now().toString(36).toUpperCase(),
    action,
    detail,
    timestamp: new Date().toISOString(),
  });
  save('log', logs);
}

function addRetry(taskType, payload, errorMsg) {
  const retries = load('retry');
  retries.push({
    id: 'RTY' + Date.now().toString(36).toUpperCase() + Math.floor(Math.random() * 1000).toString(36).toUpperCase(),
    taskType,
    payload,
    errorMsg,
    status: 'pending',
    createdAt: new Date().toISOString(),
    retryCount: 0,
    history: [],
  });
  save('retry', retries);
  return retries[retries.length - 1];
}

module.exports = { load, save, addLog, addRetry, DATA_DIR };
