'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { supportsRelationalDashboard, toHomeState } = require('../../utils/systemDashboardCore.cjs');
const server = { serverKey: 'fixture', apiBaseUrl: 'http://127.0.0.1:5824/api', capabilities: { relationalBusiness: true, businessRulesVersion: 2, dashboardRulesVersion: 1 } };
test('dashboard capability stays scoped and older server capabilities retain their existing path', () => {
  assert.equal(supportsRelationalDashboard(server), true);
  for (const value of [null, { ...server, serverKey: null }, { ...server, capabilities: {} }, { ...server, capabilities: { ...server.capabilities, dashboardRulesVersion: undefined } }, { ...server, capabilities: { ...server.capabilities, relationalBusiness: false } }]) assert.equal(supportsRelationalDashboard(value), false);
});
test('one home snapshot preserves exact order values and copies the displayed stats', () => {
  const snapshot = { stats: { pendingReview: 2, inProgress: 1, lowStock: 107 }, recentOrders: [{ id: 'large-order', total: '9007199254740993.01', items: [{ quantity: '0.001' }] }] };
  const state = toHomeState(snapshot);
  assert.deepEqual(state.stats, snapshot.stats); assert.notEqual(state.stats, snapshot.stats);
  assert.equal(state.recentOrders[0].total, '9007199254740993.01'); assert.equal(state.recentOrders[0].items[0].quantity, '0.001');
});
test('invalid or partial statistics cannot turn into misleading zero counters', () => {
  const valid = { stats: { pendingReview: 0, inProgress: 0, lowStock: 0 }, recentOrders: [] };
  for (const bad of [undefined, null, {}, { ...valid, recentOrders: undefined }, { ...valid, recentOrders: [{ id: '' }] }, { ...valid, recentOrders: Array.from({ length: 5 }, (_, index) => ({ id: String(index) })) }, ...['pendingReview', 'inProgress', 'lowStock'].flatMap(key => [-1, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(value => ({ ...valid, stats: { ...valid.stats, [key]: value } })))]) assert.throws(() => toHomeState(bad), /统计/);
});
