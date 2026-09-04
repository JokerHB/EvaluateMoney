import type { CityConfig, CityKey, Expense } from "./finance";

export type PersonId = "primary" | "partner";
export type HouseholdMode = "single" | "couple";
export type ReverseOwner = PersonId | "split";
export type PersonState = {
  id: PersonId;
  name: string;
  gross: number;
  bonusMonths: number;
  cityKey: CityKey;
  config: CityConfig;
  extraDeduction: number;
  autoBase: boolean;
  manualBases: { pension: number; medical: number; housing: number };
  signingBonus: number;
  relocationGrant: number;
  equityGrant: number;
  equityVestingYears: number;
  extraRealizationRate: number;
};

export type CalculatorState = {
  householdMode: HouseholdMode;
  calcMode: "forward" | "reverse";
  primary: PersonState;
  partner: PersonState;
  reverseOwner: ReverseOwner;
  comparePersonId: PersonId;
  expenses: Expense[];
  expenseScenario: "hohhot" | "beijing" | "custom";
  savingsTarget: number;
  reserveTarget: number;
  initialSavings: number;
  horizon: number;
};

export const MAX_PLAN_BYTES = 1024 * 1024;
const FORMAT = "evaluate-money-plan";
const VERSION = 1;

export type SavedPlan = {
  format: typeof FORMAT;
  version: typeof VERSION;
  name: string;
  savedAt: string;
  state: CalculatorState;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label}缺失或格式不正确。`);
  return value as Record<string, unknown>;
}

function number(value: unknown, label: string, min = 0, max = 1e12): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${label}必须是 ${min} 至 ${max} 之间的有效数字。`);
  }
  return value;
}

