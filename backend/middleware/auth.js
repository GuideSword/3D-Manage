const jwt = require('jsonwebtoken');
const { withData } = require('../utils/store');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const publicUser = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  active: user.active !== false,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
});

const readToken = (req) => String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');

const authenticate = async (req) => {
  const token = readToken(req);
  if (!token) {
    return null;
  }

  const payload = jwt.verify(token, JWT_SECRET);
  const user = await withData((data) => data.users.find((item) => item.id === String(payload.sub)), { write: false });
  if (!user || user.active === false) {
    return null;
  }

  return publicUser(user);
};

const requireAuth = async (req, res, next) => {
  try {
    const user = await authenticate(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const requireRoles = (...roles) => async (req, res, next) => {
  try {
    const user = await authenticate(req);
    if (!user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.user = user;
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

module.exports = {
  requireAuth,
  requireRoles,
  publicUser,
};
