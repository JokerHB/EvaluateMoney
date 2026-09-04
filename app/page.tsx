"use client";
/* oxlint-disable react/react-compiler */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ArrowRight, Calculator, CalendarClock, CircleHelp, Coins, Download,
  ExternalLink, Gift, Home as HomeIcon, MapPin, PiggyBank, Plus, Printer,
  RotateCcw, Save, FolderOpen, Settings2, ShieldCheck, Trash2, TrendingUp, UserRound, Users,
  WalletCards,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogCancel, AlertDialogAction } from "@/components/ui/alert-dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  BEIJING_EXPENSES, CITY_PRESETS, HOHHOT_EXPENSES, annualExpenses, expenseAtMonth, expenseSchedule,
  incomeProjection, solveGrossForAnnualNet, solveGrossForRegularMonthlyNet,
  type CityConfig, type CityKey, type Expense,
} from "./finance";
import { MAX_PLAN_BYTES, parsePlan, serializePlan, planFilename, type CalculatorState, type SavedPlan, type PersonId, type PersonState, type HouseholdMode, type ReverseOwner } from "./plan";
import { formatMonthlyAxis, formatCumulativeAxis, TIMELINE_SERIES } from "./timeline-format";

const STORAGE_KEY = "personal-economy-ledger-v2";
const LEGACY_STORAGE_KEY = "personal-economy-ledger-v1";
const money = (value: number) => new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(Math.round(value));
const compactMoney = (value: number) => value >= 10000 ? `${(value / 10000).toFixed(value % 10000 === 0 ? 0 : 1)}万` : money(value);
const numberFieldValue = (value: number) => value === 0 ? "" : value;
const cloneExpenses = (items: Expense[]) => items.map((item) => ({ ...item }));
const salaryPresets = [15000, 20000, 25000, 30000, 35000];
const savingsPresets = [3000, 5000, 8000, 10000];
const reserveMonthPresets = [3, 6, 12];

const createPerson = (id: PersonId): PersonState => ({
  id,
  name: id === "primary" ? "本人" : "伴侣",
  gross: id === "primary" ? 25000 : 0,
  bonusMonths: id === "primary" ? 1 : 0,
  cityKey: "beijing",
  config: { ...CITY_PRESETS.beijing },
  extraDeduction: 0,
  autoBase: true,
  manualBases: { pension: id === "primary" ? 25000 : 15000, medical: id === "primary" ? 25000 : 15000, housing: id === "primary" ? 25000 : 15000 },
  signingBonus: 0,
  relocationGrant: 0,
  equityGrant: 0,
  equityVestingYears: 4,
  extraRealizationRate: 70,
});

const hydratePerson = (raw: Partial<PersonState> | undefined, fallback: PersonState): PersonState => ({
  ...fallback,
  ...raw,
  id: fallback.id,
  config: { ...fallback.config, ...raw?.config },
  manualBases: { ...fallback.manualBases, ...raw?.manualBases },
});

const baseArgsFor = (person: PersonState) => ({
  bonusMonths: person.bonusMonths,
  extraDeduction: person.extraDeduction,
  config: person.config,
  manualBases: person.autoBase ? undefined : person.manualBases,
});

const projectionFor = (person: PersonState, gross = person.gross) => incomeProjection({ gross, ...baseArgsFor(person) });

const extraFor = (person: PersonState) => {
  const rate = Math.min(100, Math.max(0, person.extraRealizationRate)) / 100;
  const vestingYears = Math.max(1, person.equityVestingYears);
  const oneTimeCashNet = (person.signingBonus + person.relocationGrant) * rate;
  const annualEquityNet = person.equityGrant / vestingYears * rate;
  return { rate, vestingYears, oneTimeCashNet, annualEquityNet, firstYearNet: oneTimeCashNet + annualEquityNet };
};

const solveCommonAnnualGross = (targetAnnualNet: number, people: PersonState[]) => {
  if (targetAnnualNet <= 0) return 0;
  let low = 0;
  let high = 200000;
  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const net = people.reduce((sum, person) => sum + projectionFor(person, mid).annualNet, 0);
    if (net < targetAnnualNet) low = mid;
    else high = mid;
  }
  return high;
};

const solveCommonRegularGross = (targetMonthlyNet: number, people: PersonState[]) => {
  if (targetMonthlyNet <= 0) return 0;
  let low = 0;
  let high = 200000;
  for (let index = 0; index < 80; index += 1) {
    const mid = (low + high) / 2;
    const net = people.reduce((sum, person) => sum + incomeProjection({
      gross: mid,
      bonusMonths: 0,
      extraDeduction: person.extraDeduction,
      config: person.config,
      manualBases: person.autoBase ? undefined : person.manualBases,
    }).regularMonthlyNet, 0);
    if (net < targetMonthlyNet) low = mid;
    else high = mid;
  }
  return high;
};

const sources = [
  { label: "国家税务总局：累计预扣法与税率表", url: "https://fgk.chinatax.gov.cn/zcfgk/c100015/c5200946/content.html" },
  { label: "财政部/税务总局：全年一次性奖金政策延续至2027年", url: "https://liaoning.chinatax.gov.cn/art/2023/8/18/art_5869_7444.html" },
  { label: "北京2026年度社保缴费基数上下限", url: "https://rsj.beijing.gov.cn/xxgk/2024zcwj/202608/t20260821_4831461.html" },
  { label: "北京2026年度住房公积金缴存政策", url: "https://gjj.beijing.gov.cn/web/zwgk61/2024zcwj/436433461/744103382/index.html" },
  { label: "内蒙古2026年度职工医保缴费基数", url: "https://neimenggu.chinatax.gov.cn/nmgzzqswj/xxgkml/gzdt/tzgg/202606/t20260629_895262.html" },
  { label: "内蒙古2026年度养老/失业缴费基数文件转载", url: "https://www.ordoszxqy.org.cn/article/info/12129" },
  { label: "呼和浩特职工医保个人缴费说明", url: "https://ybj.huhhot.gov.cn/hdjl_0/cjwt/czzg/202410/t20241018_1790262.html" },
  { label: "国家税务总局：上市公司股权激励个税政策延续至2027年", url: "https://fgk.chinatax.gov.cn/zcfgk/c102416/c5211082/content.html" },
];

type PersonCardProps = {
  person: PersonState;
  index: number;
  onUpdate: (patch: Partial<PersonState>) => void;
  onCity: (city: CityKey) => void;
};

function PersonIncomeCard({ person, index, onUpdate, onCity }: PersonCardProps) {
  const projection = projectionFor(person);
  return <Card className="person-card"><CardContent>
    <div className="person-card-head">
      <span className="person-index">{index + 1}</span>
      <Input aria-label={`第${index + 1}位收入者称呼`} value={person.name} onChange={(event) => onUpdate({ name: event.target.value })} />
      <small>{index === 0 ? "主要测算人" : "共同收入人"}</small>
    </div>
    <fieldset className="person-city"><legend className="sr-only">{person.name}参保地</legend>
      <button type="button" className={person.cityKey === "beijing" ? "active" : ""} onClick={() => onCity("beijing")}><MapPin size={12} />北京</button>
      <button type="button" className={person.cityKey === "hohhot" ? "active" : ""} onClick={() => onCity("hohhot")}><MapPin size={12} />呼和浩特</button>
    </fieldset>
    <label className="person-salary" htmlFor={`${person.id}-gross`}><span>税前月薪</span><div><b>¥</b><Input id={`${person.id}-gross`} type="number" min={0} step={500} placeholder="请输入月薪" value={numberFieldValue(person.gross)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ gross: Number(event.target.value) || 0 })} /><small>/月</small></div></label>
    <div className="person-presets">{salaryPresets.map((value) => <button type="button" key={value} className={person.gross === value ? "active" : ""} onClick={() => onUpdate({ gross: value })}>{compactMoney(value)}</button>)}</div>
    <div className="person-card-foot">
      <label htmlFor={`${person.id}-bonus`}><span>年终奖</span><div><Input id={`${person.id}-bonus`} type="number" min={0} max={12} step={0.5} value={numberFieldValue(person.bonusMonths)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ bonusMonths: Number(event.target.value) || 0 })} /><small>个月</small></div></label>
      <div><span>工资月均到手</span><b>¥{money(projection.averageMonthlyNet)}</b></div>
    </div>
  </CardContent></Card>;
}

