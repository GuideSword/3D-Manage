const assert = require('node:assert/strict');
const { normalizeServerUrl, ServerAddressError } = require('./serverAddress');

const cases = [
  ['192.168.1.10:5000', 'http://192.168.1.10:5000/api'],
  ['https://manage.example.com', 'https://manage.example.com/api'],
  ['https://MANAGE.example.com/api/', 'https://manage.example.com/api'],
  ['http://10.0.0.5:8080/', 'http://10.0.0.5:8080/api'],
  ['[fd00::1]:5000', 'http://[fd00::1]:5000/api'],
  ['https://[2001:db8::1]:5443/api', 'https://[2001:db8::1]:5443/api'],
];

for (const [input, expected] of cases) {
  assert.equal(normalizeServerUrl(input), expected, input);
}

for (const input of [
  '',
  '   ',
  'ftp://example.com',
  'https://user:password@example.com',
  'https://example.com?secret=1',
  'https://example.com/#fragment',
  'https://example.com/manage/api',
  'https://example.com:70000',
]) {
  assert.throws(() => normalizeServerUrl(input), ServerAddressError, input);
}

console.log('Server address verification passed');
