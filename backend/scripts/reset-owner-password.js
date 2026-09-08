const bcrypt = require('bcryptjs');
const { withData, appendAudit, now, closeStore } = require('../utils/store');

const ownerId = process.argv[2];

const readHidden = (prompt) => new Promise((resolve, reject) => {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    reject(new Error('Password recovery requires an interactive terminal.'));
    return;
  }

  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';

  const finish = () => {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
    resolve(value);
  };

  process.stdin.on('data', function onData(character) {
    if (character === '\u0003') {
      process.stdin.setRawMode(false);
      reject(new Error('Cancelled'));
      return;
    }
    if (character === '\r' || character === '\n') {
      process.stdin.off('data', onData);
      finish();
      return;
    }
    if (character === '\u007f' || character === '\b') {
      value = value.slice(0, -1);
      return;
    }
    value += character;
  });
});

const validatePassword = (password) => {
  if (password.length < 12 || Buffer.byteLength(password, 'utf8') > 72) {
    throw new Error('Password must be at least 12 characters and at most 72 UTF-8 bytes.');
  }
};

const main = async () => {
  if (!ownerId) {
    throw new Error('Usage: node scripts/reset-owner-password.js OWNER_ID');
  }
  const first = await readHidden('New Owner password: ');
  const second = await readHidden('Confirm password: ');
  if (first !== second) throw new Error('Passwords do not match.');
  validatePassword(first);

  const result = await withData((data) => {
    const owner = data.users.find((user) => user.id === String(ownerId) && user.role === 'owner');
    if (!owner) return null;
    owner.passwordHash = bcrypt.hashSync(first, 12);
    owner.tokenVersion = (owner.tokenVersion || 0) + 1;
    owner.updatedAt = now();
    appendAudit(data, {
      actorId: 'host-console',
      entity: 'users',
      entityId: owner.id,
      action: 'owner.password.recover',
      diff: { tokenVersion: owner.tokenVersion },
    });
    return { id: owner.id, email: owner.email };
  });
  if (!result) throw new Error(`Owner ${ownerId} was not found.`);
  console.log(`Password reset for Owner ${result.id} (${result.email}). Existing sessions are invalid.`);
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(closeStore);
