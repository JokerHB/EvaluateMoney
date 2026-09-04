import assert from "node:assert/strict";
import test from "node:test";
import { formatMonthlyAxis, formatCumulativeAxis, TIMELINE_SERIES } from "../app/timeline-format.ts";

test("monthly ticks show yuan, without ambiguous k abbreviations", () => {
  assert.equal(formatMonthlyAxis(10000), "10,000");
  assert.equal(formatMonthlyAxis(500), "500");
  assert.equal(formatMonthlyAxis(-2500), "-2,500");
  assert.equal(formatMonthlyAxis(0), "0");
});

test("cumulative ticks convert to ten-thousand yuan without hiding small balances", () => {
  assert.equal(formatCumulativeAxis(100000), "10");
  assert.equal(formatCumulativeAxis(15000), "1.5");
  assert.equal(formatCumulativeAxis(2500), "0.25");
  assert.equal(formatCumulativeAxis(1), "0.0001");
  assert.equal(formatCumulativeAxis(-5000), "-0.5");
  assert.equal(formatCumulativeAxis(0), "0");
  assert.notEqual(formatCumulativeAxis(2000), formatCumulativeAxis(4000));
});

test("legend and tooltip identify the matching axis and monetary unit", () => {
  for (const key of ["net", "expense", "surplus"]) {
    assert.equal(TIMELINE_SERIES[key].axis, "左轴");
    assert.equal(TIMELINE_SERIES[key].unit, "元/月");
  }
  assert.equal(TIMELINE_SERIES.cumulative.axis, "右轴");
  assert.equal(TIMELINE_SERIES.cumulative.unit, "元");
});
