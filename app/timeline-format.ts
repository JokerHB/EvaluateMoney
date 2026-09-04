// Chart coordinates keep the underlying values in yuan; only tick text changes.
const yuan = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });
const wanYuan = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 });

export const formatMonthlyAxis = (value: number) => yuan.format(value);
export const formatCumulativeAxis = (value: number) => wanYuan.format(value / 10000);

export const TIMELINE_SERIES = {
  net: { label: "家庭月均到手", color: "#e5a45f", axis: "左轴", unit: "元/月" },
  expense: { label: "共同月支出", color: "#8ab0aa", axis: "左轴", unit: "元/月" },
  surplus: { label: "家庭当月结余", color: "#d9ece8", axis: "左轴", unit: "元/月" },
  cumulative: { label: "累计可动用余额", color: "#f08f7e", axis: "右轴", unit: "元" },
} as const;
