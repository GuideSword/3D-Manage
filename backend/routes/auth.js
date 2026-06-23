const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const router = express.Router();
const { withData, nextId, appendAudit, now } = require('../utils/store');
const { publicUser } = require('../middleware/auth');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

const issueToken = (user) => jwt.sign(
  { sub: user.id, email: user.email, role: user.role },
  JWT_SECRET,
  { expiresIn: TOKEN_EXPIRES_IN }
);

const ensureDefaultOwner = (data) => {
  if (data.users.length > 0) {
    return null;
  }

  const password = process.env.ADMIN_PASSWORD || 'Admin123456';
  const owner = {
    id: nextId(data.users),
    email: normalizeEmail(process.env.ADMIN_EMAIL || 'admin@example.com'),
    name: process.env.ADMIN_NAME || 'Admin',
    role: 'owner',
    active: true,
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: now(),
    updatedAt: now(),
  };
  data.users.push(owner);
  appendAudit(data, {
    actorId: owner.id,
    entity: 'users',
    entityId: owner.id,
    action: 'seed.defaultOwner',
    diff: { email: owner.email, role: owner.role },
  });
  return owner;
};

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
    const password = String(req.body.password || '');
    const validationError = validateCredentials({ email, password });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const result = await withData((data) => {
      ensureDefaultOwner(data);
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
      return user;
    });

    if (!result) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    return res.json({
      token: issueToken(result),
      user: publicUser(result),
    });
  } catch (error) {
    console.error('Login failed:', error);
    return res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/register', async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const validationError = validateCredentials({ email, password });
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const created = await withData((data) => {
      ensureDefaultOwner(data);
      if (data.users.some((item) => item.email === email)) {
        return { status: 409, body: { error: 'Email already registered' } };
      }

      const requestedRole = req.body.role === 'viewer' ? 'viewer' : 'staff';
      const user = {
        id: nextId(data.users),
        email,
        name: String(req.body.name || email.split('@')[0]).trim(),
        role: requestedRole,
        active: true,
        passwordHash: bcrypt.hashSync(password, 10),
        createdAt: now(),
        updatedAt: now(),
      };
      data.users.push(user);
      appendAudit(data, {
        actorId: user.id,
        entity: 'users',
        entityId: user.id,
        action: 'register',
        diff: { email: user.email, role: user.role },
      });

      return {
        status: 201,
        body: {
          token: issueToken(user),
          user: publicUser(user),
        },
      };
    });

    return res.status(created.status).json(created.body);
  } catch (error) {
    console.error('Register failed:', error);
    return res.status(500).json({ error: 'Register failed' });
  }
});

router.get('/me', async (req, res) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const payload = jwt.verify(token, JWT_SECRET);
    const user = await withData((data) => data.users.find((item) => item.id === String(payload.sub)), { write: false });
    if (!user || user.active === false) {
      return res.status(401).json({ error: 'User not found' });
    }

    return res.json({ user: publicUser(user) });
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
