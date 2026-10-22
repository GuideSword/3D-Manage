'use strict';
const { createLegacyDownloadRepository } = require('./legacyRepository');
const { createModelDownloadService } = require('./service');
const repository = createLegacyDownloadRepository();
const service = createModelDownloadService(repository);
const session = req => repository.authenticate(String(req.get('Authorization') || '').replace(/^Bearer /, ''));
module.exports = {
  service, authenticate: repository.authenticate,
  checkRequest: async (req, key) => {
    const identity = await session(req);
    if ((await service.status(identity, key)).requiresPassword) require('./transport').assertDownloadTransport(req);
    return service.check(identity, key, req.get('X-Model-Download-Grant'));
  },
  statusRequest: async req => service.status(await session(req)),
};
