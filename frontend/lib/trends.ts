import { Minus, TrendingDown, TrendingUp } from "lucide-react";

export type Trend = "improving" | "stuck" | "getting_worse";

export function trendLabel(trend: Trend): string {
  if (trend === "improving") return "Improving";
  if (trend === "getting_worse") return "Needs work";
  return "Steady";
}

export function TrendIcon({
  trend,
  className = "h-3.5 w-3.5",
}: {
  trend: Trend;
  className?: string;
}) {
  if (trend === "improving") {
    return <TrendingUp className={`${className} text-emerald-500`} />;
  }
  if (trend === "getting_worse") {
    return <TrendingDown className={`${className} text-red-500`} />;
  }
  return <Minus className={`${className} text-slate-400`} />;
}

export function accuracyTone(pct: number): string {
  if (pct >= 75) return "text-emerald-600";
  if (pct >= 50) return "text-amber-600";
  return "text-red-600";
}
