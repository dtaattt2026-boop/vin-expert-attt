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

const code = [
  extractFunction('normaliserValeurNhtsa'),
  extractFunction('formatLocationSummary'),
  extractFunction('buildLocationMapUrl'),
  extractFunction('buildReportFolderName'),
  extractFunction('buildArchiveMetadata'),
  extractFunction('buildArchiveMetadataLines'),
  'module.exports = { buildLocationMapUrl, buildReportFolderName, buildArchiveMetadata, buildArchiveMetadataLines };'
].join('\n\n');

const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const {
  buildLocationMapUrl,
  buildReportFolderName,
  buildArchiveMetadata,
  buildArchiveMetadataLines
} = sandbox.module.exports;

const record = {
  vin: 'WBAWC91010PV85583',
  agentNom: 'Test Agent',
  matricule: '347',
  lieuTravail: 'DTA',
  date: '02/04/2026 12:00:00',
  is_valid: true,
  info: 'BMW Série 3 2010',
  locationSummary: 'Lat 36.800000, Lng 10.180000, précision ±15 m',
  locationInfo: {
    status: 'ok',
    latitude: 36.8,
    longitude: 10.18,
    accuracy: 15
  }
};
const diagnostics = { mode: 'web', source: 'Zone VIN', consensus: 3, doubleScanConfirmed: true };
const metadata = buildArchiveMetadata(record, diagnostics);
const lines = buildArchiveMetadataLines(record, metadata);

const tests = [
  {
    name: 'Lien carte généré',
    run: () => buildLocationMapUrl(record.locationInfo).includes('maps.google.com')
  },
  {
    name: 'Nom de dossier contient le VIN',
    run: () => buildReportFolderName(record).startsWith('WBAWC91010PV85583_')
  },
  {
    name: 'Metadata inclut lien carte et OCR',
    run: () => metadata.lienCarte.includes('maps.google.com') && metadata.ocrMode === 'web' && metadata.doubleScanConfirme === true
  },
  {
    name: 'Résumé inclut la ligne carte',
    run: () => lines.some((line) => line.includes('Lien carte:'))
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
