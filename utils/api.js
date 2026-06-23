import { API_CONFIG } from '../constants';
import storage from './storage';

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
  endpoint === '/auth/login' || endpoint === '/auth/register'
);

// 获取认证token
const getAuthToken = async () => {
  try {
    return await storage.getItem('jwtToken');
  } catch (error) {
    console.warn('获取 token 失败:', error?.message || error);
    return null;
  }
};

const clearAuthToken = async () => {
  try {
    await storage.deleteItem('jwtToken');
  } catch (error) {
    console.warn('清除 token 失败:', error?.message || error);
  }
};

// 通用API请求函数
const apiRequest = async (endpoint, options = {}) => {
  const token = await getAuthToken();
  const url = `${API_CONFIG.BASE_URL}${endpoint}`;
  const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
  const { headers: optionHeaders = {}, ...requestOptions } = options;
  
  const defaultOptions = {
    ...requestOptions,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...optionHeaders,
    },
  };

  try {
    const response = await fetch(url, defaultOptions);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: '请求失败' }));
      const errorMessage = errorData.error || `HTTP ${response.status}`;
      const error = new Error(errorMessage);
      error.status = response.status;
      error.data = errorData;

      if (response.status === 401 && !isLoginEndpoint(endpoint)) {
        error.authRequired = true;
        await clearAuthToken();
        if (unauthorizedHandler) {
          unauthorizedHandler();
        }
      }

      throw error;
    }

    return await response.json();
  } catch (error) {
    if (!isAuthRequiredError(error)) {
      console.error('API请求失败:', error);
    }
    throw error;
  }
};

const buildQuery = (params = {}) => {
  const filteredParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  return new URLSearchParams(filteredParams).toString();
};

export const authAPI = {
  getToken: async () => getAuthToken(),

  login: async (credentials) => {
    const result = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    });
    if (result.token) {
      await storage.setItem('jwtToken', result.token);
    }
    return result;
  },

  register: async (userData) => {
    const result = await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
    if (result.token) {
      await storage.setItem('jwtToken', result.token);
    }
    return result;
  },

  me: async () => apiRequest('/auth/me'),

  logout: async () => {
    await storage.deleteItem('jwtToken');
  },
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

  uploadFile: async (file, metadata = {}) => {
    const formData = new FormData();
    Object.entries(metadata).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        formData.append(key, String(value));
      }
    });
    formData.append('file', file);
    return apiRequest('/models/upload', {
      method: 'POST',
      body: formData,
    });
  },

  addVersion: async (id, versionData) => {
    return apiRequest(`/models/${id}/versions`, {
      method: 'POST',
      body: JSON.stringify(versionData),
    });
  },
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