type ExtrasCardProps = {
  person: PersonState;
  onUpdate: (patch: Partial<PersonState>) => void;
};

function PersonExtrasCard({ person, onUpdate }: ExtrasCardProps) {
  const extras = extraFor(person);
  return <Card className="person-extra-card"><CardContent>
    <div className="person-extra-head"><span><Gift size={16} /></span><div><small>阶段性收入</small><h3>{person.name}</h3></div><b>首年约 +¥{money(extras.firstYearNet)}</b></div>
    <div className="person-extra-fields">
      <label htmlFor={`${person.id}-signing`}><span>签字费</span><div><b>¥</b><Input id={`${person.id}-signing`} type="number" min={0} step={1000} placeholder="0" value={numberFieldValue(person.signingBonus)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ signingBonus: Number(event.target.value) || 0 })} /></div></label>
      <label htmlFor={`${person.id}-relocation`}><span>安家费</span><div><b>¥</b><Input id={`${person.id}-relocation`} type="number" min={0} step={1000} placeholder="0" value={numberFieldValue(person.relocationGrant)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ relocationGrant: Number(event.target.value) || 0 })} /></div></label>
      <label htmlFor={`${person.id}-equity`}><span>股票/期权名义总值</span><div><b>¥</b><Input id={`${person.id}-equity`} type="number" min={0} step={10000} placeholder="0" value={numberFieldValue(person.equityGrant)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ equityGrant: Number(event.target.value) || 0 })} /></div></label>
      <label htmlFor={`${person.id}-vesting`}><span>归属期</span><div><Input id={`${person.id}-vesting`} type="number" min={1} max={10} step={1} value={numberFieldValue(person.equityVestingYears)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ equityVestingYears: Math.max(1, Number(event.target.value) || 1) })} /><b>年</b></div></label>
    </div>
    <fieldset className="person-rate"><legend>兑现/到手比例</legend><div>{[50, 70, 100].map((rate) => <button type="button" key={rate} className={person.extraRealizationRate === rate ? "active" : ""} onClick={() => onUpdate({ extraRealizationRate: rate })}>{rate}%</button>)}<label htmlFor={`${person.id}-rate`}><Input id={`${person.id}-rate`} aria-label={`${person.name}自定义兑现到手比例`} type="number" min={0} max={100} step={1} placeholder="自定义" value={numberFieldValue(person.extraRealizationRate)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => onUpdate({ extraRealizationRate: Math.min(100, Math.max(0, Number(event.target.value) || 0)) })} /><b>%</b></label></div></fieldset>
    <div className="person-extra-summary"><span>一次性现金估算 ¥{money(extras.oneTimeCashNet)}</span><span>权益首年折算 ¥{money(extras.annualEquityNet)}</span></div>
  </CardContent></Card>;
}

