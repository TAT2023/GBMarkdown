import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

assert.ok(process.env.GBM_CDP_URL, 'A dedicated native QA window is required');
const readerPid = Number(process.env.GBM_QA_PID);
assert.ok(Number.isSafeInteger(readerPid) && readerPid > 0, 'GBM_QA_PID must identify the QA process');
const browser = await chromium.connectOverCDP(process.env.GBM_CDP_URL);
try {
  const page = browser.contexts()[0].pages().find(p => /tauri|localhost/.test(p.url()));
  assert.ok(page);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.locator('.native-titlebar').waitFor();
  const state = command => page.evaluate(command => window.__TAURI_INTERNALS__.invoke(`plugin:window|${command}`, { label: 'main' }), command);
  const maximized = value => page.waitForFunction(async value => (await window.__TAURI_INTERNALS__.invoke('plugin:window|is_maximized', { label: 'main' })) === value, value);
  assert.equal(await state('is_decorated'), false, 'There must be no second OS titlebar');
  if (await state('is_maximized')) {
    await page.getByRole('button', { name: '还原窗口', exact: true }).click();
    await maximized(false);
  }
  await page.getByRole('button', { name: '最大化窗口', exact: true }).click();
  await maximized(true);
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await maximized(false);
  // Exercise Tauri's double-click handler through the actual titlebar drag region.
  await page.locator('.titlebar-drag').dispatchEvent('mousedown', { button: 0, buttons: 1, detail: 2 });
  await maximized(true);
  await page.getByRole('button', { name: '还原窗口', exact: true }).click();
  await maximized(false);
  await page.getByRole('button', { name: '最小化窗口', exact: true }).click();
  await page.waitForFunction(() => window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' }), undefined, { polling: 100 });
  // Restore the explicitly identified QA window through Windows without granting
  // extra window permissions to the production frontend just for testing.
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RestoreQaWindow { [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int command); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd); }';
    $qa = Get-Process -Id ${readerPid} -ErrorAction Stop;
    if ($qa.ProcessName -ne 'GBMarkdown') { throw 'Unexpected QA process' }
    [RestoreQaWindow]::ShowWindow($qa.MainWindowHandle, 9) | Out-Null;
    [RestoreQaWindow]::SetForegroundWindow($qa.MainWindowHandle) | Out-Null;
  `], { windowsHide: true });
  await page.waitForFunction(async () => !(await window.__TAURI_INTERNALS__.invoke('plugin:window|is_minimized', { label: 'main' })), undefined, { polling: 100 });
  await page.screenshot({ path: 'artifacts/titlebar-native-controls.png' });
  assert.equal(await page.locator('.notice.error').count(), 0);
  assert.deepEqual(errors, []);
  const closed = page.waitForEvent('close');
  await page.getByRole('button', { name: '关闭窗口', exact: true }).click();
  await closed;
  console.log('Native titlebar checks passed: no OS caption, maximize, restore, double-click, minimize and close.');
} finally {
  await browser.close();
}
