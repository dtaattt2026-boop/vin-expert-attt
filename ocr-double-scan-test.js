const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

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
  const match = html.match(new RegExp(`const\\s+${name}\\s*=\\s*[^;]+;`));
  if (!match) throw new Error(`Const not found: ${name}`);
  return match[0];
}

const code = [
  extractConst('VIN_MAP'),
  extractConst('VIN_WEIGHTS'),
  extractConst('WMI_CHECK_DIGIT_REGIONS'),
  'let doubleScanState = { firstVin: "", firstSource: "", firstMode: "", pending: false, confirmedVin: "", mismatchCount: 0 };',
  extractFunction('calcCheckDigit'),
  extractFunction('checkDigitObligatoire'),
  extractFunction('evaluerCandidatVIN'),
  extractFunction('evaluerConsensusOcr'),
  extractFunction('updateDoubleScanUI'),
  extractFunction('resetDoubleScanState'),
  extractFunction('registerDoubleScanResult'),
  extractFunction('diagnosticOcrEstFiable'),
  'module.exports = { registerDoubleScanResult, resetDoubleScanState, diagnosticOcrEstFiable, getState: () => doubleScanState };'
].join('\n\n');

const sandbox = {
  module: { exports: {} },
  showToast: () => {},
  document: { getElementById: () => null }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { registerDoubleScanResult, resetDoubleScanState, diagnosticOcrEstFiable, getState } = sandbox.module.exports;

const tests = [
  {
    name: 'Premier scan met la double lecture en attente',
    run: () => {
      resetDoubleScanState(false);
      registerDoubleScanResult({ vin: 'WBAWC91010PV85583', mode: 'web', source: 'Zone VIN', conf: 65, wasFixed: false, consensus: 2 });
      const state = getState();
      return state.pending === true && state.firstVin === 'WBAWC91010PV85583' && state.confirmedVin === '';
    }
  },
  {
    name: 'Deuxième scan identique confirme la double lecture',
    run: () => {
      resetDoubleScanState(false);
      registerDoubleScanResult({ vin: 'WBAWC91010PV85583', mode: 'web', source: 'A', conf: 65, wasFixed: false, consensus: 2 });
      registerDoubleScanResult({ vin: 'WBAWC91010PV85583', mode: 'web', source: 'B', conf: 65, wasFixed: false, consensus: 2 });
      const state = getState();
      return state.confirmedVin === 'WBAWC91010PV85583' && state.pending === false;
    }
  },
  {
    name: 'Scan différent déclenche une nouvelle attente',
    run: () => {
      resetDoubleScanState(false);
      registerDoubleScanResult({ vin: 'AAA11111111111111', mode: 'web', source: 'A', conf: 65, wasFixed: false, consensus: 2 });
      registerDoubleScanResult({ vin: 'BBB11111111111111', mode: 'web', source: 'B', conf: 65, wasFixed: false, consensus: 2 });
      const state = getState();
      return state.pending === true && state.firstVin === 'BBB11111111111111' && state.mismatchCount === 1;
    }
  },
  {
    name: 'Fiabilité automatique exige double scan confirmé',
    run: () => diagnosticOcrEstFiable({ vin: 'WBAWC91010PV85583', mode: 'web', conf: 65, wasFixed: false, consensus: 2, doubleScanConfirmed: true }, 'WBAWC91010PV85583') === true
  },
  {
    name: 'Sans double scan confirmé le mode strict refuse',
    run: () => diagnosticOcrEstFiable({ vin: 'WBAWC91010PV85583', mode: 'web', conf: 65, wasFixed: false, consensus: 2, doubleScanConfirmed: false }, 'WBAWC91010PV85583') === false
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
