'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  subscribeToNavigationRoute,
} = require('../../utils/navigationRouteObserver.cjs');

const createNavigationRef = () => {
  const listeners = new Map();
  let ready = false;
  let routeName = null;
  let routeReads = 0;

  return {
    addListener(event, callback) {
      const callbacks = listeners.get(event) || new Set();
      callbacks.add(callback);
      listeners.set(event, callbacks);
      return () => callbacks.delete(callback);
    },
    emit(event) {
      for (const callback of listeners.get(event) || []) callback();
    },
    getCurrentRoute() {
      routeReads += 1;
      if (!ready) throw new Error("The 'navigation' object hasn't been initialized yet");
      return routeName ? { name: routeName } : undefined;
    },
    isReady: () => ready,
    setReady(value) { ready = value; },
    setRoute(name) { routeName = name; },
    routeReads: () => routeReads,
  };
};

test('route observer waits for ready, follows state, and unsubscribes', () => {
  const navigationRef = createNavigationRef();
  const routes = [];
  const unsubscribe = subscribeToNavigationRoute(
    navigationRef,
    (routeName) => routes.push(routeName)
  );

  assert.equal(navigationRef.routeReads(), 0);
  assert.deepEqual(routes, []);

  navigationRef.setRoute('Home');
  navigationRef.setReady(true);
  navigationRef.emit('ready');
  assert.deepEqual(routes, ['Home']);

  navigationRef.setRoute('Settings');
  navigationRef.emit('state');
  assert.deepEqual(routes, ['Home', 'Settings']);

  unsubscribe();
  navigationRef.setRoute('Agent');
  navigationRef.emit('state');
  assert.deepEqual(routes, ['Home', 'Settings']);
});

test('App startup delegates route reads to the readiness observer', () => {
  const appSource = fs.readFileSync(
    path.resolve(__dirname, '..', '..', 'App.js'),
    'utf8'
  );

  assert.doesNotMatch(
    appSource,
    /useState\(\(\) => navigationRef\.getCurrentRoute\(\)/
  );
  assert.match(appSource, /subscribeToNavigationRoute\(navigationRef, setRouteName\)/);
});
