let cooldownUntil = 0;
let lastError = null;

function isInCooldown() {
  return Date.now() < cooldownUntil;
}

function cooldownRemainingSeconds() {
  return Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
}

function triggerCooldown(minutes = 5, reason = '') {
  cooldownUntil = Date.now() + minutes * 60 * 1000;
  lastError = reason;
  console.warn(`[sessionCooldown] Cooling down for ${minutes}min: ${reason}`);
}

function clearCooldown() {
  cooldownUntil = 0;
  lastError = null;
}

function cooldownInfo() {
  return {
    active: isInCooldown(),
    remainingSeconds: cooldownRemainingSeconds(),
    lastError,
  };
}

module.exports = { isInCooldown, triggerCooldown, clearCooldown, cooldownInfo };
