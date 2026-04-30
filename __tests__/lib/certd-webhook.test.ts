import { describe, it, expect, beforeEach, vi } from "vitest";

const TEST_CRT = `-----BEGIN CERTIFICATE-----
MIIDFzCCAf+gAwIBAgIUTm6JlGV6HcXDKMfhDT5VnV/ZoMIwDQYJKoZIhvcNAQEL
BQAwGzEZMBcGA1UEAwwQdGVzdC5leGFtcGxlLmNvbTAeFw0yNjA0MzAwMTMzMDFa
Fw0yNzA0MzAwMTMzMDFaMBsxGTAXBgNVBAMMEHRlc3QuZXhhbXBsZS5jb20wggEi
MA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQC2NQZncvDuEyewldkPd2aF86jo
IPR7H8Hq56wQhz7pw96iZqxcDAgW64MVZLJ5AVReACr+tAyR1SRlMIoNVaezjw8k
xHE55AaAatv6nNfXdbLmbVgiXtqGB8laVQGU++sp6ogZ1jAMXRGQSD2Zfs6t5nFu
jsjYGecaHX3zZUPxVsKkPxJQp7rehttLfa7EhxlHDmtwzcakTfyHwmfIwxamYX/e
Q4PKp/KH9nKGLqF/k01G+3zktAD0fKULqCfgwFCncPe+4t3Tkxpx4ZNtV5L82KNJ
kWMyxY0DIve2j7dlqcW8VtX6wyQjYkpT+FGDhL2gGtlXRSm4T8W9oyk6tlzlAgMB
AAGjUzBRMB0GA1UdDgQWBBSh5ummz+/OnpHQPnL1xkXRLXUDpjAfBgNVHSMEGDAW
gBSh5ummz+/OnpHQPnL1xkXRLXUDpjAPBgNVHRMBAf8EBTADAQH/MA0GCSqGSIb3
DQEBCwUAA4IBAQB/lBdpik3+mCFCBJvkLFPrHYOAOCvsXhDqUwoqP6+n5LPzhecl
V0DzkK7uED4AHduchw/cNSWCPFEBbYtcrw6LKJLrYPEWxlOySV1Z/jM/xM4iwNPU
I3YAneryIOUAj7vTtHPQXfRL0+jTVgo6Ts8iogLBLz4aoKiVYgfHIu0ROrXvm6bp
3Bn6RxCGVKGoHdjWTjvmvj02Mo4nRostvKSjGQUUXp9vWB/kmHnsOk93406Vuk00
J56LL2xbQ3s8bePmsrQOHQYVb7aSpfUYoZagcjUS34qFIkp+2lwSzhuMrvTFnJUj
zvqciE/o8kqhTSNYLj2afAnVyLpEC3INrJg2
-----END CERTIFICATE-----
`;

