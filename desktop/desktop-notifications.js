'use strict';

const DEFAULT_IDLE_MS = 90000;
const DEFAULT_MIN_EVENTS = 8;
const DEFAULT_COOLDOWN_MS = 120000;

class DesktopNotifications {
  constructor(options) {
    if (!options || typeof options.deliver !== 'function') {
      throw new TypeError('Desktop Notifications requires a delivery Adapter.');
    }
    this._deliver = options.deliver;
    this._now = options.now || Date.now;
    this._setTimer = options.setTimer || setTimeout;
    this._clearTimer = options.clearTimer || clearTimeout;
    this._idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this._minEvents = options.minEvents ?? DEFAULT_MIN_EVENTS;
    this._cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this._sessions = new Map();
    this._lastIdleNotificationAt = null;
  }

  handle(event) {
    if (!event || typeof event !== 'object' || event.kind === 'system') return;
    if (event.kind === 'error') {
      this._deliver('Fama · Error', event.detail || event.label || 'Something went wrong in a session.');
      return;
    }

    const sessionId = event.sessionId;
    if (!sessionId) return;
    let activity = this._sessions.get(sessionId);
    if (!activity) {
      activity = { count: 0, provider: null, timer: null };
      this._sessions.set(sessionId, activity);
    }
    if (event.provider) activity.provider = event.provider;
    activity.count += 1;
    if (activity.timer !== null) this._clearTimer(activity.timer);
    activity.timer = this._setTimer(() => this._settle(sessionId, activity), this._idleMs);
  }

  reset() {
    for (const activity of this._sessions.values()) {
      if (activity.timer !== null) this._clearTimer(activity.timer);
    }
    this._sessions.clear();
  }

  _settle(sessionId, activity) {
    if (this._sessions.get(sessionId) !== activity) return;
    this._sessions.delete(sessionId);
    activity.timer = null;
    if (activity.count < this._minEvents) return;

    const now = this._now();
    if (
      this._lastIdleNotificationAt !== null &&
      now - this._lastIdleNotificationAt < this._cooldownMs
    ) {
      return;
    }
    this._lastIdleNotificationAt = now;
    const agent = activity.provider === 'codex' ? 'Codex' : activity.provider === 'buzz' ? 'BUZZ' : 'Claude';
    this._deliver('Fama · Idle', `${agent}'s gone quiet after some activity.`);
  }
}

module.exports = {
  DEFAULT_COOLDOWN_MS,
  DEFAULT_IDLE_MS,
  DEFAULT_MIN_EVENTS,
  DesktopNotifications,
};
