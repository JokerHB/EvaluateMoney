import assert from "node:assert/strict";
import test from "node:test";
import { expenseAtMonth, expenseSchedule, HOHHOT_EXPENSES, BEIJING_EXPENSES } from "../app/finance.ts";

const expense = (id, amount, duration = 0, frequency = "monthly") => ({ id, name: id, amount, duration, frequency, confirmed: true });

test("no expenses or no loans: no artificial expiry or month-30 checkpoint", () => {
  const empty = expenseSchedule([], 60);
  assert.deepEqual(empty.milestones, []);
  assert.equal(empty.nextMilestone, null);
  assert.equal(empty.insightMonth, 12);
  assert.equal(empty.periodEndExpense, 0);
  const everyday = [expense("生活费", 3500), expense("搬家", 9000, 0, "once")];
  assert.equal(expenseAtMonth(everyday, 1), 12500);
  const schedule = expenseSchedule(everyday, 60);
  assert.deepEqual(schedule.milestones, []);
  assert.equal(schedule.periodEndExpense, 3500);
});

test("city presets have no assumed loan payments", () => {
  for (const preset of [HOHHOT_EXPENSES, BEIJING_EXPENSES]) {
    assert.ok(!preset.some(item => /loan|贷|欠款/.test(item.id + item.name)));
    assert.deepEqual(expenseSchedule(preset, 120).milestones, []);
  }
});

test("mortgage beyond the horizon remains included and has no visible early release", () => {
  const items = [expense("生活费", 3000), expense("房贷", 6000, 240)];
  const schedule = expenseSchedule(items, 60);
  assert.equal(schedule.nextMilestone.releaseMonth, 241);
  assert.deepEqual(schedule.visibleMilestones, []);
  assert.equal(schedule.nextVisibleMilestone, null);
  assert.equal(schedule.periodEndExpense, 9000);
  assert.equal(schedule.insightMonth, 12);
});

test("zero/unknown term is ongoing, even when the name is a loan", () => {
  const items = [expense("房贷", 6000), expense("待填车贷", 0, 30)];
  const schedule = expenseSchedule(items, 120);
  assert.deepEqual(schedule.milestones, []);
  assert.equal(schedule.periodEndExpense, 6000);
});

test("different debts expire independently; the final payment is still included", () => {
  const items = [expense("房贷", 6000, 240), expense("其他欠款", 1000, 12), expense("车贷", 2000, 36)];
  const schedule = expenseSchedule(items, 60);
  assert.deepEqual(schedule.milestones.map(item => item.releaseMonth), [13, 37, 241]);
  assert.deepEqual(schedule.visibleMilestones.map(item => item.releaseMonth), [13, 37]);
  assert.equal(schedule.insightMonth, 13);
  assert.equal(expenseAtMonth(items, 12), 9000);
  assert.equal(expenseAtMonth(items, 13), 8000);
  assert.equal(expenseSchedule(items, 36).periodEndExpense, 8000);
  assert.equal(schedule.periodEndExpense, 6000);
  assert.equal(expenseAtMonth(items, 241), 0);
});

test("same-month expiries combine and annual fees use monthly-equivalent amounts", () => {
  const items = [expense("车贷", 2000, 24), expense("欠款", 3000, 24), expense("年费", 6000, 24, "annual"), expense("首月结清", 20000, 24, "once")];
  const { milestones } = expenseSchedule(items, 60);
  assert.equal(milestones.length, 1);
  assert.deepEqual(milestones[0], { lastPaymentMonth: 24, releaseMonth: 25, names: ["车贷", "欠款", "年费"], monthlyReduction: 5500 });
  assert.equal(expenseAtMonth(items, 24) - expenseAtMonth(items, 25), milestones[0].monthlyReduction);
});

test("period-end boundary updates with horizon, not a fixed month 31", () => {
  const items = [expense("还款", 1234, 60)];
  assert.equal(expenseSchedule(items, 36).periodEndExpense, 1234);
  assert.equal(expenseSchedule(items, 60).periodEndExpense, 1234);
  assert.equal(expenseSchedule(items, 60).visibleMilestones.length, 0);
  assert.equal(expenseSchedule(items, 120).periodEndExpense, 0);
  assert.equal(expenseSchedule(items, 120).nextVisibleMilestone.releaseMonth, 61);
});

test("any finite recurring expense works; renaming changes only the display label", () => {
  const old = [expense("车贷", 5400, 30)];
  const renamed = [{ ...old[0], name: "进修课程" }];
  assert.equal(expenseSchedule(old, 60).nextMilestone.releaseMonth, 31);
  assert.equal(expenseSchedule(renamed, 60).nextMilestone.releaseMonth, 31);
  assert.deepEqual(expenseSchedule(renamed, 60).nextMilestone.names, ["进修课程"]);
  assert.equal(expenseSchedule([expense("最后一期", 2000, 1)], 36).insightMonth, 2);
  assert.equal(expenseAtMonth([expense("最后一期", 2000, 1)], 1), 2000);
  assert.equal(expenseAtMonth([expense("最后一期", 2000, 1)], 2), 0);
});
