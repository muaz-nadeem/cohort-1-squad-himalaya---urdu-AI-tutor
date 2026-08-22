import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Apple,
  Atom,
  Bone,
  Brain,
  Bug,
  Dna,
  Flower2,
  HeartPulse,
  Microscope,
  Shield,
  Sun,
  Trees,
  Wind,
  FlaskConical,
  Scale,
} from "lucide-react";

type Cover = {
  Icon: LucideIcon;
  from: string;
  to: string;
};

const DEFAULT_COVER: Cover = {
  Icon: Microscope,
  from: "from-brand",
  to: "to-brand-700",
};

const COVERS: Record<string, Cover> = {
  acellular_life: { Icon: Bug, from: "from-violet-500", to: "to-indigo-800" },
  bioenergetics: { Icon: Sun, from: "from-amber-400", to: "to-orange-700" },
  biological_molecules: { Icon: Atom, from: "from-sky-400", to: "to-cyan-800" },
  cell_structure: { Icon: FlaskConical, from: "from-teal-400", to: "to-emerald-800" },
  coordination_control: { Icon: Brain, from: "from-fuchsia-500", to: "to-purple-800" },
  enzymes: { Icon: Activity, from: "from-lime-500", to: "to-green-800" },
  evolution: { Icon: Trees, from: "from-emerald-500", to: "to-stone-800" },
  reproduction: { Icon: Flower2, from: "from-rose-400", to: "to-pink-800" },
  support_movement: { Icon: Bone, from: "from-slate-400", to: "to-slate-700" },
  inheritance: { Icon: Dna, from: "from-indigo-400", to: "to-blue-900" },
  circulation: { Icon: HeartPulse, from: "from-red-400", to: "to-rose-800" },
  immunity: { Icon: Shield, from: "from-sky-500", to: "to-brand-700" },
  respiration: { Icon: Wind, from: "from-cyan-400", to: "to-slate-700" },
  digestion: { Icon: Apple, from: "from-orange-400", to: "to-red-800" },
  homeostasis: { Icon: Scale, from: "from-blue-400", to: "to-indigo-800" },
  biotechnology: { Icon: Microscope, from: "from-brand", to: "to-sky-900" },
};

export default function ChapterCover({
  id,
  unit,
}: {
  id: string;
  unit?: string;
}) {
  const cover = COVERS[id] ?? DEFAULT_COVER;
  const Icon = cover.Icon;
  const label = unit ? String(unit).padStart(2, "0") : "";

  return (
    <div
      className={`relative h-28 overflow-hidden bg-gradient-to-br ${cover.from} ${cover.to}`}
    >
      <div className="absolute -right-4 -top-6 h-28 w-28 rounded-full bg-white/10" />
      <div className="absolute -bottom-10 left-8 h-24 w-24 rounded-full bg-black/10" />
      <Icon
        className="absolute -bottom-3 -right-2 h-24 w-24 text-white/15"
        strokeWidth={1.25}
      />
      <div className="relative flex h-full items-end justify-between px-4 pb-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 text-white shadow-sm backdrop-blur-[2px]">
          <Icon className="h-5 w-5" strokeWidth={2} />
        </span>
        {label && (
          <span className="text-[11px] font-bold tracking-widest text-white/80">
            CH {label}
          </span>
        )}
      </div>
    </div>
  );
}
