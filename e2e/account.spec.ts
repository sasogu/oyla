import { type ChildProcess, spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

let identity: Server;
let server: ChildProcess;
let base: string;
const root = fileURLToPath(new URL('../', import.meta.url));

test.beforeAll(async () => {
  identity = createServer((request, response) => {
    response.setHeader(
      'Content-Type',
      request.url?.endsWith('.js') ? 'text/javascript' : 'application/json',
    );
    if (
      request.url === '/api/internal/session/resolve' &&
      request.headers.authorization === 'Bearer e2e-only-application-token-not-a-secret'
    ) {
      const who = /edutictac_oidc=(alice|bob)/.exec(request.headers.cookie ?? '')?.[1];
      response.end(
        JSON.stringify(
          who
            ? { kind: 'oidc', sub: who, role: 'profesor', display_name: who }
            : { kind: 'anonymous' },
        ),
      );
    } else if (request.url?.startsWith('/assets/')) response.end('');
    else response.writeHead(404).end('{}');
  });
  await new Promise<void>((resolve) => identity.listen(0, '127.0.0.1', resolve));
  const authAddress = identity.address();
  if (!authAddress || typeof authAddress === 'string') throw new Error('No identity port');
  const reservation = createServer();
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const address = reservation.address();
  if (!address || typeof address === 'string') throw new Error('No app port');
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  base = `http://127.0.0.1:${address.port}`;
  server = spawn(process.execPath, ['packages/server/dist/index.js'], {
    cwd: root,
    stdio: 'ignore',
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(address.port),
      OYLA_DB_PATH: ':memory:',
      OYLA_LOG_LEVEL: 'silent',
      OYLA_CENTRAL_SESSION_URL: `http://127.0.0.1:${authAddress.port}`,
      OYLA_COMMONS_URL: `http://127.0.0.1:${authAddress.port}`,
      OYLA_PUBLIC_URL: base,
      OYLA_APP_TOKEN: 'e2e-only-application-token-not-a-secret',
      OYLA_APP_TOKEN_FILE: '',
    },
  });
  await expect
    .poll(async () => {
      try {
        return (await fetch(`${base}/api/health`)).status;
      } catch {
        return 0;
      }
    })
    .toBe(200);
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const ended = new Promise<void>((resolve) => server.once('exit', () => resolve()));
    server.kill('SIGTERM');
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      ended,
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          server.kill('SIGKILL');
          resolve();
        }, 5000);
      }),
    ]);
    if (timer) clearTimeout(timer);
  }
  if (identity) {
    identity.closeAllConnections();
    await new Promise<void>((resolve) => identity.close(() => resolve()));
  }
});

