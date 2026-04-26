function parseSubnet(cidr: string): { base: number[]; mask: number } {
  const [ip, bits] = cidr.split("/");
  return { base: ip.split(".").map(Number), mask: parseInt(bits) };
}

function ipToString(parts: number[]): string {
  return parts.join(".");
}

function extractHost(address: string): string {
  return address.split("/")[0];
}

export function allocateNodeIp(
  usedAddresses: string[],
  subnet: string,
  startPos: number
): string {
  const { base, mask } = parseSubnet(subnet);
  const usedHosts = new Set(usedAddresses.map(extractHost));
  for (let i = startPos; i <= 254; i++) {
    const ip = ipToString([base[0], base[1], base[2], i]);
    if (!usedHosts.has(ip)) return `${ip}/${mask}`;
  }
  throw new Error("No available IP addresses in node range");
}

export function allocateDeviceIp(
  usedAddresses: string[],
  subnet: string,
  startPos: number
): string {
  const { base, mask } = parseSubnet(subnet);
  const usedHosts = new Set(usedAddresses.map(extractHost));
  for (let i = startPos; i <= 254; i++) {
    const ip = ipToString([base[0], base[1], base[2], i]);
    if (!usedHosts.has(ip)) return `${ip}/${mask}`;
  }
  throw new Error("No available IP addresses in device range");
}

export function allocateTunnelSubnet(
  usedAddresses: string[],
  tunnelSubnet: string
): { fromAddress: string; toAddress: string } {
  const { base } = parseSubnet(tunnelSubnet);
  const usedHosts = new Set(usedAddresses.map(extractHost));
  const baseNum = (base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3];
  for (let offset = 0; offset < 65536; offset += 4) {
    const subnetStart = baseNum + offset;
    const fromParts = [
      ((subnetStart + 1) >>> 24) & 0xff,
      ((subnetStart + 1) >>> 16) & 0xff,
      ((subnetStart + 1) >>> 8) & 0xff,
      (subnetStart + 1) & 0xff,
    ];
    const toParts = [
      ((subnetStart + 2) >>> 24) & 0xff,
      ((subnetStart + 2) >>> 16) & 0xff,
      ((subnetStart + 2) >>> 8) & 0xff,
      (subnetStart + 2) & 0xff,
    ];
    const fromIp = ipToString(fromParts);
    const toIp = ipToString(toParts);
    if (!usedHosts.has(fromIp) && !usedHosts.has(toIp)) {
      return { fromAddress: `${fromIp}/30`, toAddress: `${toIp}/30` };
    }
  }
  throw new Error("No available /30 subnets in tunnel range");
}

export function allocateTunnelPort(
  usedPorts: number[],
  startPort: number,
  blacklist: Set<number> = new Set()
): number {
  const usedSet = new Set(usedPorts);
  for (let port = startPort; port < 65535; port++) {
    if (!usedSet.has(port) && !blacklist.has(port)) return port;
  }
  throw new Error("No available tunnel ports");
}

export function parseTunnelPortBlacklist(csv: string): number[] {
  return csv
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 65536);
}
