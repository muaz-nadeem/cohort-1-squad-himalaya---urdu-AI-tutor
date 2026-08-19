import type { DoctorPersona } from "@/lib/doctorPersona";

export default function DoctorAvatar({
  doctor,
  size = "md",
}: {
  doctor: DoctorPersona;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm"
      ? "h-8 w-8 text-[10px]"
      : size === "lg"
        ? "h-14 w-14 text-lg"
        : "h-10 w-10 text-xs";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-sm ${dim}`}
      style={{ backgroundColor: `hsl(${doctor.hue} 42% 42%)` }}
      aria-hidden
    >
      {doctor.initials}
    </span>
  );
}
