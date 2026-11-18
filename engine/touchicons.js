// The touch buttons' pictures (owner: a flintlock pistol for swap, a book for the log, a leaping figure for jump,
// a firing pistol for FIRE, a person for health). Inline SVG drawn in currentColor, static and trusted: nothing
// here is built from user text. Each is a 24-high picture; touchui.js sets one as a button's innerHTML.

const PISTOL = '<g fill="currentColor" transform="translate(.8 -.6)">'
  + '<rect x="8.5" y="6.2" width="14.6" height="2.4" rx=".4"/><path d="M21.2 5.2h2.6v4.4h-2.6l.5-1.1v-2.2z"/>' // a long barrel, the muzzle flared
  + '<path d="M6.5 8.6h4.2v2.4H7z"/>' // the lock
  + '<path d="M8.6 8.6c-.4-1.6-1.6-2.2-2.4-3.2l1.8-1.6c.6.9 1.9 1.4 2.5 3.4l.4 1.4z"/><path d="M5 4.4l1.8-1.7 1.3 1.2-1.8 1.7z"/>' // the cock, bold, with its flint
  + '<path d="M10.5 8.6h6.5l.6 1.6h-6.2l-1.1 1.3c-.4 2.3-.9 4.7-2 6.3l-.5 1.1c-.6.9-2 1-2.9.3-.8-.7-.8-1.7-.4-2.6l1.9-6.3c.1-.6-.2-1-.8-1.4l1.4-1.2z"/>' // stock and curved butt
  + '<circle cx="5" cy="19.2" r="1.9"/>' // the ball pommel
  + '<path d="M10.6 11.5q2.4 3.2 5-.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' // trigger guard
  + '</g>';

const svg = (w, body) => `<svg viewBox="0 0 ${w} 24" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = Object.freeze({
  swap: svg(24, PISTOL),
  fire: svg(32, `${PISTOL}<path d="M23.9 7.6l3-3.2.4 3 3.1-.9-2.2 2.4 2.2 2.4-3.1-.9-.4 3-3-3.2z" fill="currentColor"/>`),
  log: svg(24, '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M2 4.5c3.2-1.3 7-1.1 10 1.2 3-2.3 6.8-2.5 10-1.2v14.6c-3.2-1.3-7-1.1-10 1.2-3-2.3-6.8-2.5-10-1.2z"/><path d="M12 5.7v14.6"/></g>'),
  jump: svg(24, '<circle cx="12" cy="4" r="2.4" fill="currentColor"/><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8.6v6"/><path d="M12 9.8L6.6 5.2M12 9.8l5.4-4.6"/><path d="M12 14.6L8 18.2l-1.6 3M12 14.6l4 3.6 1.6 3"/></g>'),
  health: svg(24, '<g fill="currentColor"><circle cx="12" cy="6.2" r="3.6"/><path d="M4.8 20.5c0-4.2 3.2-7 7.2-7s7.2 2.8 7.2 7z"/></g>'),
});
