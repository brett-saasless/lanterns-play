import { PROMPTS, DOCK_PROMPTS } from './script.js';

export const TOUCH_PROMPTS = Object.freeze({ clock: Object.freeze({ set: 'Set time' }) });

export function interactPrompt(focus, touch) {
  if (!focus) return '';
  const verb = focus.kind === 'bowl' && !focus.ready ? 'speak' : focus.verb;
  const word = (touch && TOUCH_PROMPTS[focus.kind]?.[verb]) || PROMPTS[verb] || DOCK_PROMPTS[verb];
  if (!word) return '';
  return touch ? word : `E  ${word}`;
}
