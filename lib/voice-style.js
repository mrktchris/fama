'use strict';

// A useful accent instruction needs more than a label. Voice-design models respond
// better to an explicit description of cadence, delivery, and what to avoid. Keep
// this respectful and non-caricatured: "Dominican" is a direction, not a joke voice.
const DOMINICAN_ENGLISH_STYLE =
  'Speak in warm, natural Dominican-American English with an authentic Dominican cadence and subtle Caribbean Spanish influence. Keep the delivery clear, confident, relaxed, and conversational; never exaggerated, comedic, or stereotyped.';

function voiceStyleInstructions(value) {
  const style = String(value || '').trim();
  if (!style) return '';

  if (/^dominican(?:[- ]american)?(?: english)?$/i.test(style)) {
    return DOMINICAN_ENGLISH_STYLE;
  }

  // Short labels under-steer instruction-following TTS models. Expand them into
  // a complete directive while preserving longer, intentionally authored prompts.
  return style.split(/\s+/).length <= 3
    ? `Speak with a ${style} accent and tone, natural and clearly audible, not subtle.`
    : style;
}

module.exports = { DOMINICAN_ENGLISH_STYLE, voiceStyleInstructions };
