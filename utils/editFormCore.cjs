const isPositiveNumber = (value) => ['number', 'string'].includes(typeof value)
  && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0;

const orderToForm = (order) => ({
  form: {
    customerName: order.customer?.name || '',
    customerEmail: order.customer?.email || '',
    customerPhone: order.customer?.phone || '',
    dueDate: order.dueDate ? new Date(`${String(order.dueDate).slice(0, 10)}T00:00:00`) : null,
    currency: order.currency || 'CNY',
    notes: order.notes || '',
  },
  items: (order.items || []).map((item) => ({
    ...item,
    modelId: String(item.modelId || item.modelName || ''),
    color: ['金色', '红色'].includes(item.color) ? item.color : '其它颜色',
    customColor: ['金色', '红色'].includes(item.color) ? '' : item.color || '',
    quantity: String(item.quantity ?? ''),
    unitPrice: String(item.unitPrice ?? ''),
  })),
});

const formToOrderItems = (items, models) => {
  const usedIds = new Set(items.filter((item) => item.id).map((item) => String(item.id)));
  let nextId = 1;
  return items.map((item) => {
    const model = models.find((entry) => String(entry.id) === String(item.modelId) || entry.name === item.modelId);
    const { customColor, ...record } = item;
    const quantity = Number(item.quantity);
    const unitPrice = Number(item.unitPrice);
    while (usedIds.has(String(nextId))) nextId += 1;
    const id = item.id ? String(item.id) : String(nextId++);
    usedIds.add(id);
    return {
      ...record,
      id,
      modelName: item.modelName || model?.name || item.modelId || '',
      color: item.color === '其它颜色' ? customColor.trim() : item.color,
      quantity,
      unitPrice,
      subtotal: quantity * unitPrice,
    };
  });
};

module.exports = { isPositiveNumber, orderToForm, formToOrderItems };
