import { Platform } from 'react-native';
import {
  getServerRuntime,
  isCurrentRuntime,
  registerOperation,
  StaleSessionError,
} from './serverRuntime';
import {
  clearToken,
  getToken,
  setTokenForSnapshot,
} from './sessionStorage';
import { downloadAndShareNative } from './nativeDownload';

let unauthorizedHandler = null;

export const setUnauthorizedHandler = (handler) => {
  unauthorizedHandler = typeof handler === 'function' ? handler : null;
  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = null;
    }
  };
};

export const isAuthRequiredError = (error) => Boolean(error?.authRequired);

const isLoginEndpoint = (endpoint) => (
  endpoint === '/auth/login' || endpoint === '/system/bootstrap'
);

const requireRuntime = () => {
  const captured = getServerRuntime();
  if (!captured.apiBaseUrl || !captured.serverKey) {
    const error = new Error('尚未配置服务器');
    error.code = 'SERVER_NOT_CONFIGURED';
    throw error;
  }
  return captured;
};

// 通用API请求函数
export const apiRequest = async (endpoint, options = {}) => {
  const captured = requireRuntime();
  const {
    auth = true,
    timeoutMs = 30000,
    headers: optionHeaders = {},
    signal: externalSignal,
    ...requestOptions
  } = options;
  const token = auth ? await getToken(captured.serverKey) : null;
  if (!isCurrentRuntime(captured)) throw new StaleSessionError();
  const url = `${captured.apiBaseUrl}${endpoint}`;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const { controller, release } = registerOperation(captured, externalSignal);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const defaultOptions = {
    ...requestOptions,
    cache: 'no-store',
    signal: controller.signal,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...optionHeaders,
    },
  };

  try {
    const response = await fetch(url, defaultOptions);
    if (!isCurrentRuntime(captured)) throw new StaleSessionError();
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: '请求失败' }));
      const errorMessage = errorData.error || `HTTP ${response.status}`;
      const error = new Error(errorMessage);
      error.status = response.status;
      error.data = errorData;

      if (response.status === 401 && !isLoginEndpoint(endpoint)) {
        error.authRequired = true;
        if (isCurrentRuntime(captured)) {
          await clearToken(captured.serverKey);
          if (unauthorizedHandler && isCurrentRuntime(captured)) {
            unauthorizedHandler(captured);
          }
        }
      }

      throw error;
    }

    const text = await response.text();
    if (!isCurrentRuntime(captured)) throw new StaleSessionError();
    return text ? JSON.parse(text) : null;
  } catch (error) {
    if (error?.name === 'AbortError' && !isCurrentRuntime(captured)) {
      throw new StaleSessionError();
    }
    if (!isAuthRequiredError(error) && !error?.staleSession) {
      console.error('API请求失败:', error);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    release();
  }
};

const buildQuery = (params = {}) => {
  const filteredParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  return new URLSearchParams(filteredParams).toString();
};

export const buildFileUrl = (fileUrl = '', captured = requireRuntime()) => {
  if (!fileUrl) {
    return '';
  }
  if (String(fileUrl).startsWith('http')) {
    return fileUrl;
  }
  const apiRoot = captured.apiBaseUrl.replace(/\/api\/?$/, '');
  return `${String(fileUrl).startsWith('/api') ? apiRoot : captured.apiBaseUrl}${fileUrl}`;
};