function string(value: unknown, label: string, max = 120): string {
  if (typeof value !== "string" || value.length > max) throw new Error(`${label}必须是 ${max} 字以内的文本。`);
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}格式不正确。`);
  return value;
}

function choice<T extends string>(value: unknown, choices: readonly T[], label: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) throw new Error(`${label}不受支持。`);
  return value as T;
}

function person(value: unknown, id: PersonId): PersonState {
  const p = record(value, "收入人资料");
  if (p.id !== id) throw new Error("收入人标识不正确。");
  const config = record(p.config, "税费参数");
  const bases = record(p.manualBases, "实际缴费基数");
  const cityKey = choice(p.cityKey, ["beijing", "hohhot"], "参保地");
  const validatedConfig: CityConfig = {
    key: choice(config.key, ["beijing", "hohhot"], "税费城市"),
    name: string(config.name, "城市名称"),
    pensionRate: number(config.pensionRate, "养老比例", 0, 1),
    medicalRate: number(config.medicalRate, "医保比例", 0, 1),
    unemploymentRate: number(config.unemploymentRate, "失业比例", 0, 1),
    housingRate: number(config.housingRate, "公积金比例", 0, 1),
    medicalFixed: number(config.medicalFixed, "医保固定费用"),
    pensionMin: number(config.pensionMin, "养老基数下限"),
    pensionMax: number(config.pensionMax, "养老基数上限"),
    medicalMin: number(config.medicalMin, "医保基数下限"),
    medicalMax: number(config.medicalMax, "医保基数上限"),
    housingMin: number(config.housingMin, "公积金基数下限"),
    housingMax: number(config.housingMax, "公积金基数上限"),
  };
  if (validatedConfig.key !== cityKey) throw new Error("参保地与税费城市不一致。");
  if (validatedConfig.pensionMin > validatedConfig.pensionMax || validatedConfig.medicalMin > validatedConfig.medicalMax || validatedConfig.housingMin > validatedConfig.housingMax) {
    throw new Error("缴费基数下限不能大于上限。");
  }
  return {
    id, name: string(p.name, "收入人称呼"), cityKey, config: validatedConfig,
    gross: number(p.gross, "税前月薪"), bonusMonths: number(p.bonusMonths, "年终奖月数", 0, 120),
    extraDeduction: number(p.extraDeduction, "专项附加扣除"), autoBase: boolean(p.autoBase, "自动缴费基数"),
    manualBases: { pension: number(bases.pension, "养老实际基数"), medical: number(bases.medical, "医保实际基数"), housing: number(bases.housing, "公积金实际基数") },
    signingBonus: number(p.signingBonus, "签字费"), relocationGrant: number(p.relocationGrant, "安家费"),
    equityGrant: number(p.equityGrant, "股票期权总值"), equityVestingYears: number(p.equityVestingYears, "归属年数", 1, 100),
    extraRealizationRate: number(p.extraRealizationRate, "兑现到手比例", 0, 100),
  };
}

export function validateCalculatorState(value: unknown): CalculatorState {
  const s = record(value, "测算参数");
  if (!Array.isArray(s.expenses) || s.expenses.length > 500) throw new Error("支出清单必须是列表，最多支持 500 项。");
  const ids = new Set<string>();
  const expenses = s.expenses.map((value, index): Expense => {
    const e = record(value, `第 ${index + 1} 项支出`);
    const id = string(e.id, "支出标识");
    if (!id || ids.has(id)) throw new Error("支出标识为空或重复。");
    ids.add(id);
    const duration = number(e.duration, "支出持续月数", 0, 12000);
    if (!Number.isInteger(duration)) throw new Error("支出持续月数必须为整数。");
    return { id, name: string(e.name, "支出名称"), amount: number(e.amount, "支出金额"), frequency: choice(e.frequency, ["monthly", "annual", "once"], "支出频率"), duration, confirmed: boolean(e.confirmed, "支出确认状态") };
  });
  const horizon = number(s.horizon, "观察周期");
  if (![36, 60, 120].includes(horizon)) throw new Error("观察周期仅支持 3、5、10 年。");
  // Reconstruct only known keys. Imported result snapshots never drive calculations.
  return {
    householdMode: choice(s.householdMode, ["single", "couple"], "家庭模式"),
    calcMode: choice(s.calcMode, ["forward", "reverse"], "计算模式"),
    primary: person(s.primary, "primary"), partner: person(s.partner, "partner"),
    reverseOwner: choice(s.reverseOwner, ["primary", "partner", "split"], "反推对象"),
    comparePersonId: choice(s.comparePersonId, ["primary", "partner"], "Offer 比较对象"),
    expenses, expenseScenario: choice(s.expenseScenario, ["hohhot", "beijing", "custom"], "支出方案"),
    savingsTarget: number(s.savingsTarget, "每月储蓄目标"), reserveTarget: number(s.reserveTarget, "应急金目标"),
    initialSavings: number(s.initialSavings, "期初存款"), horizon,
  };
}

export function parsePlan(text: string): SavedPlan {
  if (new TextEncoder().encode(text).byteLength > MAX_PLAN_BYTES) throw new Error("方案文件不能超过 1 MB。");
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { throw new Error("文件不是有效的 JSON 方案。请使用“保存方案”生成的文件，CSV 表格不能还原页面。"); }
  const data = record(value, "方案文件");
  if (data.format !== FORMAT) throw new Error("这不是家庭经济账方案文件，请选择“保存方案”下载的 JSON 文件。");
  if (data.version !== VERSION) throw new Error("暂不支持此方案版本，请使用兼容版本的家庭经济账打开。");
  const savedAt = string(data.savedAt, "保存时间");
  if (!Number.isFinite(Date.parse(savedAt))) throw new Error("方案保存时间不正确。");
  return { format: FORMAT, version: VERSION, name: string(data.name, "方案名称", 80), savedAt, state: validateCalculatorState(data.state) };
}

export function serializePlan(state: CalculatorState, name: string, results: object, now = new Date()): string {
  const json = JSON.stringify({
    format: FORMAT, version: VERSION, name: string(name, "方案名称", 80).trim() || "未命名方案", savedAt: now.toISOString(),
    state: validateCalculatorState(state),
    results,
    resultNote: "保存时的结果快照仅供留档；加载后以完整输入参数重新计算。如后续计算规则更新，结果可能不同。",
  }, null, 2);
  if (new TextEncoder().encode(json).byteLength > MAX_PLAN_BYTES) throw new Error("方案文件超过 1 MB，请减少支出项目后重试。");
  return json;
}

export function planFilename(name: string, now = new Date()): string {
  const safeName = name.trim().replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 60) || "未命名方案";
  return `家庭经济账-${safeName}-${now.toISOString().replace(/[:.]/g, "-")}.json`;
}
