/** Chapter cover photos from Wikimedia Commons (public domain / CC scientific images). */

export default function ChapterCover({
  id,
  unit,
}: {
  id: string;
  unit?: string;
}) {
  const label = unit ? String(unit).padStart(2, "0") : "";

  return (
    <div className="relative h-28 overflow-hidden bg-slate-200">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/chapter-covers/${id}.jpg`}
        alt=""
        className="h-full w-full object-cover"
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-black/10 to-transparent" />
      {label && (
        <span className="absolute bottom-2.5 right-3 text-[11px] font-bold tracking-widest text-white drop-shadow">
          CH {label}
        </span>
      )}
    </div>
  );
}
