import assert from "node:assert/strict";
import test from "node:test";
import { CITY_PRESETS, incomeProjection, expenseSchedule } from "../app/finance.ts";
import { parsePlan, serializePlan, planFilename, MAX_PLAN_BYTES } from "../app/plan.ts";

function fixture(mode = "couple") {
  const person = (id, cityKey) => ({
    id, name: id === "primary" ? "本人" : "伴侣", cityKey, config: { ...CITY_PRESETS[cityKey], housingRate: 0.07 },
    gross: id === "primary" ? 31555.5 : 15800, bonusMonths: 2.5, extraDeduction: 2200,
    autoBase: false, manualBases: { pension: 12500, medical: 13800, housing: 8000 },
    signingBonus: 30000, relocationGrant: 100000, equityGrant: 240000, equityVestingYears: 3,
    extraRealizationRate: 63.5,
  });
  return {
    householdMode: mode, calcMode: "reverse", primary: person("primary", "beijing"), partner: person("partner", "hohhot"),
    reverseOwner: "split", comparePersonId: "partner", expenseScenario: "custom",
    expenses: [
      { id: "a", name: "车贷", amount: 5400, frequency: "monthly", duration: 30, confirmed: true },
      { id: "b", name: "保险", amount: 5000, frequency: "annual", duration: 0, confirmed: false },
      { id: "c", name: "搬家", amount: 1200.5, frequency: "once", duration: 0, confirmed: true },
    ], savingsTarget: 8000, reserveTarget: 180000, initialSavings: 49999, horizon: 120,
  };
}

const savedAt = new Date("2026-09-04T12:34:56.789Z");
const documentFor = (state = fixture()) => JSON.parse(serializePlan(state, "双人测试", { salarySurplus: 1234.56 }, savedAt));

for (const mode of ["single", "couple"]) {
  test(`${mode}: all parameters round-trip, including the hidden partner`, () => {
    const state = fixture(mode);
    const loaded = parsePlan(serializePlan(state, "双人测试", { timeline: [] }, savedAt));
    assert.deepEqual(loaded.state, state);
    assert.equal(loaded.name, "双人测试");
    assert.equal(loaded.savedAt, savedAt.toISOString());
    for (const id of ["primary", "partner"]) {
      const args = (p) => ({ ...p, manualBases: p.autoBase ? undefined : p.manualBases });
      assert.deepEqual(incomeProjection(args(loaded.state[id])), incomeProjection(args(state[id])));
    }
  });
}

test("zeroes, empty expenses and both reverse targets survive", () => {
  for (const target of ["primary", "partner", "split"]) {
    const state = fixture();
    Object.assign(state, { expenses: [], calcMode: "forward", reverseOwner: target, savingsTarget: 0, reserveTarget: 0, initialSavings: 0, horizon: 36 });
    Object.assign(state.partner, { gross: 0, bonusMonths: 0, extraRealizationRate: 0 });
    assert.deepEqual(parsePlan(serializePlan(state, "", {}, savedAt)).state, state);
  }
});

test("UTF-8 BOM is accepted; result snapshots cannot override state", () => {
  const data = documentFor();
  data.results = { state: { primary: { gross: 999999 } } };
  data.state.unrecognized = "ignored";
  const loaded = parsePlan("\uFEFF" + JSON.stringify(data));
  assert.deepEqual(loaded.state, fixture());
  assert.equal(loaded.results, undefined);
});

test("rejects malformed, unrelated, too large and future-version files", () => {
  for (const text of ["not json", "姓名,工资", "null", "{}", "[]", " ".repeat(MAX_PLAN_BYTES + 1)]) assert.throws(() => parsePlan(text));
  for (const changes of [{ format: "another-app" }, { version: 2 }, { savedAt: "invalid" }, { name: "a".repeat(81) }]) {
    assert.throws(() => parsePlan(JSON.stringify({ ...documentFor(), ...changes })));
  }
});

test("invalid parameters are rejected without mutating the supplied state", () => {
  const mutations = [
    s => { s.partner = null; },
    s => { s.primary.gross = -1; },
    s => { s.primary.gross = "10000"; },
    s => { s.primary.gross = null; },
    s => { s.primary.extraRealizationRate = 101; },
    s => { s.primary.equityVestingYears = 0; },
    s => { s.primary.config.pensionMin = 1e9; },
    s => { s.primary.config.key = "hohhot"; },
    s => { s.primary.autoBase = "false"; },
    s => { s.expenses[0].duration = 1.5; },
    s => { s.expenses[0].frequency = "weekly"; },
    s => { s.expenses.push(s.expenses[0]); },
    s => { s.expenses = Array.from({ length: 501 }, (_, i) => ({ ...s.expenses[0], id: String(i) })); },
    s => { s.horizon = 999999; },
    s => { delete s.reverseOwner; },
  ];
  for (const mutate of mutations) {
    const data = documentFor();
    mutate(data.state);
    const before = structuredClone(data);
    assert.throws(() => parsePlan(JSON.stringify(data)));
    assert.deepEqual(data, before);
  }
});

test("non-finite data cannot be saved and filenames are safe", () => {
  for (const invalid of [NaN, Infinity, -Infinity]) {
    const state = fixture(); state.primary.gross = invalid;
    assert.throws(() => serializePlan(state, "测试", {}, savedAt));
  }
  const filename = planFilename("../北京:方案/一\\二", savedAt);
  assert.ok(filename.startsWith("家庭经济账-"));
  assert.ok(filename.endsWith(".json"));
  assert.ok(!/[\\/:]/.test(filename));
  assert.equal(parsePlan(serializePlan(fixture(), "   ", {}, savedAt)).name, "未命名方案");
});

test("existing v1 plans retain repayment entries and derive their real expiry", () => {
  const original = fixture();
  const loaded = parsePlan(serializePlan(original, "旧版车贷方案", { postLoanExpense: 999999 }, savedAt));
  assert.deepEqual(loaded.state.expenses, original.expenses);
  const schedule = expenseSchedule(loaded.state.expenses, loaded.state.horizon);
  assert.equal(schedule.nextMilestone.lastPaymentMonth, 30);
  assert.equal(schedule.nextMilestone.releaseMonth, 31);
  assert.deepEqual(schedule.nextMilestone.names, ["车贷"]);
  assert.equal(schedule.periodEndExpense, 5000 / 12);
});
