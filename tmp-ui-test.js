const { chromium } = require('playwright');

const BASE = 'http://127.0.0.1:8765/index.html';
const errors = [];

async function newPage(browser, viewport) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    await page.goto(BASE, { waitUntil: 'networkidle' });
    return page;
}

async function screenshot(page, name) {
    await page.screenshot({ path: name, fullPage: true });
    console.log('shot', name);
}

async function startSolo(page) {
    await page.click('text=Tournament');
    await page.click('text=Play Locally');
    await page.selectOption('#player-count', '1');
    await page.click('button:has-text("Play")');
    await page.waitForSelector('#screen-game.active');
    await page.waitForTimeout(400);
}

async function startH2H(page) {
    await page.click('text=Head to Head');
    await page.click('text=Play Locally');
    await page.click('button:has-text("Play")');
    await page.waitForSelector('#screen-game.active');
    await page.waitForTimeout(400);
}

(async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
        // --- Solo: reveal, squad, card modal, picker ---
        const solo = await newPage(browser, { width: 1440, height: 1000 });
        await screenshot(solo, 'shots-solo-menu.png');
        await startSolo(solo);
        await screenshot(solo, 'shots-solo-game-empty.png');

        await solo.click('#btn-roll');
        await solo.waitForTimeout(3400);
        await solo.waitForSelector('.draft-reveal');
        await screenshot(solo, 'shots-solo-reveal.png');

        const cardCount = await solo.locator('.draft-reveal .pcard').count();
        console.log('reveal cards:', cardCount);
        const playerName = await solo.locator('.draft-reveal .pcard__name').innerText();
        console.log('revealed player:', playerName);

        await solo.click('button:has-text("Take Player")');
        await solo.waitForTimeout(600);
        const squadRows = await solo.locator('.squad-row').count();
        console.log('squad rows after take:', squadRows);

        await solo.click('.squad-row');
        await solo.waitForSelector('#card-modal.is-open');
        await screenshot(solo, 'shots-card-modal.png');
        const modalName = await solo.locator('#card-modal-name').innerText();
        console.log('card modal name:', modalName);
        await solo.click('#card-modal .modal-close');
        await solo.waitForTimeout(300);

        // Open the picker on the first empty pitch slot.
        await solo.click('#pitch-1 .pitch-node__add');
        await solo.waitForSelector('#player-modal.is-open');
        await screenshot(solo, 'shots-picker.png');
        const pickerCards = await solo.locator('#modal-player-list .picker-card').count();
        console.log('picker cards:', pickerCards);
        await solo.click('#picker-filters .picker-filter:nth-child(2)');
        const gkCards = await solo.locator('#modal-player-list .picker-card').count();
        console.log('picker GK cards:', gkCards);
        await solo.click('#player-modal .modal-close');

        // Formation switch should keep the squad and update the pitch.
        const beforeFormation = await solo.locator('#m1-formation-hint').innerText();
        await solo.selectOption('#formation-1', '4-3-3');
        await solo.waitForTimeout(400);
        const afterFormation = await solo.locator('#m1-formation-hint').innerText();
        const formationValue = await solo.inputValue('#formation-1');
        console.log('formation:', formationValue, 'hint before/after:', JSON.stringify(beforeFormation), JSON.stringify(afterFormation));
        await screenshot(solo, 'shots-solo-formation.png');
        await solo.context().close();

        // --- H2H: auction panel, max bid, mobile ---
        const h2h = await newPage(browser, { width: 1440, height: 1000 });
        await startH2H(h2h);
        await h2h.click('#btn-roll');
        await h2h.waitForTimeout(3400);
        await h2h.waitForSelector('.auction');
        await screenshot(h2h, 'shots-h2h-auction.png');

        const clock = await h2h.locator('#auction-clock').innerText();
        const bidVisible = await h2h.locator('#bid-entry-field').count();
        const maxVisible = await h2h.locator('button:has-text("MAX")').count();
        console.log('auction clock:', clock, 'bid field:', bidVisible, 'max btn:', maxVisible);

        if (bidVisible) {
            await h2h.fill('#bid-entry-field', '25');
            const raiseEnabled = await h2h.locator('#btn-bid-raise').isEnabled();
            console.log('raise enabled after typing 25:', raiseEnabled);
            await h2h.click('button:has-text("MAX")');
            const maxVal = await h2h.inputValue('#bid-entry-field');
            console.log('max bid value:', maxVal);
        }

        await h2h.context().close();

        const mobile = await newPage(browser, { width: 390, height: 844 });
        await startH2H(mobile);
        await mobile.click('#btn-roll');
        await mobile.waitForTimeout(3400);
        await mobile.waitForSelector('.draft-reveal');
        await screenshot(mobile, 'shots-h2h-mobile-reveal.png');
        await mobile.context().close();

        console.log('ERRORS:', errors.length ? JSON.stringify(errors, null, 2) : 'none');
    } finally {
        await browser.close();
    }
})().catch(err => {
    console.error('FATAL', err);
    process.exit(1);
});
