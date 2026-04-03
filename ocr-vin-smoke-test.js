const fs = require('fs');
const path = require('path');
const vm = require('vm');

const filePath = path.join(__dirname, 'index.html');
const html = fs.readFileSync(filePath, 'utf8');

function extractFunction(name) {
  const sig = `function ${name}(`;
  const start = html.indexOf(sig);
  if (start === -1) throw new Error(`Function not found: ${name}`);
  const bodyStart = html.indexOf('{', start);
  let i = bodyStart;
  let depth = 0;
  while (i < html.length) {
    const ch = html[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
    i++;
  }
  throw new Error(`Could not parse function: ${name}`);
}

const symbols = [
  'VIN_MAP',
  'VIN_WEIGHTS'
];

function extractConst(name) {
  const regex = new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`);
  const m = html.match(regex);
  if (!m) throw new Error(`Const not found: ${name}`);
  return m[0];
}

const neededFns = [
  'calcCheckDigit',
  'corrigerVINparCheckDigit',
  'extraireVIN',
  'evaluerCandidatVIN'
];

const code = [
  ...symbols.map(extractConst),
  ...neededFns.map(extractFunction),
  'module.exports = { calcCheckDigit, corrigerVINparCheckDigit, extraireVIN, evaluerCandidatVIN };'
].join('\n\n');

const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const {
  calcCheckDigit,
  corrigerVINparCheckDigit,
  extraireVIN,
  evaluerCandidatVIN
} = sandbox.module.exports;

const tests = [
  {
    name: 'Extract VIN propre depuis texte bruité',
    run: () => extraireVIN('... vin: 1HGCM82633A004352 ###') === '1HGCM82633A004352'
  },
  {
    name: 'Correction check digit sur confusion Z/2',
    run: () => corrigerVINparCheckDigit('1HGCM8Z633A004352') === '1HGCM82633A004352'
  },
  {
    name: 'Correction check digit sur confusion X/1',
    run: () => corrigerVINparCheckDigit('WBAWC910X0PV85583') === 'WBAWC91010PV85583'
  },
  {
    name: 'Check digit connu',
    run: () => calcCheckDigit('1HGCM82633A004352') === '3'
  },
  {
    name: 'Scoring favorise VIN valide complet',
    run: () => evaluerCandidatVIN('1HGCM82633A004352', 60) > evaluerCandidatVIN('1HGCM82633A00435', 90)
  }
];

let passed = 0;
for (const t of tests) {
  let ok = false;
  try { ok = !!t.run(); } catch (e) { ok = false; }
  if (ok) {
    passed++;
    console.log(`PASS - ${t.name}`);
  } else {
    console.log(`FAIL - ${t.name}`);
  }
}

console.log(`\\nResult: ${passed}/${tests.length} tests passed.`);
if (passed !== tests.length) process.exit(1);