test('a teacher recovers a presentation on another device while participants need no account', async ({
  browser,
}) => {
  const alice = await browser.newContext({ locale: 'en-GB' });
  await alice.addCookies([{ name: 'edutictac_oidc', value: 'alice', url: base, httpOnly: true }]);
  const page = await alice.newPage();
  await page.goto(base);
  await page.getByRole('link', { name: 'Create presentation', exact: true }).click();
  await page.getByLabel('Name').fill('Saved in my account');
  await page.getByRole('button', { name: 'Create presentation' }).click();
  await expect(page.getByText('Saved in your EduTicTac account.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keep this link' })).toHaveCount(0);
  await page.getByRole('button', { name: /Multiple choice/ }).click();
  await page.getByLabel('Question', { exact: true }).fill('Can you vote?');
  await page.getByRole('textbox', { name: 'Option 1' }).fill('Yes');
  await page.getByRole('textbox', { name: 'Option 2' }).fill('No');
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  const editorUrl = page.url();
  const code =
    (await page.getByText(/Join code \d{3} \d{3}/).textContent())?.replace(/\D/g, '') ?? '';
  expect(editorUrl).not.toContain('#');
  const secondQuestion = await alice.request.post(
    `${base}/api/presentations/${editorUrl.split('/').pop()}/questions`,
    {
      headers: { Origin: base },
      data: { type: 'word-cloud', title: 'A word for today?' },
    },
  );
  expect(secondQuestion.ok()).toBe(true);

  const secondDevice = await browser.newContext({ locale: 'en-GB' });
  await secondDevice.addCookies([
    { name: 'edutictac_oidc', value: 'alice', url: base, httpOnly: true },
  ]);
  const second = await secondDevice.newPage();
  await second.goto(base);
  await expect(second.getByText('Saved in my account', { exact: true })).toBeVisible();
  await expect(second.getByText('Only in this browser', { exact: true })).toHaveCount(0);
  await expect(
    second.getByText('Recover a presentation with its private link', { exact: true }),
  ).toHaveCount(0);
  await second.getByRole('link', { name: 'Open', exact: true }).click();
  await expect(second.getByLabel('Question', { exact: true })).toHaveValue('Can you vote?');
  expect(
    await second.evaluate(() => JSON.parse(localStorage.getItem('oyla:my-presentations') ?? '[]')),
  ).toEqual([]);

  const bob = await browser.newContext({ locale: 'en-GB' });
  await bob.addCookies([{ name: 'edutictac_oidc', value: 'bob', url: base, httpOnly: true }]);
  const other = await bob.newPage();
  await other.goto(base);
  await expect(other.getByText('Saved in my account', { exact: true })).toHaveCount(0);
  await other.goto(editorUrl);
  await expect(
    other.getByRole('heading', { name: 'Sign in with the owner account' }),
  ).toBeVisible();
  await expect(other.getByRole('button', { name: 'Present', exact: true })).toHaveCount(0);

  await second.getByRole('button', { name: 'Present', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Can you vote?' })).toBeVisible();
  const audience = await browser.newContext({ locale: 'en-GB' });
  const phone = await audience.newPage();
  await phone.goto(base);
  await expect(phone.getByRole('link', { name: 'Create presentation', exact: true })).toHaveCount(
    0,
  );
  await phone.getByLabel('Join code').fill(code);
  await phone.getByRole('button', { name: 'Join', exact: true }).click();
  await phone.getByText('Yes', { exact: true }).click();
  await phone.getByRole('button', { name: 'Send vote' }).click();
  await expect(second.getByText('100%', { exact: true })).toBeVisible();

  // Account-owned sessions must reset over both WebSocket and the editor API.
  await second.getByRole('button', { name: 'Reset results', exact: true }).click();
  await expect(second.getByText('1 vote', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Click again to reset', exact: true }).click();
  await expect(second.getByText('0 votes', { exact: true })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Send vote', exact: true })).toBeVisible();
  await phone.getByText('Yes', { exact: true }).click();
  await phone.getByRole('button', { name: 'Send vote' }).click();
  await expect(second.getByText('100%', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 answer so far', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reset results', exact: true }).click();
  await page.getByRole('button', { name: 'Click again to reset', exact: true }).click();
  await expect(page.getByText('0 answers so far', { exact: true })).toBeVisible();

  await expect(second.getByText('0 votes', { exact: true })).toBeVisible();
  await phone.getByText('Yes', { exact: true }).click();
  await phone.getByRole('button', { name: 'Send vote' }).click();
  await expect(second.getByText('1 vote', { exact: true })).toBeVisible();
  await second.getByRole('button', { name: 'Next question', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'A word for today?' })).toBeVisible();
  await phone.getByLabel('Your answer').fill('Calm');
  await phone.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(phone.getByRole('heading', { name: 'Answer sent' })).toBeVisible();
  await expect(second.getByText('Calm: 1 answer', { exact: true })).toBeAttached();

  const id = editorUrl.split('/').pop();
  const counts = async () =>
    (await (await alice.request.get(`${base}/api/presentations/${id}`)).json()).questions.map(
      (q: { responseCount: number }) => q.responseCount,
    );
  expect(await counts()).toEqual([1, 1]);
  await second.getByRole('button', { name: 'Restart questionnaire', exact: true }).click();
  const restartDialog = second.getByRole('dialog', { name: 'Restart questionnaire' });
  await expect(restartDialog).toBeVisible();
  await restartDialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await counts()).toEqual([1, 1]);

  // A failed reset must be visible and must keep the confirmation open for a retry.
  await second.route(`${base}/api/presentations/${id}/reset`, (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'INTERNAL' } } }),
  );
  await second.getByRole('button', { name: 'Restart questionnaire', exact: true }).click();
  await restartDialog
    .getByRole('button', { name: 'Delete answers and restart', exact: true })
    .click();
  await expect(restartDialog.getByRole('alert')).toBeVisible();
  expect(await counts()).toEqual([1, 1]);
  await second.unroute(`${base}/api/presentations/${id}/reset`);
  await restartDialog
    .getByRole('button', { name: 'Delete answers and restart', exact: true })
    .click();
  await expect(restartDialog).not.toBeVisible();
  await expect(second.getByRole('heading', { name: 'Can you vote?' })).toBeVisible();
  await expect(second.getByText('0 votes', { exact: true })).toBeVisible();
  await expect(phone.getByRole('heading', { name: 'Can you vote?' })).toBeVisible();
  await expect(phone.getByRole('button', { name: 'Send vote', exact: true })).toBeVisible();
  expect(await counts()).toEqual([0, 0]);
  const restarted = await (await alice.request.get(`${base}/api/presentations/${id}`)).json();
  expect(restarted.joinCode).toBe(code);
  await phone.getByText('Yes', { exact: true }).click();
  await phone.getByRole('button', { name: 'Send vote' }).click();
  await expect(second.getByText('1 vote', { exact: true })).toBeVisible();

  await secondDevice.clearCookies();
  await second.goto(editorUrl);
  await expect(
    second.getByRole('link', { name: 'Sign in with EduTicTac', exact: true }),
  ).toBeVisible();
  await expect(second.getByLabel('Question', { exact: true })).toHaveCount(0);
  for (const context of [alice, secondDevice, bob, audience]) await context.close();
});

