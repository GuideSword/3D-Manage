// 格式化工具函数

/**
 * 格式化文件大小
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/**
 * 格式化日期
 * @param {string|Date} date - 日期字符串或Date对象
 * @param {string} format - 格式类型 ('short' | 'long' | 'full')
 * @returns {string} 格式化后的日期
 */
export const formatDate = (date, format = 'short') => {
  const d = new Date(date);

  if (format === 'short') {
    return d.toLocaleDateString('zh-CN');
  } else if (format === 'long') {
    return d.toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } else if (format === 'full') {
    return d.toLocaleString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  return d.toLocaleDateString('zh-CN');
};

/**
 * 格式化货币
 * @param {number} amount - 金额
 * @param {string} currency - 货币代码 (默认: 'CNY')
 * @returns {string} 格式化后的货币字符串
 */
export const formatCurrency = (amount, currency = 'CNY') => {
  const formatter = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: currency,
  });

  return formatter.format(amount);
};

/**
 * 格式化数量
 * @param {number} quantity - 数量
 * @param {string} unit - 单位
 * @returns {string} 格式化后的数量字符串
 */
export const formatQuantity = (quantity, unit = '') => {
  if (quantity >= 1000) {
    return `${(quantity / 1000).toFixed(1)}k${unit}`;
  }
  return `${quantity}${unit}`;
};

/**
 * 截断文本
 * @param {string} text - 原始文本
 * @param {number} maxLength - 最大长度
 * @returns {string} 截断后的文本
 */
export const truncateText = (text, maxLength = 50) => {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
};

/**
 * 格式化订单状态
 * @param {string} status - 状态代码
 * @returns {Object} 包含标签和颜色的状态对象
 */
export const formatOrderStatus = (status) => {
  const statusMap = {
    draft: { label: '草稿', color: '#8E8E93' },
    pending_review: { label: '待审核', color: '#FF9500' },
    in_progress: { label: '执行中', color: '#007AFF' },
    completed: { label: '已完成', color: '#34C759' },
    cancelled: { label: '已取消', color: '#FF3B30' },
  };

  return statusMap[status] || { label: '未知', color: '#8E8E93' };
};

/**
 * 格式化库存状态
 * @param {string} status - 状态代码
 * @returns {Object} 包含标签和颜色的状态对象
 */
export const formatStockStatus = (status) => {
  const statusMap = {
    in_stock: { label: '在库', color: '#34C759' },
    scrapped: { label: '报废', color: '#FF3B30' },
    frozen: { label: '冻结', color: '#FF9500' },
  };

  return statusMap[status] || { label: '未知', color: '#8E8E93' };
};


