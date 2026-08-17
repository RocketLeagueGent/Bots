const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function read(name) {
  ensureDir();
  const fp = filePath(name);
  try {
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) { console.log(`[Storage] Corrupt ${name}, resetting`); }
  return null;
}

function write(name, data) {
  ensureDir();
  try {
    const fp = filePath(name);
    const tmp = fp + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, fp);
    return true;
  } catch (e) { console.log(`[Storage] Write ${name} failed: ${e.message}`); return false; }
}

function append(name, entry) {
  let data = read(name) || [];
  data.push(entry);
  if (data.length > 1000) data = data.slice(-800);
  write(name, data);
  return data;
}

module.exports = { read, write, append, DATA_DIR };
