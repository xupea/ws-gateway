const test = require('node:test');
const assert = require('node:assert/strict');

const subscriptionManager = require('../dist/subscription/manager');

function createWs() {
  const userData = { subscriptions: new Map() };
  return {
    sent: [],
    getUserData() {
      return userData;
    },
    send(payload) {
      this.sent.push(JSON.parse(payload));
    },
  };
}

test('reusing the same subscription id replaces the old topic binding', () => {
  subscriptionManager.__resetForTests();
  const ws = createWs();

  assert.equal(subscriptionManager.subscribe('ws.available-balances', 'sub-1', ws), true);
  assert.equal(subscriptionManager.subscribe('ws.notifications', 'sub-1', ws), true);

  subscriptionManager.publish('ws.available-balances', { amount: 1 });
  assert.equal(ws.sent.length, 0);

  subscriptionManager.publish('ws.notifications', { amount: 2 });
  assert.equal(ws.sent.length, 1);
  assert.deepEqual(ws.sent[0], {
    id: 'sub-1',
    type: 'next',
    payload: { data: { amount: 2 } },
  });
});

test('unsubscribeAll removes all tracked subscriptions for a connection', () => {
  subscriptionManager.__resetForTests();
  const ws = createWs();

  subscriptionManager.subscribe('ws.available-balances', 'sub-1', ws);
  subscriptionManager.subscribe('ws.notifications', 'sub-2', ws);
  assert.equal(subscriptionManager.size(), 2);

  subscriptionManager.unsubscribeAll(ws);
  assert.equal(subscriptionManager.size(), 0);
  assert.equal(ws.getUserData().subscriptions.size, 0);
});
