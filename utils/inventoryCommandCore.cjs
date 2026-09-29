const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => value[key] !== undefined).map((key) => [key, stableValue(value[key])]));
  return value;
};

const isValidGramQuantity = (value, { allowZero = false } = {}) => {
  if (!['string', 'number'].includes(typeof value)) return false;
  const text = String(value).trim();
  if (text.length > 32 || !/^\d+(?:\.\d{1,3})?$/.test(text)) return false;
  const [whole, fraction = ''] = text.split('.');
  const mg = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(mg) && (allowZero ? mg >= 0 : mg > 0);
};

// Keep the same key after an ambiguous transport failure. A 4xx response proves
// that this command was rejected; success locks this form until it is closed.
const createInventoryCommandController = (createKey) => {
  let pending = null;
  let busy = false;
  let complete = false;
  return {
    async run(operation, payload, scope, send) {
      if (busy || complete) return null;
      const fingerprint = JSON.stringify(stableValue({ operation, payload, scope }));
      if (pending && pending.fingerprint !== fingerprint) {
        throw Object.assign(new Error('上次库存操作结果尚未确认，请恢复原内容并重试；切换账号或服务器后请重新打开页面'), { code: 'INVENTORY_RETRY_PENDING' });
      }
      if (!pending) pending = { fingerprint, key: createKey(), payload: JSON.parse(JSON.stringify(payload)) };
      busy = true;
      try {
        const result = await send(pending.payload, pending.key);
        complete = true;
        return result;
      } catch (error) {
        if (error.status >= 400 && error.status < 500) pending = null;
        throw error;
      } finally {
        busy = false;
      }
    },
  };
};

module.exports = { createInventoryCommandController, isValidGramQuantity };