export const buildProtectedFileSource = (fileUrl, token) => {
  if (!fileUrl) return null;
  const captured = requireRuntime();
  const uri = buildFileUrl(fileUrl, captured);
  const sameOrigin = new URL(uri).origin === new URL(captured.apiBaseUrl).origin;
  return {
    uri,
    ...(sameOrigin && token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  };
};

const downloadProtectedFile = async ({ fileUrl, filename }) => {
  const captured = requireRuntime();
  const url = buildFileUrl(fileUrl, captured);
  if (!url) {
    throw new Error('文件地址不存在');
  }

  const apiOrigin = new URL(captured.apiBaseUrl).origin;
  const targetOrigin = new URL(url).origin;
  const isApiOrigin = apiOrigin === targetOrigin;
  const token = isApiOrigin ? await getToken(captured.serverKey) : null;
  if (!isCurrentRuntime(captured)) throw new StaleSessionError();
  const { controller, release } = registerOperation(captured);

  try {
    if (Platform.OS !== 'web') return downloadAndShareNative({
      url,
      filename,
      token,
      captured,
      controller,
      isCurrent: isCurrentRuntime,
      staleError: () => new StaleSessionError(),
    });

    const response = await fetch(url, {
      cache: 'no-store',
      redirect: isApiOrigin ? 'manual' : 'follow',
      signal: controller.signal,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
    if (!isCurrentRuntime(captured)) throw new StaleSessionError();

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      const error = new Error(errorData.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.data = errorData;
      if (response.status === 401 && isApiOrigin && isCurrentRuntime(captured)) {
        error.authRequired = true;
        await clearToken(captured.serverKey);
        unauthorizedHandler?.(captured);
      }
      throw error;
    }

    const blob = await response.blob();
    if (!isCurrentRuntime(captured)) throw new StaleSessionError();
    if (typeof window === 'undefined' || !window.URL || !window.document) {
      throw new Error('当前平台暂不支持直接下载，请在 Web 端操作');
    }

    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = filename || 'download';
    anchor.style.display = 'none';
    window.document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 1000);
    return true;
  } finally {
    release();
  }
};

export const authAPI = {
  getToken: async () => {
    const captured = getServerRuntime();
    return captured.serverKey ? getToken(captured.serverKey) : null;
  },

  login: async (credentials) => {
    const captured = requireRuntime();
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      auth: false,
      body: JSON.stringify(credentials),
    });
    if (result.token) {
      const stored = await setTokenForSnapshot(captured, result.token);
      if (!stored) throw new StaleSessionError();
    }
    return result;
  },

  me: async () => apiRequest('/auth/me'),

  changePassword: async (payload) => apiRequest('/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),

  logout: async () => {
    const captured = getServerRuntime();
    if (captured.serverKey) await clearToken(captured.serverKey);
  },

  saveToken: async (token) => {
    const captured = requireRuntime();
    const stored = await setTokenForSnapshot(captured, token);
    if (!stored) throw new StaleSessionError();
    return true;
  },
};

export const systemAPI = {
  info: async () => apiRequest('/system/info', { auth: false, timeoutMs: 8000 }),
  bootstrap: async (payload, bootstrapToken) => apiRequest('/system/bootstrap', {
    method: 'POST',
    auth: false,
    headers: { 'X-Bootstrap-Token': bootstrapToken },
    body: JSON.stringify(payload),
  }),
};

export const usersAPI = {
  getAll: async () => apiRequest('/users'),
  create: async (payload) => apiRequest('/users', {
    method: 'POST',
    body: JSON.stringify(payload),
  }),
  update: async (id, payload) => apiRequest(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  }),
  resetPassword: async (id, password) => apiRequest(`/users/${id}/reset-password`, {
    method: 'POST',
    body: JSON.stringify({ password }),
  }),
};

