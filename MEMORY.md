# Project memory

## 2026-11-04 — Complete card-system/UI handoff

- Scope: continue the approved Soccer Guru-inspired card/UI work using CSS and inline SVG silhouettes, initials and shirt numbers. Use only `C:\Users\steal\AGENTS.md`; ignore Downloads AGENTS/personality files per the user's handoff.
- Already present when inspected: updated menu/game markup, cards.js load order, cards in draft/squad/details/picker, scout strip, five formations, MAX bid, auction keyboard shortcuts, draft/clock CSS classes and cards.js in the service worker and syntax-check script. The pasted handoff predates these changes.
- Completed now: fixed card-modal chemistry counting the inspected starter twice; preserved OVR over 100 in the picker; stopped Enter/Space on the picker's info button from assigning the player; fixed picker horizontal overflow at narrow mobile widths.
- Added `test/cards.test.js` using the actual config/card source: tier boundaries, starter chemistry, scouting chemistry, keeper labels/high stats, escaping and missing metadata. Added it to `npm test`.
- Build ID: `2026-11-04.5`; service-worker cache: `dbf-shell-v8` (includes cards.js).
- Removed the obsolete `preview.html` as requested. Existing `tmp-flow-test.js`, `tmp-ui-test.js` and screenshots are retained.
- Verified: `npm test` (23 passed); `npm run check`; browser checks for draft acquisition, squad/details, picker info by keyboard, all five formations, save/resume, MAX, +5 shortcut, hold PASS and purchase; no page JavaScript errors. Layout checks at 320/390/768px and desktop 1440px passed, including picker inner overflow. Offline reload/local draft rendered SVG cards and stats from shell v8 successfully.
- Browser verification scripts/backups and selected screenshots are in the Codex chat workspace's `work/` and `outputs/` directories, outside this project. Existing UI scripts were also run successfully; their initial squad count log occurs before the acquisition animation completes.
- In progress: none for this handoff. Next: optional real multi-device online smoke test; Firebase room synchronization was not exercised in this session.
- Decisions: preserve existing vanilla-JS architecture and online DOM IDs; no new libraries, no commit or deployment.

## 2026-11-04 — Manual roll/reroll and untimed bidding

- User requested manual Roll/Reroll and typed bidding for each manager. User explicitly approved immediate Reroll cancelling the active auction, then supplied `C:\Users\steal\Downloads\ali` as the reference and confirmed: preserve ali's roll behavior, with no auction time limit.
- Compared source against ali: `teamHasGK`, `allEligibleTeamsHaveGK`, position-group/fit/need/weight functions, `rollPlayers` and `runDraftReel` match after ignoring comments/whitespace. Kept those algorithms/animation timings; ali itself was only read.
- Added host/local Reroll control: cancel unresolved bids and reveal a new player, without charging wallets or spending skips. Disabled during spin/acquisition animation, after sale, for guests or locked/full teams; an exhausted usable pool leaves the current auction intact.
- Removed auction deadlines, ticking/expiration, automatic final-bid purchase, presence-triggered auto-pass/purchase and forced pickup when skips run out. Bid/Pass/Buy remain explicit; after settlement the next Roll waits for a click. Prices still respect minimum bid and XI budget reserve. Online clients wait without a clock; a disconnected bidder can stall until reconnect or host Reroll.
- Updated auction serialization, reset/cleanup paths, bid input label and in-game guide. Header wraps to fit Roll/Reroll on mobile. Build `2026-11-04.6`, service-worker shell `dbf-shell-v9`.
- Added six actual-source regression tests in `test/draft-controls.test.js`; `npm test`: 29 passed. `npm run check`: passed.
- Browser verified at 320/390/1440px: typed bid remains after 10 seconds; both managers can submit custom amounts; immediate Reroll clears old bids without money/squad changes; explicit Buy charges the confirmed amount; next roll does not start automatically. No page JavaScript errors. Screenshot and browser script in the Codex chat workspace `outputs/` and `work/`.
- In progress: none for this request. Next: optional real multi-device online validation; room synchronization was not exercised against Firebase.

## 2026-11-04 — One price box per manager, entered by the host

