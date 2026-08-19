import Image from "next/image";
import type { DoctorPersona } from "@/lib/doctorPersona";

export default function DoctorAvatar({
  doctor,
  size = "md",
}: {
  doctor: DoctorPersona;
  size?: "sm" | "md" | "lg";
}) {
  const dim =
    size === "sm" ? "h-8 w-8" : size === "lg" ? "h-16 w-16" : "h-10 w-10";
  const px = size === "sm" ? 64 : size === "lg" ? 128 : 80;
  return (
    <span
      className={`relative inline-flex shrink-0 overflow-hidden rounded-full bg-sky-100 shadow-sm ring-2 ring-white ${dim}`}
    >
      <Image
        src="/doctor-avatar.png"
        alt={doctor.displayName}
        width={px}
        height={px}
        className="h-full w-full object-cover object-[center_12%]"
      />
    </span>
  );
}
