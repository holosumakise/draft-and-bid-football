const { chromium } = require('playwright');
const BASE = 'http://127.0.0.1:8765/index.html';

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(`console: ${msg.text()}`); });
    page.on('response', res => { if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`); });

    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.click('text=Head to Head');
    await page.click('text=Play Locally');
    await page.click('button:has-text("Play")');
    await page.waitForSelector('#screen-game.active');
    await page.click('#btn-roll');
    await page.waitForTimeout(3400);
    await page.waitForSelector('.auction');

    const state = () => page.evaluate(() => ({
        highBid: gameState.auction && gameState.auction.highBid,
        highBidder: gameState.auction && gameState.auction.highBidderId,
        turn: gameState.auction && auctionCurrentBidderId(),
        order: gameState.auction && gameState.auction.order,
        out: gameState.auction && gameState.auction.out,
        sold: gameState.activeDraft && gameState.activeDraft.player.sold,
        squads: gameState.managers.map(m => m.squad.length)
    }));

    console.log('start', await state());
    await page.fill('#bid-entry-field', '20');
    console.log('raise enabled', await page.locator('#btn-bid-raise').isEnabled());
    await page.click('#btn-bid-raise');
    await page.waitForTimeout(400);
    console.log('after raise 20', await state());

    // Keyboard +5 for the next bidder.
    await page.keyboard.press('2');
    await page.waitForTimeout(400);
    console.log('after keyboard +5', await state());

    // Hold PASS for the next bidder.
    const pass = page.locator('.btn-pass').first();
    const box = await pass.boundingBox();
    if (!box) throw new Error('pass button missing');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(1100);
    await page.mouse.up();
    await page.waitForTimeout(600);
    console.log('after pass', await state());

    // The remaining leader should be able to buy.
    const buy = page.locator('button:has-text("BUY AT")').first();
    if (await buy.count()) {
        console.log('buy label', await buy.innerText());
        await buy.click();
        await page.waitForTimeout(2200);
        console.log('after buy', await state());
        console.log('sold stamp?', await page.locator('.draft-sold-stamp').count());
    } else {
        console.log('no buy button; panel text:', (await page.locator('.draft-reveal__side').innerText()).slice(0, 400));
    }

    console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
    await browser.close();
})().catch(err => { console.error('FATAL', err); process.exit(1); });
