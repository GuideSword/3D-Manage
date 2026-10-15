'use strict';
const { createMaterialService } = require('../materials/service');
const { createModelService } = require('../models/service');
const { createOrderService } = require('../orders/service');
const { createInventoryService } = require('../inventory/service');
const { createUserService } = require('../users/service');
const { createUserAuthentication } = require('../users/authentication');
const { createCsvAdapter } = require('./csv');

function createRelationalServices(pool, options = {}) {
  return Object.freeze({
    materials: createMaterialService(pool), models: createModelService(pool, options), orders: createOrderService(pool, options),
    inventory: createInventoryService(pool, options), users: createUserService(pool, options),
    authentication: createUserAuthentication(pool, options), csv: createCsvAdapter(pool, options),
  });
}
module.exports = { createRelationalServices };