- User clarified the desired auction UI: four players means four price fields visible together, all entered by the presenter. This supersedes the previous single-input, turn-based auction UI. The provided ali folder currently has a single-input auction too; implemented the user's explicit four-field description in socce.
- New auctions use `hostManaged: true`. Local presenter or online host enters every manager's bid and presses Confirm auction. A unique highest bid wins at that entered price. Blank/0 means pass; all pass explicitly discards the player. Tied highest bids require edited prices before settlement. No deadline or automatic next roll.
- Validates all bids before changing wallets: whole non-negative amounts, minimum bid, squad/lock eligibility and current maximum including XI reserve. Only the winner pays. A second confirmation cannot charge again. Online guests see a waiting message and cannot submit either confirmation or legacy turn actions.
- Rendered four labeled fields for four managers (including disabled boxes for ineligible teams), two for H2H; solo retains Take/Skip. Preserves typed prices through dashboard rerenders and clears them on Reroll. Uses a two-column desktop grid and one-column phone grid with 44px inputs.
- Updated auction serialization, online note, guide, build `2026-11-04.7` and cache `dbf-shell-v10`.
- Verified: npm test (32 passed), npm run check; browser test of Play with four managers, all four fields, preserved values, tied bids, over-budget rejection, Reroll clearing inputs, highest-bid settlement and winner-only charge, all-pass discard, locked field, simulated host/guest role guards and widths 320/390/768/1440px. No page errors. Real multi-device Firebase testing remains unperformed.
- Screenshots: Codex chat workspace outputs/socce-host-auction-desktop.png and outputs/socce-host-auction-mobile.png. Browser script: work/verify-host-bids.cjs. In progress: none.

## 2026-11-04 — Merge mid-season functionality from mid section

- User requested adding the mid section changes to the current socce game. Imported the reference season.js after verifying socce's previous season source matched ali exactly. Patched only the related resume, serialization and online-chart lines in game.js/net.js/online.js; retained the card UI, manual roll/reroll and host-managed price fields.
- Multiplayer leagues now display rounds 1–19 on the season chart, pause at Halfway / Matchday 19, open the transfer window, then simulate rounds 20–38 after the host closes it. Halfway charts keep the final-results button hidden. Solo has no eligible trading partners and continues through 38 rounds as before.
- Save/resume now handles a live halfway seasonRun even when the transfer snapshot is still null (saved while the chart was showing). Online season snapshots include midSeason and guests bound their chart replay to 19 or 38 accordingly.
- Did not import the source's Z/X/Space turn-bidding shortcuts: that single-input turn auction has been superseded by the user's explicitly requested host-entered price boxes.
- Added test/mid-season.test.js for chart limits/navigation, display-before-transfer ordering, halfway resume and restored transfer data. npm test: 37 passed; npm run check: passed.
- Browser verified using the actual league engine and valid drafted squads: two-manager first-half chart -> transfer market -> 38 completed rounds; reload from a saved halfway chart without a transfer snapshot -> market -> exactly 38 rounds with the original 19 results preserved; solo completes 38 without a market. No page JavaScript errors. Serialized midSeason flag checked; no real multi-device Firebase session exercised.
- Build 2026-11-04.8, service-worker dbf-shell-v11. Backups in the Codex chat workspace work/before-mid-season; browser verification work/verify-mid-season.cjs; screenshots outputs/socce-mid-season-chart.png and outputs/socce-mid-season-transfers.png.
- In progress: none for this merge. Next: optional real multi-device online smoke test.

## 2026-11-04 — Author gameplay restored; UI-only scope now authoritative

- User corrected the overall scope: preserve the original author's gameplay and change UI only; explicitly asked to continue. This supersedes previous requests/interpretations for host-entered prices, untimed auctions, immediate Reroll and extra formation presets.
- Used the author's latest provided `C:\Users\steal\Downloads\mid section` as the gameplay baseline, retaining its mid-season feature and original Z/X/Enter/Space shortcuts.
- Restored game.js, net.js, online.js, season.js from that baseline verbatim. Verified byte equality for those files plus match-engine.js, engine-core.js, transfers.js, save.js and players.js. Config matches the baseline except deployment BUILD_ID. Auction state-transition/keyboard source before the presentation section matches verbatim. Draft selection/spin code matches apart from skip-label text/CSS.
- Returned to one turn-specific price input, 9-second shot clock, original timeout pass/buy, reserve constraints, shared skip spending and random pickup at zero skips. Removed hostManaged/host-price fields, immediate Reroll and added formation-switch logic. Config now has only the author's 4-4-2 preset.
- Retained presentation improvements: new menu/game shell, card renderings, squad/detail modal, picker cards/filters, chemistry-line visualization, responsive styles. Updated in-game Roll/Bid/Online help to the author's instructions. Do not alter gameplay rules in future UI work unless explicitly reauthorized.
- Replaced superseded manual-auction regression cases with actual-source tests for original controls. npm test: 35 passed; npm run check: passed. Browser verified Play, original bid input/countdown, Enter/Z/X/hold-Space, purchase, squad/card modal, timeout and layouts at 320/390/1440px, with no page errors. Real multi-device Firebase testing remains unperformed.
- Build 2026-11-04.9; cache dbf-shell-v12. Prior modified files backed up in the Codex chat workspace work/before-original-gameplay. Browser script work/verify-original-ui.cjs; screenshot outputs/socce-original-play-new-ui.png.
- In progress: none. Current scope: UI only, preserving mid section gameplay.

