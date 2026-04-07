import { API_CONFIG } from '../constants';
import * as SecureStore from 'expo-secure-store';

// 获取认证token
const getAuthToken = async () => {
  try {
    return await SecureStore.getItemAsync('jwtToken');
  } catch (error) {
    console.error('获取token失败:', error);
    return null;
  }
};

// 通用API请求函数
const apiRequest = async (endpoint, options = {}) => {
  const token = await getAuthToken();
  const url = `${API_CONFIG.BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` }),
      ...options.headers,
    },
    ...options,
  };

  try {
    const response = await fetch(url, defaultOptions);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: '请求失败' }));
      const errorMessage = errorData.error || `HTTP ${response.status}`;
      const error = new Error(errorMessage);
      error.status = response.status;
      error.data = errorData;
      throw error;
    }

    return await response.json();
  } catch (error) {
    console.error('API请求失败:', error);
    throw error;
  }
};

// 订单API
export const ordersAPI = {
  // 获取订单列表
  getAll: async (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
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
    const queryString = new URLSearchParams(params).toString();
    const endpoint = `/orders/export${queryString ? `?${queryString}` : ''}`;
    return apiRequest(endpoint);
  },
};

// 模型API
export const modelsAPI = {
  // 获取模型列表
  getAll: async (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
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

  // 删除模型
  delete: async (id) => {
    return apiRequest(`/models/${id}`, {
      method: 'DELETE',
    });
  },
};

// 材质API
export const materialsAPI = {
  // 获取材质列表
  getAll: async (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
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
};

// 库存API
export const stockAPI = {
  // 获取库存批次列表
  getLots: async (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
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
};

export default apiRequest;

