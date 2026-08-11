#!/usr/bin/env node
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const pathToExtension = path.join(__dirname, '.output/chrome-mv3');
  const userDataDir = '/tmp/test-user-data-dir3';

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${pathToExtension}`,
      `--load-extension=${pathToExtension}`,
    ],
  });

  const page = await context.newPage();

  page.on('console', msg => {
    if (
      msg.text().includes('AI Context Tracker') ||
      msg.text().includes('crashed') ||
      msg.text().includes('[Adapter')
    ) {
      console.log(`[PAGE LOG] ${msg.text()}`);
    }
  });

  await page.goto('https://chatgpt.com', { waitUntil: 'networkidle' });
  await new Promise(resolve => setTimeout(resolve, 2000));

  console.log('Injecting mock messages...');
  await page.evaluate(() => {
    let main = document.querySelector('main');
    if (!main) {
      main = document.createElement('main');
      document.body.appendChild(main);
    }

    const msg1 = document.createElement('div');
    msg1.setAttribute('data-message-author-role', 'user');
    msg1.innerText = 'Hello, AI!';
    main.appendChild(msg1);

    const msg2 = document.createElement('div');
    msg2.setAttribute('data-message-author-role', 'assistant');
    msg2.innerText = 'Hello, User! How can I help you?';
    main.appendChild(msg2);
  });

  console.log('Waiting 5 seconds for background processing...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  console.log('Checking widget token state...');
  const widgetTokens = await page.evaluate(() => {
    const shadow = document.querySelector('ai-context-tracker-widget')?.shadowRoot;
    if (!shadow) return 'NO WIDGET';
    const meter = shadow.querySelector('.text-\[14px\]\.font-bold');
    return meter ? meter.textContent : 'METER NOT FOUND';
  });

  console.log(`Widget Token Count Display: ${widgetTokens}`);

  await context.close();
})();
