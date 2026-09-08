const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const { withData, appendAudit, now } = require('../utils/store');
const { publicUser, requireAuth } = require('../middleware/auth');
const { issueToken } = require('../utils/authTokens');
const { createFailureLimiter } = require('../utils/rateLimit');

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const loginLimiter = createFailureLimiter({
  maxEnv: 'LOGIN_RATE_LIMIT_MAX',
  windowEnv: 'LOGIN_RATE_LIMIT_WINDOW_MS',
});

const validateCredentials = ({ email, password }) => {
  if (!normalizeEmail(email)) {
    return 'Email is required';
  }
  if (!password || String(password).length < 8) {
    return 'Password must be at least 8 characters';
  }
  return null;
};

router.post('/login', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const limiterKey = loginLimiter.getKey(req, email);
    if (loginLimiter.isBlocked(limiterKey)) {
      return loginLimiter.reject(res);
    }
    const password = String(req.body.password || '');
    const validationError = validateCredentials({ email, password });
    if (validationError) {
      loginLimiter.recordFailure(limiterKey);
      return res.status(400).json({ error: validationError });
    }

    const result = await withData((data) => {
      if (!data.system.initializedAt) {
        return { notInitialized: true };
      }
      const user = data.users.find((item) => item.email === email);
      if (!user || user.active === false || !bcrypt.compareSync(password, user.passwordHash)) {
        return null;
      }
      user.lastLoginAt = now();
      appendAudit(data, {
        actorId: user.id,
        entity: 'users',
        entityId: user.id,
        action: 'login',
        diff: { email: user.email },
      });
      return { user, serverId: data.system.serverId };
    });

    if (result?.notInitialized) {
      return res.status(409).json({
        code: 'SYSTEM_NOT_INITIALIZED',
        error: 'System is not initialized',
      });
    }
    if (!result) {
      loginLimiter.recordFailure(limiterKey);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    loginLimiter.reset(limiterKey);
    return res.json({
      token: issueToken(result.user, result.serverId),
      user: publicUser(result.user),
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ user: req.user });
});

module.exports = router;
