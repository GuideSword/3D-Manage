'use strict';
const { supportsMasterData } = require('./masterDataCore.cjs');
const supportsRelationalDashboard = server => supportsMasterData(server) && server.capabilities.dashboardRulesVersion === 1;
function toHomeState(snapshot) {
  const invalid = () => { throw new Error('统计数据格式有误，请刷新后重试'); };
  if (!snapshot?.stats || !Array.isArray(snapshot.recentOrders) || snapshot.recentOrders.length > 4) invalid();
  const stats = {};
  for (const key of ['pendingReview', 'inProgress', 'lowStock']) {
    const value = snapshot.stats[key];
    if (!Number.isSafeInteger(value) || value < 0) invalid();
    stats[key] = value;
  }
  if (snapshot.recentOrders.some(order => !order || typeof order.id !== 'string' || !order.id.trim())) invalid();
  return { stats, recentOrders: snapshot.recentOrders.slice() };
}
module.exports = { supportsRelationalDashboard, toHomeState };
