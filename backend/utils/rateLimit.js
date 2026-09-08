const createFailureLimiter = ({
  maxEnv,
  windowEnv,
  defaultMax = 5,
  defaultWindowMs = 60_000,
}) => {
  const attempts = new Map();

  const getConfig = () => ({
    max: Math.max(1, Number.parseInt(process.env[maxEnv], 10) || defaultMax),
    windowMs: Math.max(1, Number.parseInt(process.env[windowEnv], 10) || defaultWindowMs),
  });

  const getKey = (req, discriminator = '') => `${req.ip || req.socket?.remoteAddress || 'unknown'}:${discriminator}`;

  const current = (key) => {
    const entry = attempts.get(key);
    if (!entry) return null;
    if (entry.resetAt <= Date.now()) {
      attempts.delete(key);
      return null;
    }
    return entry;
  };

  const isBlocked = (key) => {
    const entry = current(key);
    return Boolean(entry && entry.count >= getConfig().max);
  };

  const recordFailure = (key) => {
    const config = getConfig();
    const entry = current(key) || { count: 0, resetAt: Date.now() + config.windowMs };
    entry.count += 1;
    attempts.set(key, entry);
  };

  const reset = (key) => attempts.delete(key);

  const reject = (res) => res.status(429).json({
    code: 'RATE_LIMITED',
    error: 'Too many failed attempts. Try again later.',
  });

  return { getKey, isBlocked, recordFailure, reset, reject };
};

module.exports = { createFailureLimiter };
