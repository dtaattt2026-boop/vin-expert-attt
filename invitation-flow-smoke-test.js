const fs = require('fs');
const vm = require('vm');

const html = fs.readFileSync('index.html', 'utf8');

function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  if (start === -1) throw new Error(`Function not found: ${name}`);
  let fnStart = start;
  const asyncPrefixStart = Math.max(0, start - 6);
  if (html.slice(asyncPrefixStart, start) === 'async ') fnStart = asyncPrefixStart;
  const bodyStart = html.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(fnStart, i + 1);
    }
  }
  throw new Error(`Parse failed: ${name}`);
}

function makeFakeFb(initial = {}) {
  const store = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const fb = {
    db: {},
    doc: (_db, collection, id) => `${collection}/${id}`,
    async runTransaction(_db, callback) {
      const tx = {
        async get(ref) {
          return {
            exists: () => store.has(ref),
            data: () => JSON.parse(JSON.stringify(store.get(ref) || {}))
          };
        },
        set(ref, data) {
          store.set(ref, JSON.parse(JSON.stringify(data)));
        },
        update(ref, data) {
          if (!store.has(ref)) throw new Error(`missing-doc:${ref}`);
          store.set(ref, Object.assign({}, store.get(ref), JSON.parse(JSON.stringify(data))));
        }
      };
      await callback(tx);
    },
    _store: store
  };
  return fb;
}

const code = [
  extractFunction('consommerInvitationEtCreerProfil'),
  'module.exports = { consommerInvitationEtCreerProfil };'
].join('\n\n');

const sandbox = { module: { exports: {} }, window: {} };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

const { consommerInvitationEtCreerProfil } = sandbox.module.exports;

const tests = [
  {
    name: 'Consomme le code et cree un agent valide automatiquement',
    run: async () => {
      const fb = makeFakeFb({
        'inviteCodes/ATT-ABCDEFGH': {
          code: 'ATT-ABCDEFGH',
          createdBy: 'inviter-1',
          createdByName: 'Agent Invitant',
          used: false,
          revoked: false,
          createdAt: '2026-05-09T10:00:00Z'
        },
        'invitations/inviter-1': {
          code: 'ATT-ABCDEFGH',
          createdBy: 'inviter-1',
          used: false,
          revoked: false
        }
      });
      sandbox.window._fb = fb;
      await consommerInvitationEtCreerProfil('ATT-ABCDEFGH', 'new-user-1', {
        prenom: 'Nouveau',
        nom: 'Agent',
        email: 'nouveau@example.test',
        matricule: 'M123',
        role: 'pending',
        disabled: true
      });
      const user = fb._store.get('users/new-user-1');
      const invite = fb._store.get('inviteCodes/ATT-ABCDEFGH');
      const slot = fb._store.get('invitations/inviter-1');
      return user.role === 'agent'
        && user.disabled === false
        && user.autoValidatedByInvite === true
        && user.inviteCode === 'ATT-ABCDEFGH'
        && invite.used === true
        && invite.usedBy === 'new-user-1'
        && invite.usedByEmail === 'nouveau@example.test'
        && slot.used === true;
    }
  },
  {
    name: 'Refuse un code deja consomme',
    run: async () => {
      const fb = makeFakeFb({
        'inviteCodes/ATT-USED0001': {
          code: 'ATT-USED0001',
          createdBy: 'inviter-1',
          used: true,
          revoked: false
        }
      });
      sandbox.window._fb = fb;
      try {
        await consommerInvitationEtCreerProfil('ATT-USED0001', 'new-user-2', {
          prenom: 'A',
          nom: 'B',
          email: 'a@example.test',
          matricule: 'M2'
        });
      } catch (e) {
        return e.message === 'invite-consumed' && !fb._store.has('users/new-user-2');
      }
      return false;
    }
  }
];

(async () => {
  let passed = 0;
  for (const test of tests) {
    let ok = false;
    try { ok = await test.run(); } catch (e) { ok = false; }
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