const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQC2NQZncvDuEyew
ldkPd2aF86joIPR7H8Hq56wQhz7pw96iZqxcDAgW64MVZLJ5AVReACr+tAyR1SRl
MIoNVaezjw8kxHE55AaAatv6nNfXdbLmbVgiXtqGB8laVQGU++sp6ogZ1jAMXRGQ
SD2Zfs6t5nFujsjYGecaHX3zZUPxVsKkPxJQp7rehttLfa7EhxlHDmtwzcakTfyH
wmfIwxamYX/eQ4PKp/KH9nKGLqF/k01G+3zktAD0fKULqCfgwFCncPe+4t3Tkxpx
4ZNtV5L82KNJkWMyxY0DIve2j7dlqcW8VtX6wyQjYkpT+FGDhL2gGtlXRSm4T8W9
oyk6tlzlAgMBAAECggEAHVvt7D1ZFQOBIbMDhrp2ip74WG729d/oHzG1R/SC7qfg
98oTe8F0jDzmokvXdigAsCTWyLO6UsVFWAi6NevXWddzWTlOBUX4xjhxubAMF2uf
qAF2chNWosIeb6/C0X7GJbrks0UP+O4GJnl9c347T0oSfP4E3s1Nr6eQ4+ctS3Wp
xoqnBg+q9+TS0u2CvSQW4+ySHlLEI85L1nuGOUSPByaQzJWDxClNARJbjo7K9R22
vViyU9uCA14pRG1qcINY9FewUug/yjwECZPUJ4b5dq3j4l56PD8fvDfdKtdVTXA5
gyKoMkIMXVMY7nYSBTOZLKSXQRANYDSSIYgXU+qXAQKBgQDeDMlxV5oZf+RtUDJJ
iRaM1VMi6lcXNPqNYNqSAn/Lv69hHiryDhrRWkxYfIK3rM9Wr55wRJAP1E5ghz3h
gVsPREPg/7OYZPCO35a7TkYzk0BRB+fR8DPVxR/x4hU0m4lyw1BKknoNNKw+jtFy
5cpznLsO6lB/HGENPanEuOSLhwKBgQDSEMIZlftgBdC3GlEThPiYqYCRLq9BgX9F
68UBfRSLx+ryEWW/qNcvqpOvvJ7h+JFAaHGdY0vAR715+1T4EkLkf3nGlj/idn6D
raQcgCfYfM+IKlUXmBBC/dPcpjY9oacjLqVM1vhxthgHE+pZTOmmUo494F3Rx1Pm
gnEISesnMwKBgDneq0FWy1qJ8kZq+DAiAjaCAkC/QiNSM1pVO6GB9TxsoJB3BEpB
Usvs9Ki7CnZEG2VEL86ij8kQU7zkgkQbKlg4OliRS4UUCX2y193I8JLQdZqorMoS
B/BWh5TKjyw+vPuj23ET66s1Zw6Guh9vs+udlUK13nTCOKjywSP769RRAoGAbLht
rQ5Z9t2ro0jEk4SroV+BAiMWY6HhPFAFO3sAKkRDDhwA/Ewnay0umLLXzH54tswX
mWyt5Qt8PmjdFjNlWZu8bBKRZ+UKH568JGATv1EBnCjEt5xlNjbm8vk3c3h555SZ
ywYrubaUAv3EuYk8GG/73HyGMi+m9dOnKrIPOc8CgYASfTxyvpOJ3mDnjiVb1bH+
X4bNEIydIDDUlXe3yfm+4jYIgjKcoN0Ci0DcdZ2pTT6x+oe5GcmvPezSUcIbm6aZ
gtA3Mrg6ubp0btQeTfk/pA7UuttqHcEwtFOjNDiiXOktA/xxsIIuR2VfzEvOBlzA
cX9hiBOBwKkx+hAbPayvrg==
-----END PRIVATE KEY-----
`;

type NodeRow = {
  id: number;
  xrayTransport: string | null;
  xrayTlsDomain: string | null;
  xrayTlsCert: string | null;
  xrayTlsKey: string | null;
  updatedAt: string | null;
};

const dbState: { rows: NodeRow[] } = { rows: [] };
const sseState: { notified: number[] } = { notified: [] };

vi.mock("@/lib/db", () => {
  type WhereCheck = (row: NodeRow) => boolean;
  type DbMock = {
    select: () => { from: () => { where: (c: WhereCheck) => { all: () => NodeRow[] } } };
    update: () => { set: (p: Partial<NodeRow>) => { where: (c: WhereCheck) => { run: () => void } } };
    transaction: (cb: (tx: DbMock) => void) => void;
  };
  const dbMock: DbMock = {
    select: () => ({
      from: () => ({
        where: (check: WhereCheck) => ({
          all: () => dbState.rows.filter(check),
        }),
      }),
    }),
    update: () => ({
      set: (patch: Partial<NodeRow>) => ({
        where: (check: WhereCheck) => ({
          run: () => {
            for (const r of dbState.rows) {
              if (check(r)) Object.assign(r, patch);
            }
          },
        }),
      }),
    }),
    transaction: (cb) => cb(dbMock),
  };
  return { db: dbMock };
});

vi.mock("@/lib/sse-manager", () => ({
  sseManager: {
    notifyNodeConfigUpdate: (id: number) => {
      sseState.notified.push(id);
      return true;
    },
  },
}));

vi.mock("drizzle-orm", () => {
  // Maps SQL column name → row property name. Missing entries throw loudly so
  // schema drift in production code surfaces as a test failure, not silent
  // undefined-comparison.
  const colMap: Record<string, keyof NodeRow> = {
    id: "id",
    xray_transport: "xrayTransport",
    xray_tls_domain: "xrayTlsDomain",
    xray_tls_cert: "xrayTlsCert",
  };
  return {
    and: (...preds: ((row: NodeRow) => boolean)[]) =>
      (row: NodeRow) => preds.every((p) => p(row)),
    eq: (col: { name?: string } | string, val: unknown) =>
      (row: NodeRow) => {
        const sqlName =
          typeof col === "string"
            ? col
            : (col as { name?: string }).name ?? "";
        const prop = colMap[sqlName];
        if (!prop) {
          throw new Error(`test eq() mock: missing colMap entry for SQL column '${sqlName}'`);
        }
        return row[prop] === val;
      },
    sql: (strings: TemplateStringsArray) => strings.join(""),
  };
});

import {
  authenticate,
  parsePayload,
  applyCertToMatchingNodes,
} from "@/lib/certd-webhook";

const ENC_KEY = "a".repeat(64);

beforeEach(() => {
  process.env.ENCRYPTION_KEY = ENC_KEY;
  process.env.CERTD_WEBHOOK_SECRET = "test-secret-1234567890";
  dbState.rows = [];
  sseState.notified = [];
});

function makeReq(headerValue?: string): import("next/server").NextRequest {
  return {
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "authorization" ? headerValue ?? null : null,
    },
  } as unknown as import("next/server").NextRequest;
}

describe("certd-webhook authenticate", () => {
  it("returns CERTD_WEBHOOK_DISABLED when secret is unset", () => {
    delete process.env.CERTD_WEBHOOK_SECRET;
    const r = authenticate(makeReq("Bearer test-secret-1234567890"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CERTD_WEBHOOK_DISABLED");
  });

  it("returns CERTD_WEBHOOK_DISABLED when secret is empty", () => {
    process.env.CERTD_WEBHOOK_SECRET = "";
    const r = authenticate(makeReq("Bearer foo"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CERTD_WEBHOOK_DISABLED");
  });

  it("returns UNAUTHORIZED when Authorization header is missing", () => {
    const r = authenticate(makeReq());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED when bearer token is wrong", () => {
    const r = authenticate(makeReq("Bearer wrong-token"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNAUTHORIZED");
  });

  it("returns UNAUTHORIZED when prefix is not 'Bearer '", () => {
    const r = authenticate(makeReq("Basic test-secret-1234567890"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("UNAUTHORIZED");
  });

  it("returns ok when bearer token matches", () => {
    const r = authenticate(makeReq("Bearer test-secret-1234567890"));
    expect(r.ok).toBe(true);
  });

  it("rejects tokens of differing length", () => {
    const r = authenticate(makeReq("Bearer short"));
    expect(r.ok).toBe(false);
  });
});

describe("certd-webhook parsePayload", () => {
  it("accepts a valid payload", () => {
    const r = parsePayload({ domain: "test.example.com", crt: TEST_CRT, key: TEST_KEY });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.domain).toBe("test.example.com");
  });

  it("trims domain whitespace", () => {
    const r = parsePayload({ domain: "  test.example.com  ", crt: TEST_CRT, key: TEST_KEY });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.domain).toBe("test.example.com");
  });

  it("rejects non-object body", () => {
    expect(parsePayload(null).ok).toBe(false);
    expect(parsePayload("string").ok).toBe(false);
    expect(parsePayload(123).ok).toBe(false);
  });

  it("rejects missing domain", () => {
    const r = parsePayload({ crt: TEST_CRT, key: TEST_KEY });
    expect(r.ok).toBe(false);
  });

  it("rejects empty domain", () => {
    const r = parsePayload({ domain: "   ", crt: TEST_CRT, key: TEST_KEY });
    expect(r.ok).toBe(false);
  });

  it("rejects crt without PEM header", () => {
    const r = parsePayload({ domain: "x.com", crt: "not a pem", key: TEST_KEY });
    expect(r.ok).toBe(false);
  });

  it("rejects malformed crt PEM", () => {
    const bad = "-----BEGIN CERTIFICATE-----\nnotbase64\n-----END CERTIFICATE-----\n";
    const r = parsePayload({ domain: "x.com", crt: bad, key: TEST_KEY });
    expect(r.ok).toBe(false);
  });

  it("rejects key without PEM header", () => {
    const r = parsePayload({ domain: "x.com", crt: TEST_CRT, key: "not a key" });
    expect(r.ok).toBe(false);
  });

  it("rejects malformed key PEM", () => {
    const bad = "-----BEGIN PRIVATE KEY-----\nnotbase64\n-----END PRIVATE KEY-----\n";
    const r = parsePayload({ domain: "x.com", crt: TEST_CRT, key: bad });
    expect(r.ok).toBe(false);
  });
});

describe("certd-webhook applyCertToMatchingNodes", () => {
  const payload = { domain: "test.example.com", crt: TEST_CRT, key: TEST_KEY };

  it("updates only nodes with ws-tls + matching domain", () => {
    dbState.rows = [
      { id: 1, xrayTransport: "ws-tls", xrayTlsDomain: "test.example.com", xrayTlsCert: null, xrayTlsKey: null, updatedAt: null },
      { id: 2, xrayTransport: "reality", xrayTlsDomain: "test.example.com", xrayTlsCert: null, xrayTlsKey: null, updatedAt: null },
      { id: 3, xrayTransport: "ws-tls", xrayTlsDomain: "other.example.com", xrayTlsCert: null, xrayTlsKey: null, updatedAt: null },
    ];

    const r = applyCertToMatchingNodes(payload);
    expect(r.matched).toBe(1);
    expect(r.updated).toBe(1);
    expect(dbState.rows[0].xrayTlsCert).toBe(TEST_CRT);
    expect(dbState.rows[0].xrayTlsKey).not.toBeNull();
    expect(dbState.rows[0].xrayTlsKey).not.toBe(TEST_KEY);
    expect(dbState.rows[1].xrayTlsCert).toBeNull();
    expect(dbState.rows[2].xrayTlsCert).toBeNull();
    expect(sseState.notified).toEqual([1]);
  });

  it("updates all matching nodes when multiple share the domain", () => {
    dbState.rows = [
      { id: 1, xrayTransport: "ws-tls", xrayTlsDomain: "test.example.com", xrayTlsCert: null, xrayTlsKey: null, updatedAt: null },
      { id: 2, xrayTransport: "ws-tls", xrayTlsDomain: "test.example.com", xrayTlsCert: null, xrayTlsKey: null, updatedAt: null },
    ];

    const r = applyCertToMatchingNodes(payload);
    expect(r.matched).toBe(2);
    expect(r.updated).toBe(2);
    expect(sseState.notified).toEqual([1, 2]);
  });

  it("skips UPDATE and SSE when stored cert is byte-identical to payload", () => {
    dbState.rows = [
      { id: 1, xrayTransport: "ws-tls", xrayTlsDomain: "test.example.com", xrayTlsCert: TEST_CRT, xrayTlsKey: "old-encrypted", updatedAt: "old" },
    ];

    const r = applyCertToMatchingNodes(payload);
    expect(r.matched).toBe(1);
    expect(r.updated).toBe(0);
    expect(dbState.rows[0].xrayTlsKey).toBe("old-encrypted");
    expect(sseState.notified).toEqual([]);
  });

  it("returns matched:0 when no node uses this domain", () => {
    dbState.rows = [
      { id: 1, xrayTransport: "ws-tls", xrayTlsDomain: "other.example.com", xrayTlsCert: null, xrayTlsKey: null, updatedAt: null },
    ];

    const r = applyCertToMatchingNodes(payload);
    expect(r.matched).toBe(0);
    expect(r.updated).toBe(0);
    expect(sseState.notified).toEqual([]);
  });
});
