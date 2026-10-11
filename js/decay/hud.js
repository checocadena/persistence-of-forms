// Debug HUD — D toggles it. Off by default; visitors never see it.

export function createHud(read) {
  const el = document.createElement('pre');
  el.style.cssText = [
    'position:fixed', 'right:10px', 'bottom:10px', 'z-index:2000', 'margin:0',
    'padding:8px 10px', 'background:rgba(0,0,0,0.7)', 'color:#9f9',
    'font:11px/1.45 ui-monospace,Menlo,monospace', 'pointer-events:none',
    'white-space:pre', 'display:none',
  ].join(';');
  document.body.appendChild(el);

  let visible = false;
  let timer = 0;
  const update = () => { el.textContent = read(); };

  return {
    toggle() {
      visible = !visible;
      el.style.display = visible ? 'block' : 'none';
      clearInterval(timer);
      if (visible) { update(); timer = setInterval(update, 250); }
    },
  };
}