export default function Home() {
  const [householdMode, setHouseholdMode] = useState<HouseholdMode>("single");
  const [calcMode, setCalcMode] = useState<"forward" | "reverse">("forward");
  const [primary, setPrimary] = useState<PersonState>(() => createPerson("primary"));
  const [partner, setPartner] = useState<PersonState>(() => createPerson("partner"));
  const [reverseOwner, setReverseOwner] = useState<ReverseOwner>("primary");
  const [comparePersonId, setComparePersonId] = useState<PersonId>("primary");
  const [expenses, setExpenses] = useState<Expense[]>(cloneExpenses(HOHHOT_EXPENSES));
  const [expenseScenario, setExpenseScenario] = useState<"hohhot" | "beijing" | "custom">("hohhot");
  const [savingsTarget, setSavingsTarget] = useState(5000);
  const [reserveTarget, setReserveTarget] = useState(100000);
  const [initialSavings, setInitialSavings] = useState(0);
  const [horizon, setHorizon] = useState(60);
  const [hydrated, setHydrated] = useState(false);
  const [planName, setPlanName] = useState("我的家庭方案");
  const [pendingPlan, setPendingPlan] = useState<SavedPlan | null>(null);
  const [planNotice, setPlanNotice] = useState("");
  const [planError, setPlanError] = useState("");
  const [storageWarning, setStorageWarning] = useState("");
  const [isReadingPlan, setIsReadingPlan] = useState(false);
  const planFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const state = JSON.parse(saved);
        if (typeof state.planName === "string") setPlanName(state.planName.slice(0, 80));
        if (state.householdMode === "single" || state.householdMode === "couple") setHouseholdMode(state.householdMode);
        if (state.calcMode === "forward" || state.calcMode === "reverse") setCalcMode(state.calcMode);
        setPrimary(hydratePerson(state.primary, createPerson("primary")));
        setPartner(hydratePerson(state.partner, createPerson("partner")));
        if (["primary", "partner", "split"].includes(state.reverseOwner)) setReverseOwner(state.reverseOwner);
        if (["primary", "partner"].includes(state.comparePersonId)) setComparePersonId(state.comparePersonId);
        if (Array.isArray(state.expenses)) setExpenses(state.expenses);
        if (state.expenseScenario) setExpenseScenario(state.expenseScenario);
        if (typeof state.savingsTarget === "number") setSavingsTarget(state.savingsTarget);
        if (typeof state.reserveTarget === "number") setReserveTarget(state.reserveTarget);
        if (typeof state.initialSavings === "number") setInitialSavings(state.initialSavings);
        if (typeof state.horizon === "number") setHorizon(state.horizon);
      } else {
        const legacyText = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyText) {
          const legacy = JSON.parse(legacyText);
          setPrimary(hydratePerson({
            gross: legacy.gross,
            bonusMonths: legacy.bonusMonths,
            cityKey: legacy.cityKey,
            config: legacy.config,
            extraDeduction: legacy.extraDeduction,
            autoBase: legacy.autoBase,
            manualBases: legacy.manualBases,
            signingBonus: legacy.signingBonus,
            relocationGrant: legacy.relocationGrant,
            equityGrant: legacy.equityGrant,
            equityVestingYears: legacy.equityVestingYears,
            extraRealizationRate: legacy.extraRealizationRate,
          }, createPerson("primary")));
          if (Array.isArray(legacy.expenses)) setExpenses(legacy.expenses);
          if (legacy.expenseScenario) setExpenseScenario(legacy.expenseScenario);
          if (typeof legacy.savingsTarget === "number") setSavingsTarget(legacy.savingsTarget);
          if (typeof legacy.reserveTarget === "number") setReserveTarget(legacy.reserveTarget);
          if (typeof legacy.initialSavings === "number") setInitialSavings(legacy.initialSavings);
          if (typeof legacy.horizon === "number") setHorizon(legacy.horizon);
        }
      }
    } catch { /* invalid local preference: use safe defaults */ }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        householdMode, calcMode, primary, partner, reverseOwner, comparePersonId,
        expenses, expenseScenario, savingsTarget, reserveTarget, initialSavings, horizon, planName,
      }));
      setStorageWarning("");
    } catch {
      setStorageWarning("浏览器自动记忆不可用，请用“保存方案”下载备份；当前测算仍可继续。");
    }
  }, [householdMode, calcMode, primary, partner, reverseOwner, comparePersonId, expenses, expenseScenario, savingsTarget, reserveTarget, initialSavings, horizon, planName, hydrated]);

  const people = useMemo(() => householdMode === "couple" ? [primary, partner] : [primary], [householdMode, primary, partner]);
  const personMap: Record<PersonId, PersonState> = { primary, partner };
  const projections = people.map((person) => ({ person, projection: projectionFor(person), extras: extraFor(person) }));
  const householdSalaryMonthlyNet = projections.reduce((sum, item) => sum + item.projection.averageMonthlyNet, 0);
  const householdRegularMonthlyNet = projections.reduce((sum, item) => sum + item.projection.regularMonthlyNet, 0);
  const householdAnnualGross = projections.reduce((sum, item) => sum + item.projection.annualGross, 0);
  const householdAnnualContributions = projections.reduce((sum, item) => sum + item.projection.annualContributions, 0);
  const householdAnnualTax = projections.reduce((sum, item) => sum + item.projection.bestTax, 0);
  const householdFirstYearExtraNet = projections.reduce((sum, item) => sum + item.extras.firstYearNet, 0);
  const firstYearAverageNet = householdSalaryMonthlyNet + householdFirstYearExtraNet / 12;

  const currentExpense = useMemo(() => expenseAtMonth(expenses, 1), [expenses]);
  const schedule = useMemo(() => expenseSchedule(expenses, horizon), [expenses, horizon]);
  const { periodEndExpense, nextMilestone, nextVisibleMilestone, insightMonth } = schedule;
  const annualSpend = useMemo(() => annualExpenses(expenses), [expenses]);
  const salarySurplus = householdSalaryMonthlyNet - currentExpense;
  const firstYearAverageSurplus = firstYearAverageNet - currentExpense;

  const reverseAnnualTarget = annualSpend + savingsTarget * 12;
  const reverseSalaryNetTarget = Math.max(0, reverseAnnualTarget - householdFirstYearExtraNet);
  const effectiveReverseOwner: ReverseOwner = householdMode === "single" ? "primary" : reverseOwner;
  const reverseGrossMap: Record<PersonId, number> = { primary: primary.gross, partner: partner.gross };
  let reverseCashSafeGross = 0;
  let reverseHeroLabel = `${primary.name}所需税前月薪`;

  if (effectiveReverseOwner === "split") {
    const commonGross = solveCommonAnnualGross(reverseSalaryNetTarget, people);
    reverseGrossMap.primary = commonGross;
    reverseGrossMap.partner = commonGross;
    reverseCashSafeGross = solveCommonRegularGross(currentExpense + savingsTarget, people);
    reverseHeroLabel = "双方各需税前月薪";
  } else {
    const targetPerson = personMap[effectiveReverseOwner];
    const otherPeople = people.filter((person) => person.id !== effectiveReverseOwner);
    const otherAnnualNet = otherPeople.reduce((sum, person) => sum + projectionFor(person).annualNet, 0);
    const targetAnnualNet = Math.max(0, reverseSalaryNetTarget - otherAnnualNet);
    reverseGrossMap[effectiveReverseOwner] = targetAnnualNet <= 0 ? 0 : solveGrossForAnnualNet(targetAnnualNet, baseArgsFor(targetPerson));
    const otherRegularNet = otherPeople.reduce((sum, person) => sum + projectionFor(person).regularMonthlyNet, 0);
    const targetRegularNet = Math.max(0, currentExpense + savingsTarget - otherRegularNet);
    reverseCashSafeGross = targetRegularNet <= 0 ? 0 : solveGrossForRegularMonthlyNet(targetRegularNet, {
      extraDeduction: targetPerson.extraDeduction,
      config: targetPerson.config,
      manualBases: targetPerson.autoBase ? undefined : targetPerson.manualBases,
    });
    reverseHeroLabel = `${targetPerson.name}所需税前月薪`;
  }

  const reverseProjections = people.map((person) => ({ person, projection: projectionFor(person, reverseGrossMap[person.id]) }));
  const reverseHouseholdAnnualGross = reverseProjections.reduce((sum, item) => sum + item.projection.annualGross, 0);
  const reverseHeroGross = effectiveReverseOwner === "split" ? reverseGrossMap.primary : reverseGrossMap[effectiveReverseOwner];

  const timeline = useMemo(() => {
    let cumulative = initialSavings;
    return Array.from({ length: horizon }, (_, index) => {
      const month = index + 1;
      const expense = expenseAtMonth(expenses, month);
      const extraNet = people.reduce((sum, person) => {
        const extra = extraFor(person);
        return sum + (month <= 12 ? extra.oneTimeCashNet / 12 : 0) + (month <= extra.vestingYears * 12 ? extra.annualEquityNet / 12 : 0);
      }, 0);
      const net = householdSalaryMonthlyNet + extraNet;
      const surplus = net - expense;
      cumulative += surplus;
      return { month, net: Math.round(net), expense: Math.round(expense), surplus: Math.round(surplus), cumulative: Math.round(cumulative) };
    });
  }, [horizon, expenses, people, initialSavings, householdSalaryMonthlyNet]);

  const reserveGap = Math.max(0, reserveTarget - initialSavings);
  const reserveCapacity = calcMode === "forward" ? salarySurplus : savingsTarget;
  const reserveMonths = reserveGap === 0 ? 0 : reserveCapacity > 0 ? Math.ceil(reserveGap / reserveCapacity) : Infinity;

  const effectiveCompareId: PersonId = householdMode === "single" ? "primary" : comparePersonId;
  const comparePerson = personMap[effectiveCompareId];
  const otherPeopleForOffers = people.filter((person) => person.id !== effectiveCompareId);
  const offerRows = Array.from(new Set([15000, 20000, 25000, 30000, 35000, 40000, Math.round(comparePerson.gross / 500) * 500])).filter((value) => value >= 0).sort((a, b) => a - b).map((salary) => {
    const candidate = projectionFor(comparePerson, salary);
    const otherProjections = otherPeopleForOffers.map((person) => projectionFor(person));
    const longTermNet = candidate.averageMonthlyNet + otherProjections.reduce((sum, item) => sum + item.averageMonthlyNet, 0);
    const annualGross = candidate.annualGross + otherProjections.reduce((sum, item) => sum + item.annualGross, 0);
    const firstYearNet = longTermNet + householdFirstYearExtraNet / 12;
    return { salary, annualGross, longTermNet, firstYearNet, currentLeft: firstYearNet - currentExpense, futureLeft: longTermNet - periodEndExpense };
  });

  const updatePerson = (id: PersonId, patch: Partial<PersonState>) => {
    const setter = id === "primary" ? setPrimary : setPartner;
    setter((current) => ({ ...current, ...patch }));
  };
  const applyPersonCity = (id: PersonId, cityKey: CityKey) => updatePerson(id, { cityKey, config: { ...CITY_PRESETS[cityKey] } });
  const updatePersonConfig = (id: PersonId, key: keyof CityConfig, value: number) => {
    const person = personMap[id];
    updatePerson(id, { config: { ...person.config, [key]: value } });
  };
  const applyExpensePreset = (key: "hohhot" | "beijing") => {
    setExpenseScenario(key);
    setExpenses(cloneExpenses(key === "hohhot" ? HOHHOT_EXPENSES : BEIJING_EXPENSES));
  };
  const updateExpense = (id: string, patch: Partial<Expense>) => {
    setExpenseScenario("custom");
    setExpenses((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };
  const addExpense = (name = "新支出") => {
    setExpenseScenario("custom");
    setExpenses((items) => [...items, { id: `expense-${crypto.randomUUID()}`, name, amount: 0, frequency: "monthly", duration: 0, confirmed: false }]);
  };
  const resetAll = () => {
    setPlanName("我的家庭方案");
    setPlanNotice("");
    setPlanError("");
    setHouseholdMode("single");
    setCalcMode("forward");
    setPrimary(createPerson("primary"));
    setPartner(createPerson("partner"));
    setReverseOwner("primary");
    setComparePersonId("primary");
    setExpenses(cloneExpenses(HOHHOT_EXPENSES));
    setExpenseScenario("hohhot");
    setSavingsTarget(5000);
    setReserveTarget(100000);
    setInitialSavings(0);
    setHorizon(60);
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch { /* Downloads remain available when browser storage is blocked. */ }
  };
  const savePlan = () => {
    setPlanError("");
    setPlanNotice("");
    try {
      const now = new Date();
      const state: CalculatorState = {
        householdMode, calcMode, primary, partner, reverseOwner, comparePersonId,
        expenses, expenseScenario, savingsTarget, reserveTarget, initialSavings, horizon,
      };
      const json = serializePlan(state, planName, {
        householdAnnualGross, householdAnnualTax, householdAnnualContributions,
        householdSalaryMonthlyNet, householdRegularMonthlyNet, householdFirstYearExtraNet,
        firstYearAverageNet, currentExpense, periodEndExpense, expenseMilestones: schedule.milestones, annualSpend, salarySurplus, firstYearAverageSurplus,
        reverseAnnualTarget, reverseGrossMap, reverseCashSafeGross, reverseHouseholdAnnualGross,
        reserveMonths: Number.isFinite(reserveMonths) ? reserveMonths : null,
        people: projections, timeline, offerRows,
      }, now);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = planFilename(planName, now);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPlanNotice("已发起方案文件下载。请保留该 JSON 文件，之后可加载还原；继续修改后请重新保存。");
    } catch (error) {
      setPlanError(error instanceof Error ? error.message : "方案保存失败，请重试。");
    }
  };
  const readPlanFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setIsReadingPlan(true);
    setPlanError("");
    setPlanNotice("");
    try {
      if (file.size > MAX_PLAN_BYTES) throw new Error("方案文件不能超过 1 MB。");
      const loaded = parsePlan(await file.text());
      setPendingPlan(loaded);
    } catch (error) {
      setPlanError(`${error instanceof Error ? error.message : "读取失败，请重试。"} 当前测算未改变。`);
    } finally {
      setIsReadingPlan(false);
    }
  };
  const restorePlan = () => {
    if (!pendingPlan) return;
    const state = pendingPlan.state;
    setHouseholdMode(state.householdMode);
    setCalcMode(state.calcMode);
    setPrimary(state.primary);
    setPartner(state.partner);
    setReverseOwner(state.reverseOwner);
    setComparePersonId(state.comparePersonId);
    setExpenses(state.expenses);
    setExpenseScenario(state.expenseScenario);
    setSavingsTarget(state.savingsTarget);
    setReserveTarget(state.reserveTarget);
    setInitialSavings(state.initialSavings);
    setHorizon(state.horizon);
    setPlanName(pendingPlan.name);
    setPlanNotice(`已加载“${pendingPlan.name}”，完整测算参数已还原，结果已重新计算。`);
    setPlanError("");
    setPendingPlan(null);
  };
  const exportCsv = () => {
    const rows: Array<Array<string | number>> = [
      ["家庭经济账", "数值"],
      ["测算模式", householdMode === "couple" ? "双人家庭" : "单人"],
      ["工资长期月均到手", Math.round(householdSalaryMonthlyNet)],
      ["首年综合月均到手", Math.round(firstYearAverageNet)],
      ["当前月共同支出", Math.round(currentExpense)],
      [`第${horizon}个月共同支出`, Math.round(periodEndExpense)],
      ["工资口径月结余", Math.round(salarySurplus)],
      ["期初可用存款", initialSavings],
      [`${horizon / 12}年后可动用余额`, Math.round(timeline.at(-1)?.cumulative ?? initialSavings)],
      [],
      ["收入人", "税前月薪", "参保地", "年终奖月数", "工资年包", "月均到手", "首年阶段性收入净值"],
      ...projections.map((item) => [item.person.name, item.person.gross, item.person.config.name, item.person.bonusMonths, Math.round(item.projection.annualGross), Math.round(item.projection.averageMonthlyNet), Math.round(item.extras.firstYearNet)]),
      [],
      ["共同支出项目", "金额", "频率", "持续月数", "口径"],
      ...expenses.map((item) => [item.name, item.amount, item.frequency, item.duration || "长期", item.confirmed ? "已确认" : "估算"]),
      [],
      ["支出到期项目", "最后计入月份", "停止计入月份", "月均支出减少"],
      ...schedule.milestones.map((item) => [item.names.join("、"), item.lastPaymentMonth, item.releaseMonth, Math.round(item.monthlyReduction)]),
    ];
    const csv = "\uFEFF" + rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "家庭经济账.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  return <main className="app-shell">
    <header className="site-header">
      <a className="wordmark" href="#top"><span><Calculator size={19} /></span>家庭经济账</a>
      <nav><a href="#extras">阶段性收入</a><a href="#ledger">共同支出</a><a href="#timeline">资金时间轴</a><a href="#assumptions">税费参数</a></nav>
      <div className="header-actions"><Button variant="ghost" size="sm" onClick={exportCsv}><Download />下载表格</Button><Button variant="outline" size="sm" onClick={() => window.print()}><Printer />打印</Button><Button variant="outline" size="sm" onClick={resetAll}><RotateCcw />重置</Button></div>
    </header>

    <section className="workspace household-workspace" id="top">
      <div className="workspace-intro">
        <div><span className="eyebrow">HOUSEHOLD INCOME ↔ LIFE PLAN</span><h1>两个人的收入，<em>一张家庭账。</em></h1></div>
        <p>双方工资、年终奖、参保地和阶段性收入分别计算；住房、生活费、各类还款、储蓄与应急金作为家庭共同目标。没有贷款也可以直接测算。</p>
      </div>

      <section className="plan-toolbar" aria-label="保存与加载测算方案">
        <label htmlFor="plan-name">方案名称<Input id="plan-name" maxLength={80} value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="例如：北京双职工方案" /></label>
        <div className="plan-actions">
          <Button onClick={savePlan} disabled={!hydrated || isReadingPlan}><Save />保存方案</Button>
          <Button variant="outline" onClick={() => planFileInput.current?.click()} disabled={!hydrated || isReadingPlan}><FolderOpen />{isReadingPlan ? "正在读取…" : "加载方案"}</Button>
        </div>
        <input ref={planFileInput} className="hidden" type="file" accept=".json,application/json" aria-label="选择本地方案文件" onChange={readPlanFile} />
        <p>保存为本地 JSON 文件，可在本机或其他设备加载还原。CSV 表格仅供查看，不能还原页面。文件含财务信息，请妥善保管。</p>
        {planNotice && <output className="plan-notice">{planNotice}</output>}
        {planError && <p className="plan-error" role="alert">{planError}</p>}
        {storageWarning && <output className="plan-error">{storageWarning}</output>}
      </section>

      <AlertDialog open={pendingPlan !== null} onOpenChange={(open) => { if (!open) setPendingPlan(null); }}>
        <AlertDialogContent className="plan-import-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>加载并替换当前测算？</AlertDialogTitle>
            <AlertDialogDescription>加载会覆盖当前页面的输入和浏览器自动记忆。尚未下载的修改不会另存，请先保存需要保留的方案。</AlertDialogDescription>
          </AlertDialogHeader>
          {pendingPlan && <dl className="plan-preview">
            <div><dt>方案</dt><dd>{pendingPlan.name}</dd></div>
            <div><dt>保存于</dt><dd>{new Date(pendingPlan.savedAt).toLocaleString("zh-CN")}</dd></div>
            <div><dt>模式</dt><dd>{pendingPlan.state.householdMode === "couple" ? "双人家庭" : "单人"} · {pendingPlan.state.calcMode === "forward" ? "正向计算" : "反向计算"}</dd></div>
            <div><dt>支出与周期</dt><dd>{pendingPlan.state.expenses.length} 项 · {pendingPlan.state.horizon / 12} 年</dd></div>
          </dl>}
          <AlertDialogFooter><AlertDialogCancel>取消，保留当前页面</AlertDialogCancel><AlertDialogAction onClick={restorePlan}>确认加载</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="top-switches">
        <div className="mode-switch" role="tablist" aria-label="计算模式">
          <button role="tab" aria-selected={calcMode === "forward"} className={calcMode === "forward" ? "active" : ""} onClick={() => setCalcMode("forward")}><WalletCards size={18} /><span>正向计算<small>家庭收入 → 每月可留</small></span></button>
          <button role="tab" aria-selected={calcMode === "reverse"} className={calcMode === "reverse" ? "active" : ""} onClick={() => setCalcMode("reverse")}><Coins size={18} /><span>反向计算<small>共同目标 → 工资底线</small></span></button>
        </div>
        <fieldset className="household-switch"><legend className="sr-only">家庭人数模式</legend>
          <button type="button" className={householdMode === "single" ? "active" : ""} onClick={() => setHouseholdMode("single")}><UserRound size={15} />单人</button>
          <button type="button" className={householdMode === "couple" ? "active" : ""} onClick={() => setHouseholdMode("couple")}><Users size={15} />双人共同测算</button>
        </fieldset>
      </div>

      <div className={`people-grid ${householdMode}`}>
        <PersonIncomeCard person={primary} index={0} onUpdate={(patch) => updatePerson("primary", patch)} onCity={(city) => applyPersonCity("primary", city)} />
        {householdMode === "couple" && <PersonIncomeCard person={partner} index={1} onUpdate={(patch) => updatePerson("partner", patch)} onCity={(city) => applyPersonCity("partner", city)} />}
      </div>

      <div className="calc-grid household-calc-grid">
        <Card className="input-card shared-plan-card"><CardContent>
          <div className="card-kicker">家庭共同目标</div>
          <div className="quick-config">
            <fieldset className="quick-choice"><legend>生活费预设（不含还款，替换清单）</legend><div><button type="button" className={expenseScenario === "hohhot" ? "active" : ""} onClick={() => applyExpensePreset("hohhot")}>呼市估算</button><button type="button" className={expenseScenario === "beijing" ? "active" : ""} onClick={() => applyExpensePreset("beijing")}>北京估算</button></div></fieldset>
            <div className="shared-expense-now"><span>当前共同支出</span><b>¥{money(currentExpense)}<small>/月</small></b></div>
          </div>
          <label className="field-label" htmlFor="household-saving">家庭希望每月存下</label>
          <div className="money-input"><span>¥</span><Input id="household-saving" type="number" min={0} step={500} placeholder="请输入储蓄目标" value={numberFieldValue(savingsTarget)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setSavingsTarget(Number(event.target.value) || 0)} /><small>/月</small></div>
          <div className="preset-chips shared-presets">{savingsPresets.map((value) => <button type="button" key={value} className={savingsTarget === value ? "active" : ""} onClick={() => setSavingsTarget(value)}>{compactMoney(value)}</button>)}</div>
          <div className="compact-field household-reserve"><span>家庭应急金目标</span><div><Input aria-label="家庭应急金目标" type="number" min={0} step={1000} value={numberFieldValue(reserveTarget)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setReserveTarget(Number(event.target.value) || 0)} /><small>元</small></div></div>
          <div className="reserve-presets"><span>按当前共同支出快速设定</span><div>{reserveMonthPresets.map((months) => {
            const target = Math.round(currentExpense * months);
            return <button type="button" key={months} className={reserveTarget === target ? "active" : ""} onClick={() => setReserveTarget(target)}><b>{months}个月</b><small>¥{compactMoney(target)}</small></button>;
          })}</div></div>
          {calcMode === "reverse" && householdMode === "couple" && <fieldset className="reverse-owner"><legend>反向计算谁的工资</legend><div><button type="button" className={reverseOwner === "primary" ? "active" : ""} onClick={() => setReverseOwner("primary")}>固定{partner.name}，反推{primary.name}</button><button type="button" className={reverseOwner === "partner" ? "active" : ""} onClick={() => setReverseOwner("partner")}>固定{primary.name}，反推{partner.name}</button><button type="button" className={reverseOwner === "split" ? "active" : ""} onClick={() => setReverseOwner("split")}>双方同薪反推</button></div></fieldset>}
        </CardContent></Card>

        <section className={`result-panel ${calcMode}`} aria-live="polite">
          {calcMode === "forward" ? <>
            <div className="result-label">家庭首年综合月均到手</div><div className="hero-number"><span>¥</span>{money(firstYearAverageNet)}</div>
            <div className="result-rule"><span>{householdMode === "couple" ? "双方工资税前年包" : "工资税前年包"}</span><i /><b>¥{money(householdAnnualGross)}</b></div>
            {projections.map((item) => <div className="result-rule" key={item.person.id}><span>{item.person.name}工资月均到手</span><i /><b>¥{money(item.projection.averageMonthlyNet)}</b></div>)}
            <div className="result-rule"><span>家庭首年阶段性收入净值</span><i /><b>+ ¥{money(householdFirstYearExtraNet)}</b></div>
            <div className={`net-left ${firstYearAverageSurplus < 0 ? "negative" : ""}`}><span>扣除共同支出后，首年月均可留</span><b>{firstYearAverageSurplus < 0 ? "− " : ""}¥{money(Math.abs(firstYearAverageSurplus))}</b></div>
            <div className="result-caption">不含阶段性收入时，家庭工资长期月均可留 ¥{money(salarySurplus)}</div>
          </> : <>
            <div className="result-label">{reverseHeroLabel}</div><div className="hero-number"><span>¥</span>{money(reverseHeroGross)}<small>{effectiveReverseOwner === "split" ? "/人/月" : "/月"}</small></div>
            <div className="result-rule"><span>反推后的家庭工资年包</span><i /><b>¥{money(reverseHouseholdAnnualGross)}</b></div>
            {reverseProjections.map((item) => <div className="result-rule" key={item.person.id}><span>{item.person.name}对应税前月薪</span><i /><b>¥{money(reverseGrossMap[item.person.id])}</b></div>)}
            <div className="result-rule"><span>家庭阶段性收入抵扣净值</span><i /><b>− ¥{money(householdFirstYearExtraNet)}</b></div>
            <div className="result-rule"><span>目标年度净收入</span><i /><b>¥{money(reverseAnnualTarget)}</b></div>
            <div className="net-left"><span>{effectiveReverseOwner === "split" ? "双方各自现金安全月薪" : "目标一方现金安全月薪"}</span><b>¥{money(reverseCashSafeGross)}</b></div>
            <div className="result-caption">现金安全线不依赖年终奖、签字费、安家费或股票期权</div>
          </>}
          <a className="detail-link" href="#ledger">检查共同支出 <ArrowRight size={16} /></a>
        </section>
      </div>

      <div className="snapshot-grid household-snapshot">
        <article><span><Users size={17} />工资长期月均到手</span><b>¥{money(householdSalaryMonthlyNet)}</b><small>{householdMode === "couple" ? "双方合计" : "单人"}</small></article>
        <article><span><HomeIcon size={17} />当前共同支出</span><b>¥{money(currentExpense)}</b><small>/月</small></article>
        <article><span><TrendingUp size={17} />工资口径每月可留</span><b className={salarySurplus < 0 ? "danger" : ""}>¥{money(salarySurplus)}</b><small>不依赖阶段性收入</small></article>
        <article><span><PiggyBank size={17} />应急金还需</span><b>{Number.isFinite(reserveMonths) ? `${reserveMonths}个月` : "无法积累"}</b><small>目标 {compactMoney(reserveTarget)} · 已有 {compactMoney(initialSavings)}</small></article>
      </div>
    </section>

    <section className="content-section extras-section" id="extras">
      <div className="section-head"><div><span>02 · PERSON-SPECIFIC EXTRAS</span><h2>阶段性收入归到具体的人</h2></div><p>双方的签字费、安家费、股票和期权分别设置。一次性现金只进入首年，权益按各自归属期分摊，避免把短期收入误判为家庭永久现金流。</p></div>
      <div className={`person-extras-grid ${householdMode}`}>
        <PersonExtrasCard person={primary} onUpdate={(patch) => updatePerson("primary", patch)} />
        {householdMode === "couple" && <PersonExtrasCard person={partner} onUpdate={(patch) => updatePerson("partner", patch)} />}
      </div>
    </section>

    <section className="content-section" id="ledger">
      <div className="section-head"><div><span>03 · SHARED EXPENSE LEDGER</span><h2>收入分开算，家庭支出合在一起</h2></div><p>“长期”会一直计入；短期支出到期后自动退出。若某项支出属于个人，也可以在名称中注明“本人”或“伴侣”。</p></div>
      <div className="preset-row"><span>快速套用共同生活方案</span><button className={expenseScenario === "hohhot" ? "active" : ""} onClick={() => applyExpensePreset("hohhot")}><MapPin size={14} />呼和浩特估算</button><button className={expenseScenario === "beijing" ? "active" : ""} onClick={() => applyExpensePreset("beijing")}><MapPin size={14} />北京生活估算</button><small>预设不含任何还款，点击将替换当前支出清单；请按实际情况补充。</small></div>
      <div className="repayment-tools">
        <span>按需添加还款</span>
        <Button variant="outline" onClick={() => addExpense("车贷")}><Plus />车贷</Button>
        <Button variant="outline" onClick={() => addExpense("房贷")}><Plus />房贷</Button>
        <Button variant="outline" onClick={() => addExpense("其他贷款/欠款还款")}><Plus />其他贷款／欠款</Button>
        <p>无贷款无需添加，可删除不适用的项目。还款金额填写每期实际支付额（含利息），不是欠款本金；剩余月数填 0 或留空表示持续计入，不预测结束月份。</p>
      </div>
      <Card className="ledger-card"><CardContent>
        <Table><TableHeader><TableRow><TableHead>共同支出项目</TableHead><TableHead>金额</TableHead><TableHead>频率</TableHead><TableHead>持续时间</TableHead><TableHead>口径</TableHead><TableHead><span className="sr-only">操作</span></TableHead></TableRow></TableHeader>
          <TableBody>{expenses.map((item) => <TableRow key={item.id}>
            <TableCell><Input aria-label="支出项目" value={item.name} onChange={(event) => updateExpense(item.id, { name: event.target.value })} /></TableCell>
            <TableCell><div className="table-money"><span>¥</span><Input aria-label={`${item.name}金额`} type="number" min={0} step={100} value={numberFieldValue(item.amount)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateExpense(item.id, { amount: Number(event.target.value) || 0 })} /></div></TableCell>
            <TableCell><select aria-label={`${item.name}频率`} value={item.frequency} onChange={(event) => updateExpense(item.id, { frequency: event.target.value as Expense["frequency"] })}><option value="monthly">每月</option><option value="annual">每年</option><option value="once">一次性</option></select></TableCell>
            <TableCell>{item.frequency === "once" ? <span className="muted-cell">首月计入</span> : <div className="duration-input"><Input aria-label={`${item.name}持续月数`} type="number" min={0} max={12000} step={1} value={numberFieldValue(item.duration)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updateExpense(item.id, { duration: Math.min(12000, Math.max(0, Math.floor(Number(event.target.value) || 0))) })} /><small>{item.duration === 0 ? "长期/未定" : "个月"}</small></div>}</TableCell>
            <TableCell><button className={`evidence-pill ${item.confirmed ? "confirmed" : "estimated"}`} onClick={() => updateExpense(item.id, { confirmed: !item.confirmed })}>{item.confirmed ? "已确认" : "估算"}</button></TableCell>
            <TableCell><Button variant="ghost" size="icon-sm" aria-label={`删除${item.name}`} onClick={() => { setExpenseScenario("custom"); setExpenses((items) => items.filter((entry) => entry.id !== item.id)); }}><Trash2 /></Button></TableCell>
          </TableRow>)}</TableBody>
        </Table>
        <div className="ledger-footer"><Button variant="outline" onClick={() => addExpense()}><Plus />添加一项支出</Button><div><span>当前月合计</span><b>¥{money(currentExpense)}</b></div><div><span>第{horizon}个月合计</span><b>¥{money(periodEndExpense)}</b></div></div>
      </CardContent></Card>
    </section>

    <section className="dark-section" id="timeline">
      <div className="dark-inner">
        <div className="section-head light"><div><span>04 · HOUSEHOLD TIME HORIZON</span><h2>把两个人的现金流放进同一条时间轴</h2></div><p>家庭收入为双方当月收入之和；共同支出只扣一次。累计可动用余额会把上月结余滚入下月，低于0时表示家庭资金池出现缺口。</p></div>
        <div className="timeline-controls"><span>观察周期</span>{[36, 60, 120].map((value) => <button key={value} className={horizon === value ? "active" : ""} onClick={() => setHorizon(value)}>{value / 12}年</button>)}<label className="initial-savings" htmlFor="initial-savings"><span>家庭期初可用存款</span><div><b>¥</b><Input id="initial-savings" type="number" min={0} step={1000} placeholder="0" value={numberFieldValue(initialSavings)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setInitialSavings(Number(event.target.value) || 0)} /></div></label></div>
        <Card className="chart-card"><CardContent>
          <div className="timeline-axis-headings">
            <div id="monthly-axis-heading"><b>← 左轴 · 月度收支</b><span>元/月 · 收入、支出、当月结余</span></div>
            <div id="cumulative-axis-heading"><b>右轴 · 累计余额 →</b><span>万元 · 截至当月末可动用的钱</span></div>
          </div>
          <ChartContainer className="timeline-chart" config={TIMELINE_SERIES} aria-labelledby="monthly-axis-heading cumulative-axis-heading" aria-describedby="timeline-axis-help">
            <ComposedChart data={timeline} margin={{ left: 4, right: 4, top: 36, bottom: 0 }}>
              <defs><linearGradient id="surplusFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#d9ece8" stopOpacity={0.42}/><stop offset="100%" stopColor="#d9ece8" stopOpacity={0.03}/></linearGradient></defs>
              <CartesianGrid vertical={false} stroke="rgba(255,255,255,.10)" />
              <XAxis dataKey="month" tickFormatter={(value) => `${value}月`} interval={Math.max(5, Math.floor(horizon / 10))} tickLine={false} axisLine={false} />
              <YAxis className="timeline-axis-monthly" yAxisId="monthly" tickFormatter={formatMonthlyAxis} tickLine={{ stroke: "#a9c5bf" }} axisLine={{ stroke: "#a9c5bf" }} width="auto" label={{ value: "元/月", position: "top", offset: 12 }} />
              <YAxis className="timeline-axis-cumulative" yAxisId="cumulative" orientation="right" tickFormatter={formatCumulativeAxis} tickLine={{ stroke: "#f08f7e" }} axisLine={{ stroke: "#f08f7e" }} width="auto" label={{ value: "万元", position: "top", offset: 12 }} />
              <ChartTooltip content={<ChartTooltipContent className="timeline-tooltip" labelFormatter={(_label, payload) => `第${payload[0]?.payload?.month ?? ""}个月`} formatter={(value, _name, item) => {
                const series = TIMELINE_SERIES[item.dataKey as keyof typeof TIMELINE_SERIES];
                if (!series) return null;
                return <div className="timeline-tooltip-row"><span><i style={{ background: series.color }} />{series.axis} · {series.label}</span><b>{money(Number(value))} {series.unit}</b></div>;
              }} />} />
              {schedule.visibleMilestones.slice(0, 3).map((milestone) => <ReferenceLine key={milestone.releaseMonth} yAxisId="monthly" x={milestone.releaseMonth} stroke="#e5a45f" strokeDasharray="4 4" label={{ value: milestone.names.length === 1 ? `${milestone.names[0].slice(0, 8)}结束` : `${milestone.names.length}项支出结束`, fill: "#e5a45f", fontSize: 12 }} />)}
              <ReferenceLine yAxisId="cumulative" y={0} stroke="rgba(240,143,126,.45)" strokeDasharray="3 4" />
              <Area yAxisId="monthly" type="monotone" dataKey="net" stroke="var(--color-net)" fillOpacity={0} strokeWidth={2} />
              <Area yAxisId="monthly" type="stepAfter" dataKey="expense" stroke="var(--color-expense)" fillOpacity={0} strokeWidth={2} />
              <Area yAxisId="monthly" type="monotone" dataKey="surplus" stroke="var(--color-surplus)" fill="url(#surplusFill)" strokeWidth={2} />
              <Line yAxisId="cumulative" type="monotone" dataKey="cumulative" stroke="var(--color-cumulative)" strokeWidth={3} dot={false} activeDot={{ r: 4 }} />
            </ComposedChart>
          </ChartContainer>
          <div className="chart-legend timeline-axis-legend">{Object.entries(TIMELINE_SERIES).map(([key, series]) => <span key={key}><i style={{ background: series.color }} />{series.label}<small>{series.axis}</small></span>)}</div>
          <div className="timeline-axis-help" id="timeline-axis-help">
            <p><b>左轴怎么看：</b>10,000 表示每月 10,000 元。当月结余 = 月均到手 − 当月支出；结余低于 0 表示该月入不敷出。</p>
            <p><b>右轴怎么看：</b>10 表示累计 10 万元。累计余额 = 期初存款 + 截至当月的所有结余；余额低于 0 表示存款也不足以覆盖累计缺口。</p>
            <p className="timeline-scale-note">左右轴独立缩放，曲线的高度或交点不能直接比较金额。悬停或点选月份可查看具体金额，提示框统一换算为元。收入沿用月均摊测算口径，不代表实际发薪时间。</p>
          </div>
        </CardContent></Card>
        <div className="timeline-insights">
          <article><span>第{insightMonth}个月可动用余额</span><b>¥{money(timeline[insightMonth - 1]?.cumulative ?? initialSavings)}</b><p>{nextVisibleMilestone ? `${nextVisibleMilestone.names.join("、")}停止计入后的首月` : "第一年末参考值，不假设有任何贷款到期"}</p></article>
          <article><span>{horizon / 12}年后可动用余额</span><b>¥{money(timeline.at(-1)?.cumulative ?? initialSavings)}</b><p>未计投资收益与双方工资增长</p></article>
          <article>{nextVisibleMilestone ? <><span>下个到期点减少月均支出</span><b>− ¥{money(nextVisibleMilestone.monthlyReduction)}</b><p>从第{nextVisibleMilestone.releaseMonth}个月起 · {nextVisibleMilestone.names.join("、")}</p></> : nextMilestone ? <><span>下一项支出到期</span><b>第{nextMilestone.releaseMonth}个月</b><p>{nextMilestone.names.join("、")} · 超出当前周期，本周期继续计入</p></> : <><span>未设置到期支出</span><b>按当前期限计入</b><p>无贷款无需添加；未设到期月的支出不会自动消失</p></>}</article>
        </div>
        {schedule.milestones.length > 0 ? <details className="expense-milestones">
          <summary>支出到期计划（{schedule.milestones.length}个节点）</summary>
          <p>图中标记本周期内前3个节点。最后一期仍计入，下一月开始减少支出；年费按月均摊，一次性费用不列作到期节点。</p>
          <ul>{schedule.milestones.map((milestone) => <li key={milestone.releaseMonth}><span>{milestone.names.join("、")}</span><span>计入至第{milestone.lastPaymentMonth}个月；第{milestone.releaseMonth}个月起月均减少 ¥{money(milestone.monthlyReduction)}{milestone.releaseMonth > horizon ? "（超出本周期）" : ""}</span></li>)}</ul>
        </details> : <p className="milestone-note">当前没有设置期限的持续性支出，图中不显示任何还款结束节点。一次性费用仍只在首月计入。</p>}
      </div>
    </section>

    <section className="content-section offer-section">
      <div className="section-head"><div><span>05 · HOUSEHOLD OFFER MATRIX</span><h2>换一个人的Offer，看整个家庭会怎样</h2></div><p>只替换目标一方的月薪，另一方收入固定。“{horizon / 12}年末工资可留”按第{horizon}个月的实际支出计算，不含阶段性收入；超出观察期的还款仍计入。</p></div>
      {householdMode === "couple" && <div className="compare-person"><span>比较对象</span><button className={effectiveCompareId === "primary" ? "active" : ""} onClick={() => setComparePersonId("primary")}>{primary.name}</button><button className={effectiveCompareId === "partner" ? "active" : ""} onClick={() => setComparePersonId("partner")}>{partner.name}</button><small>另一方收入固定</small></div>}
      <Card className="matrix-card"><CardContent><Table><TableHeader><TableRow><TableHead>{comparePerson.name}税前月薪</TableHead><TableHead>家庭工资年包</TableHead><TableHead>家庭工资长期月均</TableHead><TableHead>家庭首年综合月均</TableHead><TableHead>首年每月可留</TableHead><TableHead>{horizon / 12}年末工资可留</TableHead><TableHead>判断</TableHead></TableRow></TableHeader><TableBody>{offerRows.map((item) => <TableRow key={item.salary} className={item.salary === Math.round(comparePerson.gross / 500) * 500 ? "current-row" : ""}><TableCell><b>¥{money(item.salary)}</b></TableCell><TableCell>{compactMoney(item.annualGross)}</TableCell><TableCell>¥{money(item.longTermNet)}</TableCell><TableCell>¥{money(item.firstYearNet)}</TableCell><TableCell className={item.currentLeft < 0 ? "negative-text" : ""}>{item.currentLeft < 0 ? "−" : "+"} ¥{money(Math.abs(item.currentLeft))}</TableCell><TableCell className={item.futureLeft < 0 ? "negative-text" : "positive-text"}>{item.futureLeft < 0 ? "−" : "+"} ¥{money(Math.abs(item.futureLeft))}</TableCell><TableCell><span className={`decision-pill ${item.currentLeft >= savingsTarget ? "good" : item.currentLeft >= 0 ? "tight" : "bad"}`}>{item.currentLeft >= savingsTarget ? "达到家庭目标" : item.currentLeft >= 0 ? "能覆盖但偏紧" : "家庭现金缺口"}</span></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    </section>

    <section className="content-section settings-section" id="assumptions">
      <div className="section-head"><div><span>06 · PERSON-SPECIFIC TAX</span><h2>双方税费和参保地分别校准</h2></div><p>夫妻可能在不同城市、不同单位参保。每个人都保留独立的社保、公积金、专项附加扣除和实际缴费基数。</p></div>
      <div className="person-tax-grid">{projections.map(({ person, projection }) => <div className="person-tax-block" key={person.id}>
        <div className="person-tax-summary"><div><span><ShieldCheck size={17} />{person.name}</span><small>{person.config.name}</small></div><div><span>五险一金/月</span><b>¥{money(projection.contribution.total)}</b></div><div><span>全年个税</span><b>¥{money(projection.bestTax)}</b></div><div><span>工资月均到手</span><b>¥{money(projection.averageMonthlyNet)}</b></div></div>
        <details className="advanced-settings"><summary><Settings2 size={17} /><span>展开{person.name}详细参数</span><small>拿到HR缴费基数后建议逐项修改</small></summary><div className="settings-grid">
          <div className="setting-field"><span>养老个人比例</span><div><Input aria-label={`${person.name}养老个人比例`} type="number" step={0.1} value={numberFieldValue(person.config.pensionRate * 100)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "pensionRate", (Number(event.target.value) || 0) / 100)} /><small>%</small></div></div>
          <div className="setting-field"><span>医疗个人比例</span><div><Input aria-label={`${person.name}医疗个人比例`} type="number" step={0.1} value={numberFieldValue(person.config.medicalRate * 100)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "medicalRate", (Number(event.target.value) || 0) / 100)} /><small>%</small></div></div>
          <div className="setting-field"><span>失业个人比例</span><div><Input aria-label={`${person.name}失业个人比例`} type="number" step={0.1} value={numberFieldValue(person.config.unemploymentRate * 100)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "unemploymentRate", (Number(event.target.value) || 0) / 100)} /><small>%</small></div></div>
          <div className="setting-field"><span>公积金个人比例</span><div><Input aria-label={`${person.name}公积金个人比例`} type="number" step={1} min={0} max={20} value={numberFieldValue(person.config.housingRate * 100)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "housingRate", (Number(event.target.value) || 0) / 100)} /><small>%</small></div></div>
          <div className="setting-field"><span>养老/失业基数下限</span><Input aria-label={`${person.name}养老失业基数下限`} type="number" value={numberFieldValue(person.config.pensionMin)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "pensionMin", Number(event.target.value) || 0)} /></div>
          <div className="setting-field"><span>养老/失业基数上限</span><Input aria-label={`${person.name}养老失业基数上限`} type="number" value={numberFieldValue(person.config.pensionMax)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "pensionMax", Number(event.target.value) || 0)} /></div>
          <div className="setting-field"><span>医保基数下限</span><Input aria-label={`${person.name}医保基数下限`} type="number" value={numberFieldValue(person.config.medicalMin)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "medicalMin", Number(event.target.value) || 0)} /></div>
          <div className="setting-field"><span>医保基数上限</span><Input aria-label={`${person.name}医保基数上限`} type="number" value={numberFieldValue(person.config.medicalMax)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "medicalMax", Number(event.target.value) || 0)} /></div>
          <div className="setting-field"><span>公积金基数下限</span><Input aria-label={`${person.name}公积金基数下限`} type="number" value={numberFieldValue(person.config.housingMin)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "housingMin", Number(event.target.value) || 0)} /></div>
          <div className="setting-field"><span>公积金基数上限</span><Input aria-label={`${person.name}公积金基数上限`} type="number" value={numberFieldValue(person.config.housingMax)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePersonConfig(person.id, "housingMax", Number(event.target.value) || 0)} /></div>
          <div className="setting-field"><span>专项附加扣除</span><div><Input aria-label={`${person.name}专项附加扣除`} type="number" step={100} value={numberFieldValue(person.extraDeduction)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePerson(person.id, { extraDeduction: Number(event.target.value) || 0 })} /><small>元/月</small></div></div>
          <div className="setting-field toggle-label"><span>缴费基数</span><button className={person.autoBase ? "active" : ""} onClick={() => updatePerson(person.id, { autoBase: !person.autoBase })}>{person.autoBase ? "按工资自动套上下限" : "使用手工基数"}</button></div>
          {!person.autoBase && <><div className="setting-field"><span>养老/失业实际基数</span><Input aria-label={`${person.name}养老失业实际基数`} type="number" value={numberFieldValue(person.manualBases.pension)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePerson(person.id, { manualBases: { ...person.manualBases, pension: Number(event.target.value) || 0 } })} /></div><div className="setting-field"><span>医保实际基数</span><Input aria-label={`${person.name}医保实际基数`} type="number" value={numberFieldValue(person.manualBases.medical)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePerson(person.id, { manualBases: { ...person.manualBases, medical: Number(event.target.value) || 0 } })} /></div><div className="setting-field"><span>公积金实际基数</span><Input aria-label={`${person.name}公积金实际基数`} type="number" value={numberFieldValue(person.manualBases.housing)} onFocus={(event) => event.currentTarget.select()} onChange={(event) => updatePerson(person.id, { manualBases: { ...person.manualBases, housing: Number(event.target.value) || 0 } })} /></div></>}
        </div></details>
      </div>)}</div>
      <div className="tax-breakdown household-tax-summary"><article><ShieldCheck size={18} /><span>家庭五险一金 / 年</span><b>¥{money(householdAnnualContributions)}</b><small>双方个人缴纳部分合计</small></article><article><CalendarClock size={18} /><span>家庭全年个税</span><b>¥{money(householdAnnualTax)}</b><small>双方分别计税后合计，不进行夫妻合并申报</small></article><article><CircleHelp size={18} /><span>家庭工资长期月均</span><b>¥{money(householdSalaryMonthlyNet)}</b><small>普通工资月合计约 ¥{money(householdRegularMonthlyNet)}</small></article></div>
    </section>

    <section className="sources-section"><div><span>核验日期 2026-08-31</span><h2>计算口径与来源</h2><p>这是家庭求职与现金流决策估算器，不是报税或社保申报工具。双方实际到手会分别受工资结构、缴费基数、补充公积金、专项扣除归属和入职月份影响。</p></div><div className="source-list">{sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noreferrer"><span>{source.label}</span><ExternalLink size={14} /></a>)}</div></section>
    <footer><div><span className="brand-dot"><Users size={16} /></span><b>家庭经济账</b></div><p>你的数据只保存在当前设备浏览器中 · 2026-08-31</p></footer>
  </main>;
}
