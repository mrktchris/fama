'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DesktopNotifications } = require('../desktop/desktop-notifications');

function fixture() {
  const delivered = [];
  const timers = new Map();
  let nextTimer = 0;
  let now = 1000;
  const notifications = new DesktopNotifications({
    deliver: (title, body) => delivered.push({ title, body }),
    now: () => now,
    setTimer: (callback) => {
      const id = nextTimer++;
      timers.set(id, callback);
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    idleMs: 10,
    minEvents: 2,
    cooldownMs: 100,
  });
  return {
    delivered,
    notifications,
    timers,
    advance(milliseconds) {
      now += milliseconds;
    },
    runLatestTimer() {
      const id = Math.max(...timers.keys());
      const callback = timers.get(id);
      assert.equal(typeof callback, 'function');
      timers.delete(id);
      callback();
    },
  };
}

test('Desktop Notifications requires a delivery Adapter', () => {
  assert.throws(() => new DesktopNotifications(), /delivery Adapter/);
});

test('Desktop Notifications debounces Session activity and labels the provider', () => {
  const state = fixture();
  state.notifications.handle({ kind: 'tool', sessionId: 'one', provider: 'codex' });
  const firstTimer = [...state.timers.keys()][0];
  state.notifications.handle({ kind: 'result', sessionId: 'one', provider: 'codex' });
  assert.equal(state.timers.has(firstTimer), false);
  state.runLatestTimer();
  assert.deepEqual(state.delivered, [
    { title: 'Fama · Idle', body: "Codex's gone quiet after some activity." },
  ]);
});

test('Desktop Notifications enforces one global idle cooldown across Sessions', () => {
  const state = fixture();
  for (const sessionId of ['one', 'two']) {
    state.notifications.handle({ kind: 'tool', sessionId, provider: 'claude' });
    state.notifications.handle({ kind: 'result', sessionId, provider: 'claude' });
  }
  state.runLatestTimer();
  state.runLatestTimer();
  assert.equal(state.delivered.length, 1);

  state.advance(100);
  state.notifications.handle({ kind: 'tool', sessionId: 'three', provider: 'claude' });
  state.notifications.handle({ kind: 'result', sessionId: 'three', provider: 'claude' });
  state.runLatestTimer();
  assert.equal(state.delivered.length, 2);
});

test('Desktop Notifications reports errors immediately and reset cancels pending idle work', () => {
  const state = fixture();
  state.notifications.handle({ kind: 'system', sessionId: 'ignored' });
  state.notifications.handle({ kind: 'error', detail: 'Tool failed' });
  state.notifications.handle({ kind: 'tool', sessionId: 'pending' });
  state.notifications.handle({ kind: 'result', sessionId: 'pending' });
  state.notifications.reset();
  assert.equal(state.timers.size, 0);
  assert.deepEqual(state.delivered, [{ title: 'Fama · Error', body: 'Tool failed' }]);
});