// 订单API
export const ordersAPI = {
  // 获取订单列表
  getAll: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/orders${queryString ? `?${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  // 获取单个订单
  getById: async (id) => {
    return apiRequest(`/orders/${id}`);
  },

  // 创建订单
  create: async (orderData) => {
    return apiRequest('/orders', {
      method: 'POST',
      body: JSON.stringify(orderData),
    });
  },

  // 更新订单
  update: async (id, orderData) => {
    return apiRequest(`/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(orderData),
    });
  },

  // 删除订单
  delete: async (id) => {
    return apiRequest(`/orders/${id}`, {
      method: 'DELETE',
    });
  },

  // 更新订单状态
  updateStatus: async (id, status, reason = '') => {
    return apiRequest(`/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, reason }),
    });
  },

  // 导出订单
  export: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/orders/export${queryString ? `?${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  import: async (payload) => {
    return apiRequest('/orders/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  uploadAttachment: async (file) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiRequest('/orders/upload-attachment', {
      method: 'POST',
      body: formData,
    });
  },
};

// 模型API
export const modelsAPI = {
  // 获取模型列表
  getAll: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/models${queryString ? `?${queryString}` : ''}`;
    const response = await apiRequest(endpoint);
    return response.items || response || [];
  },

  // 获取单个模型
  getById: async (id) => {
    return apiRequest(`/models/${id}`);
  },

  // 创建模型
  create: async (modelData) => {
    return apiRequest('/models', {
      method: 'POST',
      body: JSON.stringify(modelData),
    });
  },

  update: async (id, modelData) => {
    return apiRequest(`/models/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(modelData),
    });
  },

  // 删除模型
  delete: async (id) => {
    return apiRequest(`/models/${id}`, {
      method: 'DELETE',
    });
  },

  export: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/models/export${queryString ? `?${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  import: async (payload) => {
    return apiRequest('/models/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  uploadModelFile: async (id, file) => {
    const formData = new FormData();
    if (file?.name) {
      formData.append('originalName', file.name);
    }
    formData.append('file', file);
    return apiRequest(`/models/${id}/files`, {
      method: 'POST',
      body: formData,
    });
  },

  uploadImage: async (id, file, type = 'other') => {
    const formData = new FormData();
    formData.append('type', type);
    if (file?.name) {
      formData.append('originalName', file.name);
    }
    formData.append('file', file);
    return apiRequest(`/models/${id}/images`, {
      method: 'POST',
      body: formData,
    });
  },

  uploadFile: async (file, metadata = {}) => {
    if (!metadata.assetId) {
      throw new Error('assetId is required for model file upload');
    }
    return modelsAPI.uploadModelFile(metadata.assetId, file);
  },

  downloadFile: async (file) => downloadProtectedFile({
    fileUrl: file?.fileUrl,
    filename: file?.name,
  }),
};

// 材质API
export const materialsAPI = {
  // 获取材质列表
  getAll: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/materials${queryString ? `?${queryString}` : ''}`;
    const response = await apiRequest(endpoint);
    return response.items || response || [];
  },

  // 获取单个材质
  getById: async (id) => {
    return apiRequest(`/materials/${id}`);
  },

  // 创建材质
  create: async (materialData) => {
    return apiRequest('/materials', {
      method: 'POST',
      body: JSON.stringify(materialData),
    });
  },

  // 更新材质
  update: async (id, materialData) => {
    return apiRequest(`/materials/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(materialData),
    });
  },

  // 删除材质
  delete: async (id) => {
    return apiRequest(`/materials/${id}`, {
      method: 'DELETE',
    });
  },

  export: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/materials/export${queryString ? `?${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  import: async (payload) => {
    return apiRequest('/materials/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

// 库存API
export const stockAPI = {
  // 获取库存批次列表
  getLots: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/stock/lots${queryString ? `?${queryString}` : ''}`;
    const response = await apiRequest(endpoint);
    return response.items || response || [];
  },

  // 获取单个批次
  getLotById: async (id) => {
    return apiRequest(`/stock/lots/${id}`);
  },

  // 创建库存批次
  createLot: async (lotData) => {
    return apiRequest('/stock/lots', {
      method: 'POST',
      body: JSON.stringify(lotData),
    });
  },

  // 更新库存批次
  updateLot: async (id, lotData) => {
    return apiRequest(`/stock/lots/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(lotData),
    });
  },

  // 删除库存批次
  deleteLot: async (id) => {
    return apiRequest(`/stock/lots/${id}`, {
      method: 'DELETE',
    });
  },

  // 库存操作（入库、出库、调整）
  inventoryTransaction: async (transactionData) => {
    return apiRequest('/stock/inventory/txns', {
      method: 'POST',
      body: JSON.stringify(transactionData),
    });
  },

  getTransactions: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/stock/inventory/txns${queryString ? `?${queryString}` : ''}`;
    const response = await apiRequest(endpoint);
    return response.items || response || [];
  },

  export: async (params = {}) => {
    const queryString = buildQuery(params);
    const endpoint = `/stock/export${queryString ? `?${queryString}` : ''}`;
    return apiRequest(endpoint);
  },

  importLots: async (payload) => {
    return apiRequest('/stock/import', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export default apiRequest;
