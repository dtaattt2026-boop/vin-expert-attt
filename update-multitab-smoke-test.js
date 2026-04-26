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
  extractConst('SHARED_UPDATE_LOCK_KEY'),
  extractFunction('safeStorageGet'),
  extractFunction('safeStorageSet'),
  extractFunction('safeStorageRemove'),
  extractFunction('getRememberedUpdateVersion'),
  extractFunction('getRememberedUpdateAgeMs'),
  extractFunction('readSharedUpdateLock'),
  extractFunction('writeSharedUpdateLock'),
  extractFunction('clearSharedUpdateLockIfResolved'),
  extractFunction('rememberPendingUpdateVersion'),
  extractFunction('clearResolvedUpdateVersion'),
  extractFunction('shouldThrottleSameUpdate'),
  extractFunction('triggerAppUpdate'),
  extractFunction('compareVersions'),
  extractFunction('setupServiceWorkerAutoUpdate'),
  'module.exports = { safeStorageGet, safeStorageSet, safeStorageRemove, getRememberedUpdateVersion, getRememberedUpdateAgeMs, readSharedUpdateLock, writeSharedUpdateLock, clearSharedUpdateLockIfResolved, rememberPendingUpdateVersion, clearResolvedUpdateVersion, shouldThrottleSameUpdate, triggerAppUpdate, compareVersions, setupServiceWorkerAutoUpdate };'
].join('\n\n');

function createStorage(backingMap) {
  return {
    getItem(key) {
      return backingMap.has(key) ? backingMap.get(key) : null;
    },
    setItem(key, value) {
      backingMap.set(key, String(value));
    },
    removeItem(key) {
      backingMap.delete(key);
    }
  };
}

function createTab(sharedBacking) {
  const sessionBacking = new Map();
  const sharedStorage = createStorage(sharedBacking);
  const sessionStorage = createStorage(sessionBacking);
  const sandbox = {
    module: { exports: {} },
    console,
    JSON,
    Math,
    Number,
    Date,
    Promise,
    localStorage: sharedStorage,
    sessionStorage,
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {}
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  sandbox.window.APP_VERSION = '2.7.17';
  sandbox.window._updateInProgress = false;
  sandbox.window._pendingUpdateVersion = '';
  sandbox.doUpdateCalls = [];
  sandbox.doUpdate = (version, source) => {
    sandbox.doUpdateCalls.push({ version, source });
    sandbox.window._updateInProgress = true;
  };
  return sandbox;
}

function createServiceWorkerHarness() {
  const regListeners = {};
  const workerListeners = {};
  const serviceWorkerListeners = {};
  const documentListeners = {};

  const worker = {
    state: 'installing',
    messages: [],
    addEventListener(type, callback) {
      workerListeners[type] = callback;
    },
    postMessage(message) {
      this.messages.push(message);
    }
  };

  const registration = {
    waiting: null,
    installing: worker,
    updateCalls: 0,
    addEventListener(type, callback) {
      regListeners[type] = callback;
    },
    update() {
      this.updateCalls += 1;
      return Promise.resolve();
    }
  };

  return {
    worker,
    workerListeners,
    regListeners,
    registration,
    navigator: {
      serviceWorker: {
        controller: true,
        register() {
          return Promise.resolve(registration);
        },
        addEventListener(type, callback) {
          serviceWorkerListeners[type] = callback;
        }
      }
    },
    document: {
      visibilityState: 'visible',
      addEventListener(type, callback) {
        documentListeners[type] = callback;
      }
    }
  };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

const tests = [
  {
    name: 'Premier onglet declenche une seule mise a jour et ecrit le verrou partage',
    run: () => {
      const sharedBacking = new Map();
      const tab = createTab(sharedBacking);
      const ok = tab.module.exports.triggerAppUpdate('2.7.18', 'tab-a');
      const shared = JSON.parse(sharedBacking.get('_vin_shared_update_lock'));
      return ok === true
        && tab.doUpdateCalls.length === 1
        && tab.doUpdateCalls[0].version === '2.7.18'
        && shared.version === '2.7.18';
    }
  },
  {
    name: 'Second onglet ignore la meme version pendant le cooldown partage',
    run: () => {
      const sharedBacking = new Map();
      const tabA = createTab(sharedBacking);
      tabA.module.exports.triggerAppUpdate('2.7.18', 'tab-a');
      const tabB = createTab(sharedBacking);
      const ok = tabB.module.exports.triggerAppUpdate('2.7.18', 'tab-b');
      return ok === false && tabB.doUpdateCalls.length === 0;
    }
  },
  {
    name: 'Verrou partage expire apres la fenetre de cooldown',
    run: () => {
      const sharedBacking = new Map();
      const expiredAt = Date.now() - 120000;
      sharedBacking.set('_vin_shared_update_lock', JSON.stringify({ version: '2.7.18', source: 'session', at: expiredAt }));
      const tab = createTab(sharedBacking);
      const ok = tab.module.exports.triggerAppUpdate('2.7.18', 'after-expiry');
      return ok === true && tab.doUpdateCalls.length === 1;
    }
  },
  {
    name: 'Version resolue nettoie le verrou partage',
    run: () => {
      const sharedBacking = new Map();
      const tab = createTab(sharedBacking);
      tab.module.exports.triggerAppUpdate('2.7.18', 'tab-a');
      tab.window.APP_VERSION = '2.7.18';
      tab.window._updateInProgress = false;
      tab.module.exports.clearResolvedUpdateVersion();
      return !sharedBacking.has('_vin_shared_update_lock')
        && tab.sessionStorage.getItem('_vin_pending_update_version') === null;
    }
  },
  {
    name: 'Updatefound passif ne re-affiche pas l overlay si un autre onglet gere deja la mise a jour',
    run: async () => {
      const sharedBacking = new Map();
      sharedBacking.set('_vin_shared_update_lock', JSON.stringify({ version: '2.7.18', source: 'tab-a', at: Date.now() }));
      const tab = createTab(sharedBacking);
      const harness = createServiceWorkerHarness();
      tab.navigator = harness.navigator;
      tab.document = harness.document;
      tab.showUpdateProgressCalls = [];
      tab.showUpdateProgress = (...args) => tab.showUpdateProgressCalls.push(args);
      tab.reloadForUpdateCalls = 0;
      tab.reloadForUpdate = () => { tab.reloadForUpdateCalls += 1; };
      tab.module.exports.setupServiceWorkerAutoUpdate();
      await flushMicrotasks();
      harness.regListeners.updatefound();
      harness.worker.state = 'installed';
      harness.workerListeners.statechange();
      harness.worker.state = 'activating';
      harness.workerListeners.statechange();
      return tab.showUpdateProgressCalls.length === 0 && harness.worker.messages.length === 0;
    }
  }
];

(async () => {
  let passed = 0;
  for (const test of tests) {
    let ok = false;
    try {
      ok = !!(await test.run());
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
})();