## 2026-11-04 — Card portrait and shirt detail, UI only

- User requested hair and jersey logos/details on card characters. Updated only cards.js, index.html and service-worker cache metadata.
- Replaced the dark featureless bust with a simple illustrated face, five stable decorative hair variants, neck shading and detailed jerseys. Added club-colored stripes/hoops/sash where mapped, collars, sleeve trim, seams, chest crest, a small DB kit mark, shirt number and initials.
- Chest crests are local stylized SVG shields using club colors/abbreviations, not official crest-image assets. Hair variants are decorative avatars, not claimed real-player likenesses. No external portrait/logo images or libraries added. Unique SVG clip IDs prevent repeated cards of the same player interfering with each other.
- Verified npm test (35 passed), npm run check, browser rendering of six club kits and xl/md/sm sizes, hair/crest/number presence and unique clip IDs; no page errors. SHA-256 checks confirmed every gameplay JS file unchanged. Cache dbf-shell-v13.
- Preview outputs/socce-card-hair-kits.png; browser script work/preview-card-art.cjs; backups and gameplay hash manifest work/before-card-detail in the Codex chat workspace.
- In progress: none. Continue preserving author gameplay.

## 2026-11-04 — Varied card expressions

- User clarified that the requested face work means diverse expressions across characters. Added six decorative SVG expressions: joyful, smiling, determined, winking, celebrating and confident, varying eyebrows, eyes, mouths and cheek tint.
- Expression choice is stable per player name, independent of hair style. It does not follow match state or affect stats/gameplay. Edited only cards.js and cache metadata (dbf-shell-v14).
- Verified npm test (35 passed), npm run check and browser rendering of all six expressions plus xl/md/sm card sizes; no page errors or external images. Preview outputs/socce-card-expressions.png, script work/preview-card-expressions.cjs in the Codex chat workspace.
- In progress: none; scope remains UI only.

## 2026-11-04 — Rarity-specific card characters

- User requested recognizable character details from Elite upward, Invincible stars and cooler GOAT poses. Added visual rarity layers without changing rating thresholds, stats or any gameplay files.
- Gold retains the existing illustrated portrait. Elite adds a cyan headband, captain band, blue aura and diamond insignia. Invincible adds three stars on the card, violet headband/star, captain band, geometric aura and a raised-fist pose. GOAT adds a gold portrait crown, laurel/aura, gold armband/wrist trim, confident/determined expression and stable per-player crossed-arms or raised-finger pose. Removed a duplicated GOAT corner crown after visual review to avoid overlap.
- Inline SVG remains offline and supports xl/md/sm. Artwork tier follows the rendered card tier; SVG IDs remain unique. Changes limited to cards.js, index.html and cache metadata dbf-shell-v15.
- Verified npm test (35 passed), npm run check, browser checks of tier features, exact three Invincible stars, distinct pose metadata, small cards and widths 320/390/768px; no page errors. Gameplay hashes still match the UI-only baseline.
- Preview outputs/socce-rarity-characters.png; browser script work/preview-rarity-art.cjs; backups work/before-rarity-art in the Codex chat workspace. In progress: none.

## 2026-11-04 — Pose-specific torso/arm proportions

- User found the added hands awkward and requested matching the body to the arms. Rebuilt posed jerseys with a narrower athletic torso and separate shoulder/sleeve silhouettes for raised fist, crossed arms and raised finger, replacing the original down-sleeve shapes for those poses.
- Redrew continuous upper-arm/elbow/forearm contours, smaller wrists and hands, resting arms, sleeve cuffs and wristbands. Normal Gold/Elite portraits retain their existing body outline. This is artwork only; edited cards.js and cache metadata dbf-shell-v16.
- Verified npm test (35 passed), npm run check, browser rarity/small-card/mobile rendering with no page errors, and visually inspected all three posed variants. Preview outputs/socce-poses-body-adjusted.png; script work/preview-adjusted-poses.cjs in the Codex chat workspace.
- In progress: none; gameplay remains unchanged.
