import { readFileSync } from 'node:fs';
import { setImmediate as flushEvents } from 'node:timers/promises';
import { runInNewContext } from 'node:vm';

const loginHtml = readFileSync(new URL('../login.html', import.meta.url), 'utf8');
const authScript = readFileSync(new URL('../js/main.js', import.meta.url), 'utf8');

function loadLoginPage() {
  const elements = {};
  for (const [tag, id] of loginHtml.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    elements[id] = Object.assign(new EventTarget(), {
      value: '',
      required: /\srequired(?:\s|=|>)/.test(tag),
      disabled: /\sdisabled(?:\s|=|>)/.test(tag),
      parentElement: { hidden: false, style: {} }
    });
  }

  const document = new EventTarget();
  document.getElementById = (id) => elements[id] || null;
  const api = {
    request: vi.fn().mockResolvedValue({}),
    clearCurrentUser: vi.fn()
  };
  const window = { location: { href: 'login.html' } };
  runInNewContext(authScript, { document, AnchorApi: api, window });
  document.dispatchEvent(new Event('DOMContentLoaded'));

  return { elements, api, window };
}

// These checks exercise the page script and its events. Browser constraint
// validation itself needs a real browser; it is not simulated by this fixture.
test('initial login excludes the empty name from validation and sends credentials', async () => {
  const { elements, api, window } = loadLoginPage();
  const name = elements['auth-name'];
  expect(name.value).toBe('');
  expect(name.disabled).toBe(true);
  expect(name.required).toBe(false);
  expect(name.parentElement.hidden).toBe(true);

  elements['auth-email'].value = ' reader@example.com ';
  elements['auth-password'].value = 'password123';
  elements['auth-form'].dispatchEvent(new Event('submit', { cancelable: true }));
  await flushEvents();

  expect(api.request).toHaveBeenCalledWith('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'reader@example.com', password: 'password123' })
  });
  expect(api.clearCurrentUser).toHaveBeenCalledOnce();
  expect(window.location.href).toBe('search.html');
});

test('register mode requires a name and returning to login excludes it again', async () => {
  const { elements, api } = loadLoginPage();
  const name = elements['auth-name'];
  const toggle = elements['toggle-auth'];

  toggle.dispatchEvent(new Event('click', { cancelable: true }));
  expect(name.disabled).toBe(false);
  expect(name.required).toBe(true);
  expect(name.parentElement.hidden).toBe(false);
  expect(elements['auth-submit'].innerText).toBe('签 署');

  name.value = ' 读者甲 ';
  elements['auth-email'].value = 'reader@example.com';
  elements['auth-password'].value = 'password123';
  elements['auth-form'].dispatchEvent(new Event('submit', { cancelable: true }));
  await flushEvents();
  expect(api.request).toHaveBeenLastCalledWith('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ displayName: '读者甲', email: 'reader@example.com', password: 'password123' })
  });

  name.value = '';
  toggle.dispatchEvent(new Event('click', { cancelable: true }));
  expect(name.disabled).toBe(true);
  expect(name.required).toBe(false);
  expect(name.parentElement.hidden).toBe(true);
  expect(elements['auth-submit'].innerText).toBe('落 座');

  elements['auth-form'].dispatchEvent(new Event('submit', { cancelable: true }));
  await flushEvents();
  expect(api.request).toHaveBeenLastCalledWith('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'reader@example.com', password: 'password123' })
  });
  expect(api.request).toHaveBeenCalledTimes(2);
});