test('reset confirmation stays under the pointer in Spanish', async ({ browser }) => {
  const context = await browser.newContext({
    locale: 'es-ES',
    viewport: { width: 1366, height: 768 },
  });
  await context.addCookies([{ name: 'edutictac_oidc', value: 'alice', url: base, httpOnly: true }]);
  const created = await context.request.post(`${base}/api/presentations`, {
    headers: { Origin: base },
    data: { title: 'Reset confirmation' },
  });
  const { id } = await created.json();
  await context.request.post(`${base}/api/presentations/${id}/questions`, {
    headers: { Origin: base },
    data: { type: 'word-cloud', title: 'Reinicio' },
  });
  const page = await context.newPage();
  await page.goto(`${base}/present/${id}`);
  await expect(page.getByRole('heading', { name: 'Reinicio' })).toBeVisible();
  const reset = page.getByRole('button', { name: 'Reiniciar resultados', exact: true });
  const before = await reset.boundingBox();
  if (!before) throw new Error('Reset button is not visible');
  const x = before.x + before.width / 2;
  const y = before.y + before.height / 2;
  await page.mouse.click(x, y);
  const confirmation = page.getByRole('button', {
    name: 'Pulsa otra vez para reiniciar',
    exact: true,
  });
  await expect(confirmation).toBeVisible();
  const after = await confirmation.boundingBox();
  if (!after) throw new Error('Confirmation is not visible');
  expect(x).toBeGreaterThanOrEqual(after.x);
  expect(x).toBeLessThanOrEqual(after.x + after.width);
  expect(y).toBeGreaterThanOrEqual(after.y);
  expect(y).toBeLessThanOrEqual(after.y + after.height);
  await page.mouse.click(x, y);
  await expect(reset).toBeVisible();
  await context.close();
});
