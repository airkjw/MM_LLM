import { isIP } from "node:net";

export type MediaKind = "image" | "audio" | "video";
export type DetectedMedia = { kind: MediaKind | "document"; mime: string; extension: string };

function ipv4Number(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const values = parts.map(Number);
  if (values.some((part) => part > 255)) return null;
  return (((values[0] * 256 + values[1]) * 256 + values[2]) * 256 + values[3]) >>> 0;
}

function inIpv4Cidr(address: number, network: string, prefix: number): boolean {
  const base = ipv4Number(network);
  if (base === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (base & mask);
}

function ipv6Number(address: string): bigint | null {
  let source = address.toLowerCase();
  if (source.startsWith("[") && source.endsWith("]")) source = source.slice(1, -1);
  if (source.includes("%") || source.split("::").length > 2) return null;
  const ipv4Tail = source.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail) {
    const value = ipv4Number(ipv4Tail);
    if (value === null) return null;
    source = source.slice(0, -ipv4Tail.length) +
      `${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }
  const [leftSource, rightSource = ""] = source.split("::");
  const left = leftSource ? leftSource.split(":") : [];
  const right = rightSource ? rightSource.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((source.includes("::") && missing < 1) || (!source.includes("::") && missing !== 0)) return null;
  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right];
  if (groups.length !== 8) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}

function inIpv6Cidr(address: bigint, network: bigint, prefix: number): boolean {
  const shift = BigInt(128 - prefix);
  return (address >> shift) === (network >> shift);
}

/** Returns true only for addresses that are safe to contact as public Internet media origins. */
export function isPublicIpAddress(rawAddress: string): boolean {
  const address = rawAddress.startsWith("[") && rawAddress.endsWith("]")
    ? rawAddress.slice(1, -1) : rawAddress;
  const family = isIP(address);
  if (family === 4) {
    const value = ipv4Number(address);
    if (value === null) return false;
    const blocked: Array<[string, number]> = [
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
      ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]
    ];
    return !blocked.some(([network, prefix]) => inIpv4Cidr(value, network, prefix));
  }
  if (family !== 6) return false;
  const value = ipv6Number(address);
  if (value === null) return false;
  // IPv4-mapped IPv6 must inherit the embedded IPv4 policy.
  if ((value >> 32n) === 0xffffn) {
    const embedded = Number(value & 0xffffffffn) >>> 0;
    return isPublicIpAddress([
      embedded >>> 24, (embedded >>> 16) & 255, (embedded >>> 8) & 255, embedded & 255
    ].join("."));
  }
  // Restrict direct IPv6 connections to global unicast, then exclude special transition/documentation blocks.
  if (!inIpv6Cidr(value, 0x20000000000000000000000000000000n, 3)) return false;
  const blocked: Array<[bigint, number]> = [
    [0x20010000000000000000000000000000n, 32], // Teredo and protocol assignments
    [0x20010002000000000000000000000000n, 48], // benchmarking
    [0x20010010000000000000000000000000n, 28], // ORCHID
    [0x20010020000000000000000000000000n, 28], // ORCHIDv2
    [0x20010db8000000000000000000000000n, 32], // documentation
    [0x20020000000000000000000000000000n, 16]  // 6to4 can tunnel to non-public IPv4
  ];
  return !blocked.some(([network, prefix]) => inIpv6Cidr(value, network, prefix));
}

export function detectMedia(bytes: Uint8Array): DetectedMedia | null {
  const ascii = Buffer.from(bytes.subarray(0, 64)).toString("ascii").trimStart().toLowerCase();
  if (ascii.startsWith("<svg") || ascii.startsWith("<html") || ascii.startsWith("<!doctype")) return null;
  const b = bytes;
  if (b.length >= 8 && Buffer.from(b.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10])))
    return { kind: "image", mime: "image/png", extension: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: "image", mime: "image/jpeg", extension: "jpg" };
  if (ascii.startsWith("gif87a") || ascii.startsWith("gif89a")) return { kind: "image", mime: "image/gif", extension: "gif" };
  if (ascii.startsWith("riff") && Buffer.from(b.subarray(8, 12)).toString("ascii") === "WEBP")
    return { kind: "image", mime: "image/webp", extension: "webp" };
  if (ascii.startsWith("riff") && Buffer.from(b.subarray(8, 12)).toString("ascii") === "WAVE")
    return { kind: "audio", mime: "audio/wav", extension: "wav" };
  if (ascii.startsWith("id3") || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0))
    return { kind: "audio", mime: "audio/mpeg", extension: "mp3" };
  if (ascii.startsWith("oggs")) return { kind: "audio", mime: "audio/ogg", extension: "ogg" };
  if (ascii.startsWith("flac")) return { kind: "audio", mime: "audio/flac", extension: "flac" };
  if (ascii.startsWith("form") && ["AIFF", "AIFC"].includes(Buffer.from(b.subarray(8, 12)).toString("ascii")))
    return { kind: "audio", mime: "audio/aiff", extension: "aiff" };
  if (b.length >= 12 && Buffer.from(b.subarray(4, 8)).toString("ascii") === "ftyp")
    return { kind: "video", mime: "video/mp4", extension: "mp4" };
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3)
    return { kind: "video", mime: "video/webm", extension: "webm" };
  return null;
}
