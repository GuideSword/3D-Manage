const operations = new Set();

export const cancelAllOperations = () => {
  for (const controller of operations) {
    try { controller.abort(); } catch (_) { /* epoch validation remains authoritative */ }
  }
  operations.clear();
};

export const registerRequestOperation = (captured, isCurrent, externalSignal) => {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', abortFromExternal, { once: true });
  }
  if (!isCurrent(captured)) controller.abort();
  operations.add(controller);
  return {
    controller,
    release: () => {
      operations.delete(controller);
      externalSignal?.removeEventListener?.('abort', abortFromExternal);
    },
  };
};
