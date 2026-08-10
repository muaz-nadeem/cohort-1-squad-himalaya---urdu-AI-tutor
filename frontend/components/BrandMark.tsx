import Image from "next/image";

/** Book+quill mark only — pair with the “uraan” wordmark in layout. */
export default function BrandMark({
  className = "h-8 w-8",
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/uraan-mark.png"
      alt=""
      width={128}
      height={128}
      className={`object-contain ${className}`}
      priority={priority}
      aria-hidden
    />
  );
}
