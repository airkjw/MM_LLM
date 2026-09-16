export function markdownImagePresentation(src: string | undefined, alt: string | undefined): {
  label: string; externalUrl?: string;
} {
  const label = alt?.trim() || "원격 이미지";
  return typeof src === "string" && src.startsWith("https://")
    ? { label, externalUrl: src }
    : { label };
}
