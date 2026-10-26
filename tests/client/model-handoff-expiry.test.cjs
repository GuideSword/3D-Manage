const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

async function harness() {
  const slots = [], effects = [], opened = [], timers = new Map();
  let index = 0, now = 1000, authorizer, tree;
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useState: initial => { const i = index++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
    useRef: initial => { const i = index++; return slots[i] ||= { current: initial }; },
    useCallback: (fn, deps) => { const i = index++, old = slots[i]; if (!old || deps.some((dep,n) => dep !== old.deps[n])) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect: (fn, deps) => {
      const i = index++, old = slots[i];
      if (!old || deps.some((dep, n) => dep !== old.deps[n])) {
        effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
      }
    },
  };
  const mocks = {
    react,
    'react-native': Object.fromEntries(['Modal','View','Text','TextInput','Pressable','ScrollView'].map(name => [name, name])),
    '../utils/api': { setFileDownloadAuthorizer: fn => { authorizer = fn; }, apiRequest: async url => url.includes('/requirements') ? { protected: true, requiresPassword: false } : { token: 'a'.repeat(43), expiresIn: 60 } },
    '../utils/serverRuntime': { isCurrentRuntime: () => true, subscribeServerRuntime: () => () => {}, StaleSessionError: class extends Error {} },
    '../context/ThemeContext': { useAppTheme: () => ({ colors: {} }) },
    './ModelHandoffInstallCard': () => null,
  };
  mocks['react-native'].Linking = { openURL: async url => { opened.push(url); } };
  const code = babel.transformSync(fs.readFileSync('components/ModelDownloadDialog.js','utf8'), { babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs','@babel/plugin-transform-react-jsx'] }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, require: key => { if (!(key in mocks)) throw Error(key); return mocks[key]; }, URL, Date: class extends Date { static now() { return now; } }, setTimeout: fn => { const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id) });
  const render = () => { index = 0; tree = module.exports.default(); effects.splice(0).forEach(fn => fn()); };
  function button(label) {
    const walk = node => {
      if (Array.isArray(node)) return node.map(walk).find(Boolean);
      if (!node || typeof node !== 'object') return null;
      if (node.type === 'Pressable' && node.props.children.flat().some(child => child?.type === 'Text' && child.props.children.flat().includes(label))) return node;
      return walk(node.props?.children);
    };
    const found = walk(tree); assert.ok(found, `Missing button: ${label}`); return found;
  }
  render();
  authorizer({ fileUrl: 'https://erp.test/api/files/models/part.stl', captured: { apiBaseUrl: 'https://erp.test/api' }, purpose: 'handoff' }).catch(() => {});
  await new Promise(resolve => setImmediate(resolve)); render();
  button('同意将模型拉取至本地').props.onPress(); render();
  await button('已安装助手，验证并继续').props.onPress(); render();
  return { opened, advance: ms => { now += ms; }, open: async () => { await button('打开 Bambu Studio').props.onPress(); render(); }, text: () => JSON.stringify(tree) };
}
test('a suspended browser cannot launch the local helper with an expired ticket', async () => {
  const h = await harness();
  h.advance(60001); // Browser timers deliberately do not fire while suspended.
  await h.open();
  assert.equal(h.opened.length, 0);
  assert.match(h.text(), /过期/);
});
test('a fresh handoff ticket still launches only after the explicit click', async () => {
  const h = await harness(); assert.equal(h.opened.length, 0);
  await h.open(); assert.equal(h.opened.length, 1);
  assert.match(h.opened[0], /^manage3d-model:\/\/open\?/);
});
