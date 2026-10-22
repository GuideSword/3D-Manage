import { apiRequest } from './api';
import { getServerRuntime } from './serverRuntime';
import catalogCore from './relationalCatalogCore.cjs';

const catalog = catalogCore.createRelationalCatalogApi({ request: apiRequest, getRuntime: getServerRuntime });
export const relationalModelsAPI = catalog.models;
export const relationalMaterialsAPI = catalog.materials;
