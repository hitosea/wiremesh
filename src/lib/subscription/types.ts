export type { DeviceProtocol } from "@/lib/protocols";

export type EntryNodeContext = {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  wgPort: number;
  wgPublicKey: string;
  wgAddress: string;
  // active transport for this device:
  xrayReality?: { publicKey: string; shortId: string; dest: string; serverName: string } | null;
  xrayWsTls?: { wsPath: string; tlsDomain: string } | null;
};

export type DeviceContext = {
  id: number;
  name: string;
  remark: string | null;
  protocol: import("@/lib/protocols").DeviceProtocol;
  lineId: number | null;
  linePort: number | null; // port for THIS device's protocol
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
