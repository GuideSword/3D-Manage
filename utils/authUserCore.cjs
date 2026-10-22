'use strict';
// Legacy /auth/me wraps its user; the relational endpoint returns the public user directly.
function authenticatedUser(result) {
  const candidate = result && Object.hasOwn(result, 'user') ? result.user : result;
  if (!candidate || typeof candidate.id !== 'string' || !candidate.id || !['owner', 'staff', 'viewer'].includes(candidate.role)) return null;
  return candidate;
}
module.exports = { authenticatedUser };
