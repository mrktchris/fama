'use strict';

// Transcript text can contain credentials copied into a prompt, tool output,
// or an agent message. Fama remains free to display that text locally, but a
// recognized credential should never be sent to an optional cloud narration
// provider or copied into a diagnostic log.
const SENSITIVE_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}\b/g,
];

function redactSensitiveText(value) {
  let text = String(value == null ? '' : value);
  for (const pattern of SENSITIVE_PATTERNS) text = text.replace(pattern, '[redacted credential]');
  return text;
}

module.exports = { redactSensitiveText };
