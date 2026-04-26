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
  const match = html.match(regex);
  if (!match) throw new Error(`Const not found: ${name}`);
  return match[0];
}

const code = [
  extractConst('OCR_SPACE_FALLBACK_KEY'),
  extractFunction('resolveOcrApiKey'),
  extractFunction('getOcrConfigSourceLabel'),
  'module.exports = { OCR_SPACE_FALLBACK_KEY, resolveOcrApiKey, getOcrConfigSourceLabel };'
].join('\n\n');

const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { OCR_SPACE_FALLBACK_KEY, resolveOcrApiKey, getOcrConfigSourceLabel } = sandbox.module.exports;

const tests = [
  {
    name: 'Fallback OCR key est utilisée si aucune clé privée',
    run: () => resolveOcrApiKey({ apiKey: '' }) === OCR_SPACE_FALLBACK_KEY
  },
  {
    name: 'Clé privée OCR est prioritaire',
    run: () => resolveOcrApiKey({ apiKey: 'MY_PRIVATE_KEY' }) === 'MY_PRIVATE_KEY'
  },
  {
    name: 'Libellé source reflète la clé configurée',
    run: () => getOcrConfigSourceLabel({ apiKey: 'MY_PRIVATE_KEY' }).includes('configurée') && getOcrConfigSourceLabel({ apiKey: '' }).includes('publique')
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
