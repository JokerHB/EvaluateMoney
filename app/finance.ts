export type CityKey = "beijing" | "hohhot";

export type CityConfig = {
  key: CityKey;
  name: string;
  pensionRate: number;
  medicalRate: number;
  unemploymentRate: number;
  medicalFixed: number;
  pensionMin: number;
  pensionMax: number;
  medicalMin: number;
  medicalMax: number;
  housingMin: number;
  housingMax: number;
  housingRate: number;
};

export type Expense = {
  id: string;
  name: string;
  amount: number;
  frequency: "monthly" | "annual" | "once";
  duration: number;
  confirmed: boolean;
};

export const CITY_PRESETS: Record<CityKey, CityConfig> = {
  beijing: {
    key: "beijing", name: "北京（2026）", pensionRate: 0.08, medicalRate: 0.02,
    unemploymentRate: 0.005, medicalFixed: 3, pensionMin: 7270, pensionMax: 36348,
    medicalMin: 7270, medicalMax: 36348, housingMin: 2540, housingMax: 36348, housingRate: 0.12,
  },
  hohhot: {
    key: "hohhot", name: "呼和浩特（2026）", pensionRate: 0.08, medicalRate: 0.02,
    unemploymentRate: 0.005, medicalFixed: 50 / 12, pensionMin: 5058, pensionMax: 25290,
    medicalMin: 6744, medicalMax: 25290, housingMin: 2380, housingMax: 30498, housingRate: 0.12,
  },
};

export const HOHHOT_EXPENSES: Expense[] = [
  { id: "rent", name: "房租", amount: 2000, frequency: "monthly", duration: 0, confirmed: true },
  { id: "car-loan", name: "车贷", amount: 5400, frequency: "monthly", duration: 30, confirmed: true },
  { id: "living", name: "吃饭、水电与通信", amount: 2500, frequency: "monthly", duration: 0, confirmed: false },
  { id: "car-running", name: "油费、停车与保养", amount: 1000, frequency: "monthly", duration: 0, confirmed: false },
  { id: "car-insurance", name: "车险", amount: 6000, frequency: "annual", duration: 0, confirmed: false },
  { id: "flexible", name: "人情与弹性支出", amount: 500, frequency: "monthly", duration: 0, confirmed: false },
];

