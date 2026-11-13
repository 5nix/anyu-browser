// Just enough CDP to read Cave's state, run code in a page, click and take a picture during tests.
export async function devtoolsPort(log, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const m = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(log());
    if (m) return Number(m[1]);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no DevTools port');
}

/** Opens a CDP session on the page whose URL matches and hands `fn` a `send(method, params)`. */
export async function listTargets(port) {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).map(({ id, type, url }) => ({ id, type, url }));
}

export async function withTarget(port, match, fn) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === 'page' && (typeof match === 'function' ? match(t.url) : t.id === match.targetId));
  if (!target) throw new Error(`no target among ${targets.map((t) => t.url).join(', ')}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
  const waiting = new Map();
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    waiting.get(msg.id)?.(msg);
  };
  // A page that goes away (the app quits, the tab closes) answers nothing more.
  ws.onclose = () => { for (const reply of waiting.values()) reply({ error: { message: 'target closed' } }); };
  let id = 0;
  const send = async (method, params = {}) => {
    const reply = new Promise((r) => waiting.set(++id, r));
    ws.send(JSON.stringify({ id, method, params }));
    const msg = await reply;
    if (msg.error) throw new Error(`${method}: ${msg.error.message}`);
    return msg.result;
  };
  try {
    return await fn(send);
  } finally {
    ws.close();
  }
}

const run = async (send, expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
  return result.result.value;
};

export const evaluate = (port, match, expression) => withTarget(port, match, (send) => run(send, expression));

/**
 * Presses and releases the mouse at the middle of the element, the way a user does: the page
 * hit-tests the point itself, so a control that something covers does not get the click. Fails
 * unless the element (or something inside it) is what the page finds at that point.
 * This is hit-testing inside one page; whether the window delivers the press to that page at
 * all (drag regions, views stacked above it) is not covered here.
 */
export const click = (port, match, selector) =>
  withTarget(port, match, async (send) => {
    const at = await run(send, `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return { error: 'not found' };
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !el.contains(hit)) return { error: 'covered by ' + (hit ? hit.tagName + '#' + hit.id + '.' + hit.className : 'nothing') };
      return { x, y };
    })()`);
    if (at.error) throw new Error(`${selector}: ${at.error}`);
    const event = { x: at.x, y: at.y, button: 'left', clickCount: 1 };
    await send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed' });
    await send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased' });
  });

/** PNG of the page as it is drawn now, for looking at a UI change. */
export const screenshot = (port, match) =>
  withTarget(port, match, async (send) => Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

export const gateState = (port) => evaluate(port, (u) => u.endsWith('/shell.html'), 'cave.getState().then((s) => s.gate.state)');

export async function waitFor(fn, ms = 20000, every = 200) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, every));
  }
  throw new Error(`timed out; last: ${last}`);
}

export const rightClick = (port, match, x, y) => withTarget(port, match, async send => {
  const event = { x, y, button: 'right', clickCount: 1 };
  await send('Input.dispatchMouseEvent', { ...event, type: 'mousePressed' });
  await send('Input.dispatchMouseEvent', { ...event, type: 'mouseReleased' });
});
export const key = (port, match, key, modifiers = 0) => withTarget(port, match, async send => {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, modifiers });
});
