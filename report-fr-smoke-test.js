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
  extractFunction('traduireValeurRapport'),
  extractFunction('traduireCommentaireNhtsa'),
  'module.exports = { normaliserValeurNhtsa, traduireValeurRapport, traduireCommentaireNhtsa };'
].join('\n\n');

const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { traduireValeurRapport, traduireCommentaireNhtsa } = sandbox.module.exports;

const tests = [
  {
    name: 'Passenger Car -> Voiture particulière',
    run: () => traduireValeurRapport('Passenger Car') === 'Voiture particulière'
  },
  {
    name: 'All-Wheel Drive -> Transmission intégrale',
    run: () => traduireValeurRapport('All-Wheel Drive') === 'Transmission intégrale'
  },
  {
    name: 'Commentaire VIN decoded clean traduit',
    run: () => traduireCommentaireNhtsa('0 - VIN decoded clean.') === '0 - VIN décodé correctement.'
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