export const BEIJING_EXPENSES: Expense[] = [
  { id: "rent", name: "房租", amount: 5000, frequency: "monthly", duration: 0, confirmed: false },
  { id: "car-loan", name: "车贷", amount: 5400, frequency: "monthly", duration: 30, confirmed: true },
  { id: "living", name: "吃饭、水电与通信", amount: 3200, frequency: "monthly", duration: 0, confirmed: false },
  { id: "car-running", name: "油费、停车与保养", amount: 1200, frequency: "monthly", duration: 0, confirmed: false },
  { id: "car-insurance", name: "车险", amount: 6000, frequency: "annual", duration: 0, confirmed: false },
  { id: "flexible", name: "人情与弹性支出", amount: 800, frequency: "monthly", duration: 0, confirmed: false },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function contributionForMonth(gross: number, config: CityConfig, manualBases?: { pension: number; medical: number; housing: number }) {
  const pensionBase = manualBases ? manualBases.pension : clamp(gross, config.pensionMin, config.pensionMax);
  const medicalBase = manualBases ? manualBases.medical : clamp(gross, config.medicalMin, config.medicalMax);
  const housingBase = manualBases ? manualBases.housing : clamp(gross, config.housingMin, config.housingMax);
  const pension = pensionBase * config.pensionRate;
  const medical = medicalBase * config.medicalRate + config.medicalFixed;
  const unemployment = pensionBase * config.unemploymentRate;
  const housing = housingBase * config.housingRate;
  return { pensionBase, medicalBase, housingBase, pension, medical, unemployment, housing, total: pension + medical + unemployment + housing };
}

const annualTax = (taxable: number) => {
  const value = Math.max(0, taxable);
  if (value <= 36000) return value * 0.03;
  if (value <= 144000) return value * 0.1 - 2520;
  if (value <= 300000) return value * 0.2 - 16920;
  if (value <= 420000) return value * 0.25 - 31920;
  if (value <= 660000) return value * 0.3 - 52920;
  if (value <= 960000) return value * 0.35 - 85920;
  return value * 0.45 - 181920;
};

const bonusTax = (bonus: number) => {
  if (bonus <= 0) return 0;
  const monthly = bonus / 12;
  if (monthly <= 3000) return bonus * 0.03;
  if (monthly <= 12000) return bonus * 0.1 - 210;
  if (monthly <= 25000) return bonus * 0.2 - 1410;
  if (monthly <= 35000) return bonus * 0.25 - 2660;
  if (monthly <= 55000) return bonus * 0.3 - 4410;
  if (monthly <= 80000) return bonus * 0.35 - 7160;
  return bonus * 0.45 - 15160;
};

export function incomeProjection({ gross, bonusMonths, extraDeduction, config, manualBases }:{ gross:number; bonusMonths:number; extraDeduction:number; config:CityConfig; manualBases?:{pension:number;medical:number;housing:number} }) {
  if (gross <= 0) {
    const contribution = {
      pensionBase: 0, medicalBase: 0, housingBase: 0,
      pension: 0, medical: 0, unemployment: 0, housing: 0, total: 0,
    };
    return {
      annualGrossSalary: 0, bonus: 0, annualGross: 0, annualContributions: 0,
      contribution, salaryTax: 0, separateBonusTax: 0, mergedTax: 0, bestTax: 0,
      taxMethod: "无应税工资", annualNet: 0, averageMonthlyNet: 0, regularMonthlyNet: 0,
    };
  }
  const contribution = contributionForMonth(gross, config, manualBases);
  const annualGrossSalary = gross * 12;
  const bonus = gross * bonusMonths;
  const annualContributions = contribution.total * 12;
  const taxableSalary = annualGrossSalary - annualContributions - 60000 - extraDeduction * 12;
  const salaryTax = annualTax(taxableSalary);
  const separateBonusTax = bonusTax(bonus);
  const mergedTax = annualTax(taxableSalary + bonus);
  const taxSeparate = salaryTax + separateBonusTax;
  const bestTax = Math.min(taxSeparate, mergedTax);
  const taxMethod = taxSeparate <= mergedTax ? "奖金单独计税" : "奖金并入综合所得";
  const annualGross = annualGrossSalary + bonus;
  const annualNet = annualGross - annualContributions - bestTax;
  const regularAnnualNet = annualGrossSalary - annualContributions - salaryTax;
  return {
    annualGrossSalary, bonus, annualGross, annualContributions, contribution,
    salaryTax, separateBonusTax, mergedTax, bestTax, taxMethod, annualNet,
    averageMonthlyNet: annualNet / 12, regularMonthlyNet: regularAnnualNet / 12,
  };
}

export function expenseAtMonth(expenses: Expense[], month: number) {
  return expenses.reduce((total, item) => {
    const active = item.duration === 0 || month <= item.duration;
    if (!active) return total;
    if (item.frequency === "monthly") return total + item.amount;
    if (item.frequency === "annual") return total + item.amount / 12;
    return total + (month === 1 ? item.amount : 0);
  }, 0);
}

export function annualExpenses(expenses: Expense[]) {
  return Array.from({ length: 12 }, (_, index) => expenseAtMonth(expenses, index + 1)).reduce((sum, value) => sum + value, 0);
}

export function solveGrossForAnnualNet(targetAnnualNet: number, args: Omit<Parameters<typeof incomeProjection>[0], "gross">) {
  let low = 0, high = 200000;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (incomeProjection({ ...args, gross: mid }).annualNet < targetAnnualNet) low = mid;
    else high = mid;
  }
  return high;
}

export function solveGrossForRegularMonthlyNet(targetMonthlyNet: number, args: Omit<Parameters<typeof incomeProjection>[0], "gross" | "bonusMonths">) {
  let low = 0, high = 200000;
  for (let i = 0; i < 80; i += 1) {
    const mid = (low + high) / 2;
    if (incomeProjection({ ...args, bonusMonths: 0, gross: mid }).regularMonthlyNet < targetMonthlyNet) low = mid;
    else high = mid;
  }
  return high;
}
