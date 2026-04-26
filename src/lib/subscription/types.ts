export type DeviceProtocol = "wireguard" | "xray" | "socks5";

export type EntryNodeContext = {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  wgPort: number;
  wgPublicKey: string;
  wgAddress: string;
  xrayPort: number | null;
  xrayTransport: string | null;
  xrayTlsDomain: string | null;
  xrayWsPath: string | null;
  realityPublicKey: string | null;
  realityShortId: string | null;
  realityServerName: string | null;
};

export type DeviceContext = {
  id: number;
  name: string;
  protocol: DeviceProtocol;
  lineId: number;
  lineXrayPort: number | null;
  lineSocks5Port: number | null;
  entry: EntryNodeContext;

  wg?: {
    privateKey: string;
    publicKey: string;
    address: string;
    addressIp: string;
  };

  xray?: {
    uuid: string;
  };

  socks5?: {
    username: string;
    password: string;
  };
};

export type SubscriptionGroupRow = {
  id: number;
  name: string;
  token: string;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClashProxy = Record<string, unknown> & {
  name: string;
  type: string;
  server: string;
  port: number;
};
