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

  const secondDevice = await browser.newContext({ locale: 'en-GB' });
  await secondDevice.addCookies([
    { name: 'edutictac_oidc', value: 'alice', url: base, httpOnly: true },
  ]);
  const second = await secondDevice.newPage();
  await second.goto(base);
  await expect(second.getByText('Saved in my account', { exact: true })).toBeVisible();
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

  await secondDevice.clearCookies();
  await second.goto(editorUrl);
  await expect(
    second.getByRole('link', { name: 'Sign in with EduTicTac', exact: true }),
  ).toBeVisible();
  await expect(second.getByLabel('Question', { exact: true })).toHaveCount(0);
  for (const context of [alice, secondDevice, bob, audience]) await context.close();
});
