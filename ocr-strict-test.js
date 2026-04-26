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
  throw new Error(`Parse failed for: ${name}`);
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
  extractFunction('calcCheckDigit'),
  extractFunction('checkDigitObligatoire'),
  extractFunction('evaluerCandidatVIN'),
  extractFunction('calculerNiveauConfianceOCR'),
  extractFunction('evaluerConsensusOcr'),
  extractFunction('diagnosticOcrEstFiable'),
  `module.exports = { calcCheckDigit, checkDigitObligatoire, evaluerCandidatVIN, calculerNiveauConfianceOCR, evaluerConsensusOcr, diagnosticOcrEstFiable };`
].join('\n\n');

const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const {
  evaluerConsensusOcr,
  diagnosticOcrEstFiable,
  calculerNiveauConfianceOCR
} = sandbox.module.exports;

const tests = [
  {
    name: 'Consensus compte correctement les lectures identiques',
    run: () => evaluerConsensusOcr([{ vin: 'A' }, { vin: 'B' }, { vin: 'A' }], 'A') === 2
  },
  {
    name: 'OCR web fiable si consensus >= 2 sur VIN a check digit optionnel',
    run: () => diagnosticOcrEstFiable({ mode: 'web', conf: 65, wasFixed: false, consensus: 2, doubleScanConfirmed: true, vin: 'WBAWC91010PV85583' }, 'WBAWC91010PV85583') === true
  },
  {
    name: 'VIN nord-americain exige un check digit valide',
    run: () => diagnosticOcrEstFiable({ mode: 'web', conf: 75, wasFixed: false, consensus: 2, doubleScanConfirmed: true, vin: '1HGCM82613A004352' }, '1HGCM82613A004352') === false
  },
  {
    name: 'OCR corrigé reste en revue manuelle',
    run: () => diagnosticOcrEstFiable({ mode: 'web', conf: 65, wasFixed: true, consensus: 2, doubleScanConfirmed: true, vin: 'WBAWC91010PV85583' }, 'WBAWC91010PV85583') === false
  },
  {
    name: 'Confiance moyenne sur VIN europeen propre',
    run: () => calculerNiveauConfianceOCR('WBAWC91010PV85583', 70) === 'moyenne'
  },
  {
    name: 'Confiance elevee sur VIN nord-americain valide robuste',
    run: () => calculerNiveauConfianceOCR('1HGCM82633A004352', 70) === 'élevée'
  }
];

let passed = 0;
for (const test of tests) {
  let ok = false;
  try {
    ok = !!test.run();
  } catch (error) {
    ok = false;
  }
  if (ok) {
    passed++;
    console.log(`PASS - ${test.name}`);
  } else {
    console.log(`FAIL - ${test.name}`);
  }
}

console.log(`\nResult: ${passed}/${tests.length} tests passed.`);
if (passed !== tests.length) process.exit(1);
