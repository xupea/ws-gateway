const test = require('node:test');
const assert = require('node:assert/strict');

const connectionManager = require('../dist/connection/manager');

function createWs() {
  return {
    sent: [],
    ended: [],
    send(payload) {
      this.sent.push(JSON.parse(payload));
    },
    end(code, reason) {
      this.ended.push({ code, reason });
    },
  };
}

test('sendToUser delivers the payload to each local socket exactly once', () => {
  connectionManager.__resetForTests();
  const ws1 = createWs();
  const ws2 = createWs();

  connectionManager.add('user-1', ws1);
  connectionManager.add('user-1', ws2);

  const delivered = connectionManager.sendToUser('user-1', {
    type: 'user',
    userId: 'user-1',
    event: 'balance_update',
    data: { balance: 99 },
  });

  assert.equal(delivered, true);
  assert.equal(ws1.sent.length, 1);
  assert.equal(ws2.sent.length, 1);
});

test('closeUser closes all sockets owned by a user', () => {
  connectionManager.__resetForTests();
  const ws1 = createWs();
  const ws2 = createWs();

  connectionManager.add('user-1', ws1);
  connectionManager.add('user-1', ws2);
  connectionManager.closeUser('user-1', 4409, 'logged in elsewhere');

  assert.deepEqual(ws1.ended, [{ code: 4409, reason: 'logged in elsewhere' }]);
  assert.deepEqual(ws2.ended, [{ code: 4409, reason: 'logged in elsewhere' }]);
});
