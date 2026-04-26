const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Function not found: ${name}`);
  const bodyStart = html.indexOf('{', start);
  let index = bodyStart;
  let depth = 0;
  while (index < html.length) {
    if (html[index] === '{') depth++;
    if (html[index] === '}') {
      depth--;
      if (depth === 0) return html.slice(start, index + 1);
    }
    index++;
  }
  throw new Error(`Parse failed: ${name}`);
}

function extractConst(name) {
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`);
  const m = html.match(regex);
  if (!m) throw new Error(`Const not found: ${name}`);
  return m[0];
}

const code = [
  extractConst('VIN_NHTSA_CACHE_KEY'),
  extractConst('VIN_NHTSA_CACHE_TTL_MS'),
  extractConst('VIN_NHTSA_CACHE_MAX_ITEMS'),
  extractFunction('safeStorageGet'),
  extractFunction('safeStorageSet'),
  extractFunction('safeStorageRemove'),
  extractFunction('cloneSimple'),
  extractFunction('readVinDecodeCacheStore'),
  extractFunction('writeVinDecodeCacheStore'),
  extractFunction('getCachedVinDecode'),
  extractFunction('rememberVinDecode'),
  extractFunction('buildNhtsaUnavailablePayload'),
  'module.exports = { safeStorageGet, safeStorageSet, safeStorageRemove, readVinDecodeCacheStore, writeVinDecodeCacheStore, getCachedVinDecode, rememberVinDecode, buildNhtsaUnavailablePayload, VIN_NHTSA_CACHE_KEY, VIN_NHTSA_CACHE_TTL_MS };'
].join('\n\n');

function createStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    _map: map
  };
}

const localStorage = createStorage();
const sandbox = {
  module: { exports: {} },
  console,
  JSON,
  Date,
  Math,
  Number,
  localStorage
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const {
  getCachedVinDecode,
  rememberVinDecode,
  buildNhtsaUnavailablePayload,
  VIN_NHTSA_CACHE_KEY,
  VIN_NHTSA_CACHE_TTL_MS
} = sandbox.module.exports;

const tests = [
  {
    name: 'Le cache NHTSA relit un resultat frais',
    run: () => {
      rememberVinDecode('1HGCM82633A004352', { summary: 'Honda Accord 2003', sure: ['Marque: Honda'], unsure: [], exactLines: ['Marque: Honda'], sourceLabel: 'NHTSA (direct)' });
      const cached = getCachedVinDecode('1HGCM82633A004352');
      return cached && cached.summary === 'Honda Accord 2003' && cached.sourceLabel === 'NHTSA (direct)';
    }
  },
  {
    name: 'Le cache NHTSA peut fournir un resultat stale en secours',
    run: () => {
      const store = JSON.parse(localStorage.getItem(VIN_NHTSA_CACHE_KEY));
      store['WBAWC91010PV85583'] = {
        savedAt: Date.now() - (VIN_NHTSA_CACHE_TTL_MS + 1000),
        payload: JSON.parse(JSON.stringify(store['1HGCM82633A004352'].payload))
      };
      localStorage.setItem(VIN_NHTSA_CACHE_KEY, JSON.stringify(store));
      const stale = getCachedVinDecode('WBAWC91010PV85583', true);
      return stale && stale.sourceLabel === 'NHTSA (cache local)';
    }
  },
  {
    name: 'Fallback indisponible ajoute un message sans perdre les donnees exactes',
    run: () => {
      const payload = buildNhtsaUnavailablePayload('Décodage NHTSA en cache local (service externe indisponible).', {
        summary: 'BMW 2010',
        sure: ['Marque: BMW'],
        unsure: [],
        exactLines: ['Marque: BMW'],
        sourceLabel: 'NHTSA (direct)'
      });
      return payload.summary === 'BMW 2010'
        && payload.exactLines.length === 1
        && payload.unsure.some(line => line.includes('cache local'));
    }
  }
];

let passed = 0;
for (const test of tests) {
  let ok = false;
  try { ok = !!test.run(); } catch (error) { ok = false; }
  if (ok) {
    passed++;
    console.log(`PASS - ${test.name}`);
  } else {
    console.log(`FAIL - ${test.name}`);
  }
}

console.log(`\nResult: ${passed}/${tests.length} tests passed.`);
if (passed !== tests.length) process.exit(1);
