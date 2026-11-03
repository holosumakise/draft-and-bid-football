// ============================================================
// ENGINE CORE — pure maths shared by the live match engine, the league
// simulator and the headless balance lab (sim/lab.js).
//
// Nothing in here touches the DOM or Firebase, so the same formulas that
// decide a live match also decide a league table and a lab run. That is the
// single source of truth for goal rates and the ATT/MID/DEF strength split.
// ============================================================

(function (root) {
    const EngineCore = {};

    EngineCore.clamp = function (value, min, max) {
        return Math.max(min, Math.min(max, value));
    };

    // Knuth's method. Kept identical to the league simulator's old sampler.
    EngineCore.samplePoisson = function (lambda) {
        const limit = Math.exp(-Math.max(0, lambda));
        let k = 0, p = 1;
        do { k++; p *= Math.random(); } while (p > limit && k < 24);
        return k - 1;
    };

    // Which line of the team a slot belongs to. Matches POSITION_META.unit.
    EngineCore.unitOf = function (pos) {
        if (pos === 'GK' || pos === 'CB' || pos === 'LB' || pos === 'RB' || pos === 'LWB' || pos === 'RWB') return 'def';
        if (pos === 'CDM' || pos === 'CM' || pos === 'CAM' || pos === 'LM' || pos === 'RM') return 'mid';
        return 'att';
    };

    // entries: [{ pos, ovr }]. Returns the overall average plus one average
    // per line. Missing lines fall back to the overall so a 10-man XI or a
    // formation with no recognised midfielders still produces a usable number.
    EngineCore.strengthBreakdown = function (entries) {
        const list = (entries || []).filter(entry => entry && Number.isFinite(entry.ovr));
        if (!list.length) return { overall: 0, att: 0, mid: 0, def: 0, count: 0 };

        const buckets = { def: [], mid: [], att: [] };
        let total = 0;
        list.forEach(entry => {
            total += entry.ovr;
            buckets[EngineCore.unitOf(entry.pos)].push(entry.ovr);
        });
        const average = values => values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null;
        const overall = total / list.length;
        return {
            overall,
            att: average(buckets.att) ?? overall,
            mid: average(buckets.mid) ?? overall,
            def: average(buckets.def) ?? overall,
            count: list.length
        };
    };

    // Positive means team A's attack has the better of team B's defence once
    // both directions are netted off. This is what makes a lopsided XI (great
    // strikers, weak defenders) different from a balanced one with the same OVR.
    EngineCore.matchupEdge = function (a, b) {
        if (!a || !b) return 0;
        return (a.att - b.def) - (b.att - a.def);
    };

    // Expected goals for one match. `edge` is the matchup edge; `base` is the
    // expected goals for an average side; `coefficient` converts strength
    // points into goals.
    EngineCore.expectedGoals = function ({ edge = 0, base, coefficient = 0.016, homeAdvantage = 0 } = {}) {
        const diff = edge * coefficient;
        return {
            lambdaA: EngineCore.clamp(base + diff + homeAdvantage, 0.2, 4.5),
            lambdaB: EngineCore.clamp(base - diff - homeAdvantage * 0.5, 0.2, 4.5)
        };
    };

    // The live engine rolls one minute at a time. Opening-minute caution and
    // the quiet spell after a goal remove roughly 12% of raw chances, so the
    // per-minute rate is divided by that factor to land on the same 90-minute
    // total the league simulator uses.
    EngineCore.LIVE_DAMPENER = 0.88;
    EngineCore.goalChancePerMinute = function (base, dampener = EngineCore.LIVE_DAMPENER) {
        return (base / 90) / Math.max(0.5, dampener);
    };

    // Shared by the lab and any quick "what if" checks.
    EngineCore.simulateScore = function (lambdaA, lambdaB) {
        return {
            goalsA: EngineCore.samplePoisson(Math.max(0.05, lambdaA)),
            goalsB: EngineCore.samplePoisson(Math.max(0.05, lambdaB))
        };
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = EngineCore;
    root.EngineCore = EngineCore;
})(typeof window !== 'undefined' ? window : globalThis);
