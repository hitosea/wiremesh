# WireMesh Management Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the WireMesh management platform — a Next.js web application for managing WireGuard VPN nodes, devices, lines, and filters, with SSE push and Agent API endpoints.

**Architecture:** Next.js App Router monolith with SQLite (Drizzle ORM). Server-side API routes handle CRUD, JWT auth, and SSE push. Worker process runs alongside for scheduled tasks. All WireGuard private keys encrypted with AES-256-GCM. Chinese-only UI with shadcn/ui.

**Tech Stack:** Next.js (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui, Drizzle ORM, better-sqlite3, jose (JWT), bcryptjs, Node.js crypto (AES-256-GCM)

**Scope:** This plan covers Phases 1-11 (Next.js platform + Worker). Go Agent and Docker deployment are separate follow-up plans.

**Reference docs:**
- `docs/requirements.md` — Full requirements v2.4
- `docs/node-architecture.md` — Node architecture diagrams
- `CLAUDE.md` — Project conventions and architecture decisions

---

## File Structure

```
wiremesh/
├── src/
│   ├── app/
│   │   ├── layout.tsx                    # Root layout
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx            # Login page
│   │   │   └── setup/page.tsx            # First-time setup page
│   │   ├── (dashboard)/
│   │   │   ├── layout.tsx                # Sidebar + topbar layout
│   │   │   ├── dashboard/page.tsx        # Dashboard
│   │   │   ├── nodes/
│   │   │   │   ├── page.tsx              # Node list
│   │   │   │   ├── new/page.tsx          # Create node
│   │   │   │   ├── [id]/page.tsx         # Node detail/edit
│   │   │   │   └── [id]/script/page.tsx  # Install script view
│   │   │   ├── devices/
│   │   │   │   ├── page.tsx              # Device list
│   │   │   │   ├── new/page.tsx          # Create device
│   │   │   │   ├── [id]/page.tsx         # Device detail/edit
│   │   │   │   └── [id]/config/page.tsx  # Client config view
│   │   │   ├── lines/
│   │   │   │   ├── page.tsx              # Line list
│   │   │   │   ├── new/page.tsx          # Create line
│   │   │   │   └── [id]/page.tsx         # Line detail/edit
│   │   │   ├── filters/
│   │   │   │   ├── page.tsx              # Filter list
│   │   │   │   ├── new/page.tsx          # Create filter
│   │   │   │   └── [id]/page.tsx         # Filter detail/edit
│   │   │   └── settings/
│   │   │       ├── page.tsx              # System settings
│   │   │       └── logs/page.tsx         # Audit logs
│   │   └── api/
│   │       ├── setup/
│   │       │   ├── status/route.ts       # GET check init status
│   │       │   └── route.ts              # POST initialize
│   │       ├── auth/
│   │       │   ├── login/route.ts        # POST login
│   │       │   ├── logout/route.ts       # POST logout
│   │       │   ├── me/route.ts           # GET current user
│   │       │   └── password/route.ts     # PUT change password
│   │       ├── nodes/
│   │       │   ├── route.ts              # GET list, POST create
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET detail, PUT update, DELETE
│   │       │       ├── script/route.ts   # GET install script
│   │       │       ├── status/route.ts   # GET status history
│   │       │       └── check/route.ts    # POST manual check
│   │       ├── devices/
│   │       │   ├── route.ts              # GET list, POST create
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET detail, PUT update, DELETE
│   │       │       ├── config/route.ts   # GET client config
│   │       │       └── line/route.ts     # PUT switch line
│   │       ├── lines/
│   │       │   ├── route.ts              # GET list, POST create
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET detail, PUT update, DELETE
│   │       │       └── devices/route.ts  # GET associated devices
│   │       ├── filters/
│   │       │   ├── route.ts              # GET list, POST create
│   │       │   └── [id]/
│   │       │       ├── route.ts          # GET detail, PUT update, DELETE
│   │       │       └── toggle/route.ts   # PUT enable/disable
│   │       ├── settings/route.ts         # GET/PUT settings
│   │       ├── dashboard/route.ts        # GET dashboard stats
│   │       ├── audit-logs/route.ts       # GET audit logs
│   │       └── agent/
│   │           ├── sse/route.ts          # GET SSE endpoint
│   │           ├── config/route.ts       # GET node config
│   │           ├── status/route.ts       # POST status report
│   │           ├── error/route.ts        # POST error report
│   │           ├── installed/route.ts    # POST install callback
│   │           └── binary/route.ts       # GET agent binary download
│   ├── lib/
│   │   ├── db/
│   │   │   ├── index.ts                  # DB connection singleton
│   │   │   ├── schema.ts                 # All Drizzle table schemas
│   │   │   └── migrate.ts               # Migration runner
│   │   ├── crypto.ts                     # AES-256-GCM encrypt/decrypt
│   │   ├── wireguard.ts                  # WG key generation, conf generation
│   │   ├── ip-allocator.ts              # IP address auto-allocation
│   │   ├── auth.ts                       # JWT sign/verify, password hash
│   │   ├── api-response.ts              # Unified API response helpers
│   │   ├── pagination.ts                # Pagination query helper
│   │   ├── audit-log.ts                 # Audit log writer
│   │   └── sse-manager.ts              # SSE connection manager
│   ├── components/
│   │   ├── ui/                           # shadcn/ui components (auto-generated)
│   │   ├── sidebar.tsx                   # Sidebar navigation
│   │   ├── topbar.tsx                    # Top bar with user info
│   │   ├── data-table.tsx               # Reusable data table with pagination
│   │   ├── confirm-dialog.tsx           # Confirmation dialog
│   │   └── tag-input.tsx                # Tag input component
│   └── middleware.ts                     # Auth + setup redirect middleware
├── worker/
│   ├── index.js                          # Worker entry point
│   ├── node-checker.js                  # Node status checker
│   ├── line-syncer.js                   # Line status syncer
│   └── data-cleaner.js                  # Old data cleanup
├── drizzle/                              # Migration files (auto-generated)
├── drizzle.config.ts                     # Drizzle Kit config
├── next.config.ts                        # Next.js config
├── tailwind.config.ts                    # Tailwind config
├── tsconfig.json
├── package.json
├── docker-compose.yml
├── Dockerfile
├── .env.example
└── __tests__/
    ├── lib/
    │   ├── crypto.test.ts
    │   ├── wireguard.test.ts
    │   ├── ip-allocator.test.ts
    │   └── auth.test.ts
    └── api/
        ├── setup.test.ts
        ├── auth.test.ts
        ├── nodes.test.ts
        ├── devices.test.ts
        ├── lines.test.ts
        ├── filters.test.ts
        └── agent.test.ts
```

---

## Task 1: Project Initialization

**Files:**
- Create: `package.json`, `next.config.ts`, `tailwind.config.ts`, `tsconfig.json`, `.env.example`, `src/app/layout.tsx`, `src/app/page.tsx`

- [ ] **Step 1: Initialize Next.js project**

```bash
cd /home/coder/workspaces/wiremesh
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

This will scaffold into the existing directory. Answer prompts: Turbopack=yes.

- [ ] **Step 2: Install core dependencies**

```bash
npm install drizzle-orm better-sqlite3 jose bcryptjs uuid
npm install -D drizzle-kit @types/better-sqlite3 @types/bcryptjs @types/uuid vitest
```

- [ ] **Step 3: Initialize shadcn/ui**

```bash
npx shadcn@latest init -y
```

Select: New York style, Zinc color, CSS variables=yes. Then add base components:

```bash
npx shadcn@latest add button input label card table badge dialog dropdown-menu separator form select textarea tabs toast sonner switch sheet
```

- [ ] **Step 4: Create `.env.example`**

```bash
# .env.example
DATABASE_URL=file:./data/wiremesh.db
JWT_SECRET=change-me-to-a-random-64-char-string
ENCRYPTION_KEY=change-me-to-a-32-byte-hex-string
```

Copy to `.env.local`:

```bash
cp .env.example .env.local
# Edit .env.local with real values for local dev:
# JWT_SECRET can be any random string
# ENCRYPTION_KEY must be exactly 64 hex chars (32 bytes)
```

- [ ] **Step 5: Configure vitest**

Create `vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

Add to `package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 6: Create data directory and update .gitignore**

```bash
mkdir -p data
```

Add to `.gitignore`:

```
data/
.env.local
```

- [ ] **Step 7: Verify setup**

```bash
npm run dev
# Should start on localhost:3000 with default Next.js page
```

```bash
npm run test
# Should exit 0 (no tests yet)
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: initialize Next.js project with dependencies"
```

---

## Task 2: Database Schema

**Files:**
- Create: `src/lib/db/schema.ts`, `src/lib/db/index.ts`, `drizzle.config.ts`

- [ ] **Step 1: Create Drizzle config**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env.DATABASE_URL || "file:./data/wiremesh.db",
  },
});
```

- [ ] **Step 2: Define all table schemas**

Create `src/lib/db/schema.ts`:

```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Helper for default timestamps
const timestamps = {
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
};

// ===== users =====
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  ...timestamps,
});

// ===== settings =====
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ===== nodes =====
export const nodes = sqliteTable("nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  ip: text("ip").notNull(),
  domain: text("domain"),
  port: integer("port").notNull().default(51820),
  agentToken: text("agent_token").notNull().unique(),
  wgPrivateKey: text("wg_private_key").notNull(), // AES-256-GCM encrypted
  wgPublicKey: text("wg_public_key").notNull(),
  wgAddress: text("wg_address").notNull(), // e.g. "10.0.0.1/24"
  xrayEnabled: integer("xray_enabled", { mode: "boolean" })
    .notNull()
    .default(false),
  xrayProtocol: text("xray_protocol"), // "vless"
  xrayTransport: text("xray_transport"), // "ws" | "grpc"
  xrayPort: integer("xray_port"),
  xrayConfig: text("xray_config"), // JSON string
  status: text("status").notNull().default("offline"), // online|offline|installing|error
  errorMessage: text("error_message"),
  tags: text("tags"), // comma-separated
  remark: text("remark"),
  ...timestamps,
});

// ===== node_status =====
export const nodeStatus = sqliteTable("node_status", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nodeId: integer("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  isOnline: integer("is_online", { mode: "boolean" }).notNull(),
  latency: integer("latency"),
  uploadBytes: integer("upload_bytes").notNull().default(0),
  downloadBytes: integer("download_bytes").notNull().default(0),
  checkedAt: text("checked_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});

// ===== lines =====
export const lines = sqliteTable("lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("active"), // active|inactive
  tags: text("tags"),
  remark: text("remark"),
  ...timestamps,
});

// ===== line_nodes =====
export const lineNodes = sqliteTable("line_nodes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id")
    .notNull()
    .references(() => lines.id, { onDelete: "cascade" }),
  nodeId: integer("node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  hopOrder: integer("hop_order").notNull(), // 0=entry, 1=relay, 2=exit...
  role: text("role").notNull(), // entry|relay|exit
});

// ===== line_tunnels =====
export const lineTunnels = sqliteTable("line_tunnels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id")
    .notNull()
    .references(() => lines.id, { onDelete: "cascade" }),
  hopIndex: integer("hop_index").notNull(), // 0=first hop, 1=second...
  fromNodeId: integer("from_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  toNodeId: integer("to_node_id")
    .notNull()
    .references(() => nodes.id, { onDelete: "cascade" }),
  fromWgPrivateKey: text("from_wg_private_key").notNull(), // encrypted
  fromWgPublicKey: text("from_wg_public_key").notNull(),
  fromWgAddress: text("from_wg_address").notNull(), // e.g. "10.1.0.1/30"
  fromWgPort: integer("from_wg_port").notNull(),
  toWgPrivateKey: text("to_wg_private_key").notNull(), // encrypted
  toWgPublicKey: text("to_wg_public_key").notNull(),
  toWgAddress: text("to_wg_address").notNull(), // e.g. "10.1.0.2/30"
  toWgPort: integer("to_wg_port").notNull(),
});

// ===== devices =====
export const devices = sqliteTable("devices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  protocol: text("protocol").notNull(), // "wireguard" | "xray"
  wgPublicKey: text("wg_public_key"),
  wgPrivateKey: text("wg_private_key"), // encrypted
  wgAddress: text("wg_address"), // e.g. "10.0.0.100/24"
  xrayUuid: text("xray_uuid"),
  xrayConfig: text("xray_config"), // JSON string
  lineId: integer("line_id").references(() => lines.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("offline"), // online|offline
  lastHandshake: text("last_handshake"),
  tags: text("tags"),
  remark: text("remark"),
  ...timestamps,
});

// ===== filters =====
export const filters = sqliteTable("filters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  rules: text("rules").notNull(), // newline-separated IP/CIDR
  mode: text("mode").notNull().default("whitelist"), // whitelist|blacklist
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  tags: text("tags"),
  remark: text("remark"),
  ...timestamps,
});

// ===== line_filters =====
export const lineFilters = sqliteTable("line_filters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lineId: integer("line_id")
    .notNull()
    .references(() => lines.id, { onDelete: "cascade" }),
  filterId: integer("filter_id")
    .notNull()
    .references(() => filters.id, { onDelete: "cascade" }),
});

// ===== audit_logs =====
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  action: text("action").notNull(), // create|update|delete
  targetType: text("target_type").notNull(), // node|device|line|filter|settings
  targetId: integer("target_id"),
  targetName: text("target_name"),
  detail: text("detail"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(datetime('now'))`),
});
```

- [ ] **Step 3: Create DB connection singleton**

Create `src/lib/db/index.ts`:

```typescript
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";
import fs from "fs";

const dbPath =
  process.env.DATABASE_URL?.replace("file:", "") || "./data/wiremesh.db";

// Ensure directory exists
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
```

- [ ] **Step 4: Generate and run migrations**

```bash
npx drizzle-kit generate
npx drizzle-kit migrate
```

Verify the `drizzle/` directory now contains migration SQL files.

- [ ] **Step 5: Verify database**

```bash
# Quick check — start dev, import db somewhere temporarily, confirm tables exist
npx drizzle-kit studio
```

Or write a quick script:

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database('./data/wiremesh.db'); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all())"
```

Expected: all 11 tables listed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add database schema for all 11 tables"
```

---

## Task 3: Core Utility Libraries

**Files:**
- Create: `src/lib/crypto.ts`, `src/lib/wireguard.ts`, `src/lib/auth.ts`, `src/lib/api-response.ts`, `src/lib/pagination.ts`, `src/lib/audit-log.ts`, `src/lib/ip-allocator.ts`
- Test: `__tests__/lib/crypto.test.ts`, `__tests__/lib/wireguard.test.ts`, `__tests__/lib/auth.test.ts`, `__tests__/lib/ip-allocator.test.ts`

- [ ] **Step 1: Write crypto test**

Create `__tests__/lib/crypto.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("crypto", () => {
  // Set test encryption key (32 bytes = 64 hex chars)
  process.env.ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  it("encrypts and decrypts a string", () => {
    const plaintext = "my-secret-wireguard-private-key";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("test");
    const tampered = "XX" + encrypted.slice(2);
    expect(() => decrypt(tampered)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run __tests__/lib/crypto.test.ts
```

Expected: FAIL — module `@/lib/crypto` not found.

- [ ] **Step 3: Implement crypto module**

Create `src/lib/crypto.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "ENCRYPTION_KEY must be a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(hex, "hex");
}

export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: base64(iv + tag + ciphertext)
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decrypt(ciphertext: string): string {
  const key = getKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/crypto.test.ts
```

Expected: 3 tests PASS.

- [ ] **Step 5: Write WireGuard key generation test**

Create `__tests__/lib/wireguard.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateKeyPair } from "@/lib/wireguard";

describe("wireguard", () => {
  it("generates a valid key pair", () => {
    const { privateKey, publicKey } = generateKeyPair();
    // WireGuard keys are 32 bytes, base64 encoded = 44 chars
    expect(privateKey).toHaveLength(44);
    expect(publicKey).toHaveLength(44);
    expect(privateKey).not.toBe(publicKey);
  });

  it("generates unique key pairs", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    expect(a.privateKey).not.toBe(b.privateKey);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

```bash
npx vitest run __tests__/lib/wireguard.test.ts
```

Expected: FAIL.

- [ ] **Step 7: Implement WireGuard module**

Create `src/lib/wireguard.ts`:

```typescript
import { execSync } from "child_process";
import { randomBytes } from "crypto";

// Curve25519 key generation using Node.js crypto
import { createPrivateKey, createPublicKey } from "crypto";

export function generateKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  // Generate X25519 keypair using Node.js crypto
  const { privateKey, publicKey } = require("crypto").generateKeyPairSync(
    "x25519",
    {}
  );
  const privRaw = privateKey
    .export({ type: "pkcs8", format: "der" })
    .subarray(-32);
  const pubRaw = publicKey
    .export({ type: "spki", format: "der" })
    .subarray(-32);
  return {
    privateKey: privRaw.toString("base64"),
    publicKey: pubRaw.toString("base64"),
  };
}
```

- [ ] **Step 8: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/wireguard.test.ts
```

Expected: PASS.

- [ ] **Step 9: Write auth test**

Create `__tests__/lib/auth.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signToken, verifyToken } from "@/lib/auth";

process.env.JWT_SECRET = "test-secret-at-least-32-characters-long-ok";

describe("auth", () => {
  it("hashes and verifies password", async () => {
    const hash = await hashPassword("mypassword");
    expect(hash).not.toBe("mypassword");
    expect(await verifyPassword("mypassword", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });

  it("signs and verifies JWT token", async () => {
    const token = await signToken({ sub: "1", username: "admin" });
    expect(typeof token).toBe("string");
    const payload = await verifyToken(token);
    expect(payload.sub).toBe("1");
    expect(payload.username).toBe("admin");
  });

  it("rejects invalid token", async () => {
    await expect(verifyToken("invalid.token.here")).rejects.toThrow();
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

```bash
npx vitest run __tests__/lib/auth.test.ts
```

Expected: FAIL.

- [ ] **Step 11: Implement auth module**

Create `src/lib/auth.ts`:

```typescript
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";

const SALT_ROUNDS = 10;

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET environment variable is required");
  return new TextEncoder().encode(secret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: {
  sub: string;
  username: string;
}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("24h")
    .setIssuer("wiremesh")
    .sign(getJwtSecret());
}

export async function verifyToken(
  token: string
): Promise<{ sub: string; username: string }> {
  const { payload } = await jwtVerify(token, getJwtSecret(), {
    issuer: "wiremesh",
  });
  return payload as { sub: string; username: string };
}
```

- [ ] **Step 12: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/auth.test.ts
```

Expected: PASS.

- [ ] **Step 13: Implement API response helpers**

Create `src/lib/api-response.ts`:

```typescript
import { NextResponse } from "next/server";

export function success(data: unknown, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function created(data: unknown) {
  return success(data, 201);
}

export function paginated(
  data: unknown[],
  pagination: { page: number; pageSize: number; total: number }
) {
  return NextResponse.json({
    data,
    pagination: {
      ...pagination,
      totalPages: Math.ceil(pagination.total / pagination.pageSize),
    },
  });
}

type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INTERNAL_ERROR"
  | "NODE_OFFLINE"
  | "CONFIG_SYNC_FAILED";

const STATUS_MAP: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
  NODE_OFFLINE: 503,
  CONFIG_SYNC_FAILED: 502,
};

export function error(code: ErrorCode, message: string) {
  return NextResponse.json(
    { error: { code, message } },
    { status: STATUS_MAP[code] }
  );
}
```

- [ ] **Step 14: Implement pagination helper**

Create `src/lib/pagination.ts`:

```typescript
import { SQL, sql, asc, desc } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

export interface PaginationParams {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export function parsePaginationParams(
  searchParams: URLSearchParams
): PaginationParams {
  return {
    page: Math.max(1, parseInt(searchParams.get("page") || "1")),
    pageSize: Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("pageSize") || "20"))
    ),
    sortBy: searchParams.get("sortBy") || "created_at",
    sortOrder:
      searchParams.get("sortOrder") === "asc" ? "asc" : "desc",
  };
}

export function paginationOffset(params: PaginationParams): number {
  return (params.page - 1) * params.pageSize;
}
```

- [ ] **Step 15: Implement audit log writer**

Create `src/lib/audit-log.ts`:

```typescript
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export async function writeAuditLog(entry: {
  action: "create" | "update" | "delete";
  targetType: "node" | "device" | "line" | "filter" | "settings";
  targetId?: number;
  targetName?: string;
  detail?: string;
}) {
  db.insert(auditLogs)
    .values({
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      targetName: entry.targetName,
      detail: entry.detail,
    })
    .run();
}
```

- [ ] **Step 16: Write IP allocator test**

Create `__tests__/lib/ip-allocator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  allocateNodeIp,
  allocateDeviceIp,
  allocateTunnelSubnet,
} from "@/lib/ip-allocator";

describe("ip-allocator", () => {
  it("allocates node IP from start position", () => {
    const ip = allocateNodeIp([], "10.0.0.0/24", 1);
    expect(ip).toBe("10.0.0.1/24");
  });

  it("skips used IPs for nodes", () => {
    const used = ["10.0.0.1/24", "10.0.0.2/24"];
    const ip = allocateNodeIp(used, "10.0.0.0/24", 1);
    expect(ip).toBe("10.0.0.3/24");
  });

  it("allocates device IP from start position", () => {
    const ip = allocateDeviceIp([], "10.0.0.0/24", 100);
    expect(ip).toBe("10.0.0.100/24");
  });

  it("skips used IPs for devices", () => {
    const used = ["10.0.0.100/24"];
    const ip = allocateDeviceIp(used, "10.0.0.0/24", 100);
    expect(ip).toBe("10.0.0.101/24");
  });

  it("allocates /30 tunnel subnet", () => {
    const result = allocateTunnelSubnet([], "10.1.0.0/16");
    expect(result).toEqual({
      fromAddress: "10.1.0.1/30",
      toAddress: "10.1.0.2/30",
    });
  });

  it("skips used /30 subnets", () => {
    const used = ["10.1.0.1/30", "10.1.0.2/30"];
    const result = allocateTunnelSubnet(used, "10.1.0.0/16");
    expect(result).toEqual({
      fromAddress: "10.1.0.5/30",
      toAddress: "10.1.0.6/30",
    });
  });
});
```

- [ ] **Step 17: Run test to verify it fails**

```bash
npx vitest run __tests__/lib/ip-allocator.test.ts
```

Expected: FAIL.

- [ ] **Step 18: Implement IP allocator**

Create `src/lib/ip-allocator.ts`:

```typescript
function parseSubnet(cidr: string): { base: number[]; mask: number } {
  const [ip, bits] = cidr.split("/");
  const parts = ip.split(".").map(Number);
  return { base: parts, mask: parseInt(bits) };
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
  const maxHost = 254; // .1 to .254

  for (let i = startPos; i <= maxHost; i++) {
    const ip = ipToString([base[0], base[1], base[2], i]);
    if (!usedHosts.has(ip)) {
      return `${ip}/${mask}`;
    }
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
  const maxHost = 254;

  for (let i = startPos; i <= maxHost; i++) {
    const ip = ipToString([base[0], base[1], base[2], i]);
    if (!usedHosts.has(ip)) {
      return `${ip}/${mask}`;
    }
  }
  throw new Error("No available IP addresses in device range");
}

export function allocateTunnelSubnet(
  usedAddresses: string[],
  tunnelSubnet: string
): { fromAddress: string; toAddress: string } {
  const { base } = parseSubnet(tunnelSubnet);
  const usedHosts = new Set(usedAddresses.map(extractHost));

  // Each /30 subnet: .0 (network), .1 (from), .2 (to), .3 (broadcast)
  // Step by 4 through the address space
  const baseNum =
    (base[0] << 24) | (base[1] << 16) | (base[2] << 8) | base[3];

  for (let offset = 0; offset < 65536; offset += 4) {
    const subnetStart = baseNum + offset;
    const fromParts = [
      (subnetStart + 1) >>> 24 & 0xff,
      (subnetStart + 1) >>> 16 & 0xff,
      (subnetStart + 1) >>> 8 & 0xff,
      (subnetStart + 1) & 0xff,
    ];
    const toParts = [
      (subnetStart + 2) >>> 24 & 0xff,
      (subnetStart + 2) >>> 16 & 0xff,
      (subnetStart + 2) >>> 8 & 0xff,
      (subnetStart + 2) & 0xff,
    ];

    const fromIp = ipToString(fromParts);
    const toIp = ipToString(toParts);

    if (!usedHosts.has(fromIp) && !usedHosts.has(toIp)) {
      return {
        fromAddress: `${fromIp}/30`,
        toAddress: `${toIp}/30`,
      };
    }
  }
  throw new Error("No available /30 subnets in tunnel range");
}

export function allocateTunnelPort(
  usedPorts: number[],
  startPort: number
): number {
  const usedSet = new Set(usedPorts);
  for (let port = startPort; port < 65535; port++) {
    if (!usedSet.has(port)) {
      return port;
    }
  }
  throw new Error("No available tunnel ports");
}
```

- [ ] **Step 19: Run test to verify it passes**

```bash
npx vitest run __tests__/lib/ip-allocator.test.ts
```

Expected: PASS.

- [ ] **Step 20: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 21: Commit**

```bash
git add -A
git commit -m "feat: add core utility libraries (crypto, auth, IP allocation, API helpers)"
```

---

## Task 4: Middleware and Auth System

**Files:**
- Create: `src/middleware.ts`, `src/app/api/setup/status/route.ts`, `src/app/api/setup/route.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/app/api/auth/me/route.ts`, `src/app/api/auth/password/route.ts`

- [ ] **Step 1: Implement middleware**

Create `src/middleware.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";

const PUBLIC_PATHS = [
  "/login",
  "/setup",
  "/api/setup",
  "/api/auth/login",
  "/api/agent/",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

function isAgentPath(pathname: string): boolean {
  return pathname.startsWith("/api/agent/");
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static files and Next.js internals — skip
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return NextResponse.next();
  }

  // Agent API paths have their own token auth — skip JWT check
  if (isAgentPath(pathname)) {
    return NextResponse.next();
  }

  // Public paths — allow
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check JWT from cookie
  const token = request.cookies.get("token")?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "未登录" } },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  try {
    await verifyToken(token);
    return NextResponse.next();
  } catch {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "登录已过期" } },
        { status: 401 }
      );
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
```

- [ ] **Step 2: Implement setup status API**

Create `src/app/api/setup/status/route.ts`:

```typescript
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { success } from "@/lib/api-response";
import { count } from "drizzle-orm";

export async function GET() {
  const result = db.select({ count: count() }).from(users).get();
  return success({ initialized: (result?.count ?? 0) > 0 });
}
```

- [ ] **Step 3: Implement setup API**

Create `src/app/api/setup/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users, settings } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth";
import { success, error } from "@/lib/api-response";
import { count } from "drizzle-orm";

const DEFAULT_SETTINGS: Record<string, string> = {
  wg_default_port: "51820",
  wg_default_subnet: "10.0.0.0/24",
  wg_default_dns: "1.1.1.1",
  wg_node_ip_start: "1",
  wg_device_ip_start: "100",
  xray_default_protocol: "vless",
  xray_default_transport: "ws",
  xray_default_port: "443",
  tunnel_subnet: "10.1.0.0/16",
  tunnel_port_start: "51830",
  node_check_interval: "5",
};

export async function POST(request: NextRequest) {
  // Check if already initialized
  const existing = db.select({ count: count() }).from(users).get();
  if (existing && existing.count > 0) {
    return error("CONFLICT", "系统已初始化");
  }

  const body = await request.json();
  const { username, password, wgDefaultSubnet } = body;

  if (!username || !password) {
    return error("VALIDATION_ERROR", "用户名和密码不能为空");
  }

  if (password.length < 6) {
    return error("VALIDATION_ERROR", "密码长度至少 6 位");
  }

  // Create admin user
  const passwordHash = await hashPassword(password);
  db.insert(users).values({ username, passwordHash }).run();

  // Initialize default settings
  const settingsToInsert = { ...DEFAULT_SETTINGS };
  if (wgDefaultSubnet) {
    settingsToInsert.wg_default_subnet = wgDefaultSubnet;
  }

  for (const [key, value] of Object.entries(settingsToInsert)) {
    db.insert(settings).values({ key, value }).run();
  }

  return success({ message: "初始化完成" }, 201);
}
```

- [ ] **Step 4: Implement login API**

Create `src/app/api/auth/login/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyPassword, signToken } from "@/lib/auth";
import { error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { username, password } = body;

  if (!username || !password) {
    return error("VALIDATION_ERROR", "用户名和密码不能为空");
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.username, username))
    .get();

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return error("UNAUTHORIZED", "用户名或密码错误");
  }

  const token = await signToken({
    sub: String(user.id),
    username: user.username,
  });

  const response = NextResponse.json({
    data: { id: user.id, username: user.username },
  });

  response.cookies.set("token", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24, // 24 hours
    path: "/",
  });

  return response;
}
```

- [ ] **Step 5: Implement logout, me, password APIs**

Create `src/app/api/auth/logout/route.ts`:

```typescript
import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ data: { message: "已退出" } });
  response.cookies.delete("token");
  return response;
}
```

Create `src/app/api/auth/me/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyToken } from "@/lib/auth";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (!token) return error("UNAUTHORIZED", "未登录");

  try {
    const payload = await verifyToken(token);
    const user = db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.id, parseInt(payload.sub)))
      .get();

    if (!user) return error("NOT_FOUND", "用户不存在");
    return success(user);
  } catch {
    return error("UNAUTHORIZED", "登录已过期");
  }
}
```

Create `src/app/api/auth/password/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { verifyToken, hashPassword, verifyPassword } from "@/lib/auth";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

export async function PUT(request: NextRequest) {
  const token = request.cookies.get("token")?.value;
  if (!token) return error("UNAUTHORIZED", "未登录");

  const payload = await verifyToken(token);
  const body = await request.json();
  const { currentPassword, newPassword } = body;

  if (!currentPassword || !newPassword) {
    return error("VALIDATION_ERROR", "当前密码和新密码不能为空");
  }

  if (newPassword.length < 6) {
    return error("VALIDATION_ERROR", "新密码长度至少 6 位");
  }

  const user = db
    .select()
    .from(users)
    .where(eq(users.id, parseInt(payload.sub)))
    .get();

  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    return error("UNAUTHORIZED", "当前密码错误");
  }

  const newHash = await hashPassword(newPassword);
  db.update(users)
    .set({ passwordHash: newHash, updatedAt: new Date().toISOString() })
    .where(eq(users.id, user.id))
    .run();

  return success({ message: "密码已修改" });
}
```

- [ ] **Step 6: Verify auth flow manually**

```bash
npm run dev
```

Test with curl:

```bash
# Check setup status
curl http://localhost:3000/api/setup/status
# Expected: {"data":{"initialized":false}}

# Initialize
curl -X POST http://localhost:3000/api/setup -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}'
# Expected: 201 {"data":{"message":"初始化完成"}}

# Login
curl -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123"}' -c cookies.txt
# Expected: 200 with Set-Cookie header

# Get me
curl http://localhost:3000/api/auth/me -b cookies.txt
# Expected: 200 {"data":{"id":1,"username":"admin"}}
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add auth system (middleware, setup, login, JWT)"
```

---

## Task 5: Global Layout and Auth Pages

**Files:**
- Create: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/setup/page.tsx`, `src/app/(auth)/layout.tsx`, `src/app/(dashboard)/layout.tsx`, `src/components/sidebar.tsx`, `src/components/topbar.tsx`

- [ ] **Step 1: Create auth layout (centered card)**

Create `src/app/(auth)/layout.tsx`:

```tsx
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}
```

- [ ] **Step 2: Create setup page**

Create `src/app/(auth)/setup/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function SetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.data.initialized) {
          router.replace("/login");
        } else {
          setLoading(false);
        }
      });
  }, [router]);

  if (loading) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const password = form.get("password") as string;
    const confirmPassword = form.get("confirmPassword") as string;

    if (password !== confirmPassword) {
      setError("两次密码不一致");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password,
        wgDefaultSubnet: form.get("wgDefaultSubnet") || undefined,
      }),
    });

    if (res.ok) {
      router.push("/login");
    } else {
      const data = await res.json();
      setError(data.error?.message || "初始化失败");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WireMesh 初始化</CardTitle>
        <CardDescription>首次使用，请设置管理员账号</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" name="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">确认密码</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              required
              minLength={6}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wgDefaultSubnet">
              WireGuard 默认网段（可选）
            </Label>
            <Input
              id="wgDefaultSubnet"
              name="wgDefaultSubnet"
              placeholder="10.0.0.0/24"
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "初始化中..." : "完成初始化"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Create login page**

Create `src/app/(auth)/login/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError("");

    const form = new FormData(e.currentTarget);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: form.get("username"),
        password: form.get("password"),
      }),
    });

    if (res.ok) {
      router.push("/dashboard");
    } else {
      const data = await res.json();
      setError(data.error?.message || "登录失败");
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>WireMesh</CardTitle>
        <CardDescription>登录管理平台</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="username">用户名</Label>
            <Input id="username" name="username" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              name="password"
              type="password"
              required
            />
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "登录中..." : "登录"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 4: Create sidebar component**

Create `src/components/sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "仪表盘", icon: "LayoutDashboard" },
  { href: "/nodes", label: "节点管理", icon: "Server" },
  { href: "/devices", label: "设备管理", icon: "Smartphone" },
  { href: "/lines", label: "线路管理", icon: "Route" },
  { href: "/filters", label: "分流规则", icon: "Filter" },
  { href: "/settings", label: "系统设置", icon: "Settings" },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 border-r bg-gray-50/50 h-screen flex flex-col">
      <div className="p-4 border-b">
        <h1 className="text-lg font-bold">WireMesh</h1>
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const active =
            pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                active
                  ? "bg-gray-200 text-gray-900 font-medium"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 5: Create topbar component**

Create `src/components/topbar.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function Topbar() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <header className="h-14 border-b flex items-center justify-end px-6">
      <Button variant="ghost" size="sm" onClick={handleLogout}>
        退出登录
      </Button>
    </header>
  );
}
```

- [ ] **Step 6: Create dashboard layout**

Create `src/app/(dashboard)/layout.tsx`:

```tsx
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Create placeholder dashboard page**

Create `src/app/(dashboard)/dashboard/page.tsx`:

```tsx
export default function DashboardPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-4">仪表盘</h2>
      <p className="text-gray-500">暂无数据</p>
    </div>
  );
}
```

- [ ] **Step 8: Update root layout redirect**

Update `src/app/page.tsx` to redirect to dashboard:

```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/dashboard");
}
```

- [ ] **Step 9: Verify UI manually**

```bash
npm run dev
```

1. Visit `http://localhost:3000` — should redirect to `/login` (or `/setup` if not initialized)
2. Complete setup — should redirect to `/login`
3. Login — should see dashboard with sidebar

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add auth pages, sidebar layout, and dashboard shell"
```

---

## Task 6: Settings and Audit Logs

**Files:**
- Create: `src/app/api/settings/route.ts`, `src/app/api/audit-logs/route.ts`, `src/app/(dashboard)/settings/page.tsx`, `src/app/(dashboard)/settings/logs/page.tsx`

- [ ] **Step 1: Implement settings API**

Create `src/app/api/settings/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";

export async function GET() {
  const rows = db.select().from(settings).all();
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return success(result);
}

export async function PUT(request: NextRequest) {
  const body = await request.json();

  if (typeof body !== "object" || body === null) {
    return error("VALIDATION_ERROR", "请求体必须是对象");
  }

  const changes: string[] = [];
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    db.insert(settings)
      .values({ key, value, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: new Date().toISOString() },
      })
      .run();
    changes.push(`${key}=${value}`);
  }

  writeAuditLog({
    action: "update",
    targetType: "settings",
    detail: changes.join(", "),
  });

  return success({ message: "设置已更新" });
}
```

- [ ] **Step 2: Implement audit logs API**

Create `src/app/api/audit-logs/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";
import { paginated } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { desc, like, eq, count, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const targetType = request.nextUrl.searchParams.get("targetType");
  const action = request.nextUrl.searchParams.get("action");

  const conditions = [];
  if (targetType) conditions.push(eq(auditLogs.targetType, targetType));
  if (action) conditions.push(eq(auditLogs.action, action));

  const where =
    conditions.length > 0
      ? sql`${sql.join(conditions, sql` AND `)}`
      : undefined;

  const total =
    db
      .select({ count: count() })
      .from(auditLogs)
      .where(where)
      .get()?.count ?? 0;

  const rows = db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.createdAt))
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  return paginated(rows, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}
```

- [ ] **Step 3: Create settings page**

Create `src/app/(dashboard)/settings/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

interface Settings {
  [key: string]: string;
}

const SETTING_GROUPS = [
  {
    title: "WireGuard 设置",
    fields: [
      { key: "wg_default_port", label: "默认监听端口", type: "number" },
      { key: "wg_default_subnet", label: "默认内网网段" },
      { key: "wg_default_dns", label: "客户端默认 DNS" },
      { key: "wg_node_ip_start", label: "节点 IP 起始位", type: "number" },
      { key: "wg_device_ip_start", label: "设备 IP 起始位", type: "number" },
    ],
  },
  {
    title: "Xray 设置",
    fields: [
      { key: "xray_default_protocol", label: "默认协议" },
      { key: "xray_default_transport", label: "默认传输层" },
      { key: "xray_default_port", label: "默认端口", type: "number" },
    ],
  },
  {
    title: "隧道设置",
    fields: [
      { key: "tunnel_subnet", label: "隧道 IP 地址池" },
      { key: "tunnel_port_start", label: "隧道端口起始值", type: "number" },
    ],
  },
  {
    title: "监控设置",
    fields: [
      {
        key: "node_check_interval",
        label: "节点检测间隔（分钟）",
        type: "number",
      },
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings(data.data);
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    const res = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    if (res.ok) {
      toast.success("设置已保存");
    } else {
      toast.error("保存失败");
    }
    setSaving(false);
  }

  if (loading) return <div>加载中...</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-2xl font-bold">系统设置</h2>
      {SETTING_GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle className="text-lg">{group.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {group.fields.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.type || "text"}
                  value={settings[field.key] || ""}
                  onChange={(e) =>
                    setSettings({ ...settings, [field.key]: e.target.value })
                  }
                />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
      <Button onClick={handleSave} disabled={saving}>
        {saving ? "保存中..." : "保存设置"}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Create audit logs page**

Create `src/app/(dashboard)/settings/logs/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface AuditLog {
  id: number;
  action: string;
  targetType: string;
  targetId: number | null;
  targetName: string | null;
  detail: string | null;
  createdAt: string;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

const ACTION_LABELS: Record<string, string> = {
  create: "创建",
  update: "更新",
  delete: "删除",
};

const TYPE_LABELS: Record<string, string> = {
  node: "节点",
  device: "设备",
  line: "线路",
  filter: "规则",
  settings: "设置",
};

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);

  const fetchLogs = useCallback(async () => {
    const res = await fetch(`/api/audit-logs?page=${page}&pageSize=20`);
    const data = await res.json();
    setLogs(data.data);
    setPagination(data.pagination);
  }, [page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold">操作日志</h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>操作</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>对象</TableHead>
            <TableHead>详情</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id}>
              <TableCell className="whitespace-nowrap">
                {new Date(log.createdAt).toLocaleString("zh-CN")}
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {ACTION_LABELS[log.action] || log.action}
                </Badge>
              </TableCell>
              <TableCell>
                {TYPE_LABELS[log.targetType] || log.targetType}
              </TableCell>
              <TableCell>{log.targetName || log.targetId || "-"}</TableCell>
              <TableCell className="max-w-xs truncate">
                {log.detail || "-"}
              </TableCell>
            </TableRow>
          ))}
          {logs.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-gray-500">
                暂无日志
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-gray-500">
            {page} / {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Add Toaster to root layout**

Update `src/app/layout.tsx` to include the Sonner toaster:

```tsx
import { Toaster } from "@/components/ui/sonner";

// Add <Toaster /> right before closing </body>
```

- [ ] **Step 6: Verify settings and audit logs**

```bash
npm run dev
```

1. Go to `/settings`, modify a value, save — should show toast
2. Go to `/settings/logs` — should show the settings update log entry

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add settings management and audit logs"
```

---

## Task 7: Node CRUD API

**Files:**
- Create: `src/app/api/nodes/route.ts`, `src/app/api/nodes/[id]/route.ts`

- [ ] **Step 1: Implement node list + create API**

Create `src/app/api/nodes/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, settings } from "@/lib/db/schema";
import { success, created, paginated, error } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { writeAuditLog } from "@/lib/audit-log";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateNodeIp } from "@/lib/ip-allocator";
import { eq, like, count, desc, asc, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");
  const tags = request.nextUrl.searchParams.get("tags");

  const conditions = [];
  if (search) {
    conditions.push(
      or(like(nodes.name, `%${search}%`), like(nodes.ip, `%${search}%`))
    );
  }
  if (status) conditions.push(eq(nodes.status, status));
  if (tags) conditions.push(like(nodes.tags, `%${tags}%`));

  const where =
    conditions.length > 0
      ? sql`${sql.join(conditions, sql` AND `)}`
      : undefined;

  const total =
    db.select({ count: count() }).from(nodes).where(where).get()?.count ?? 0;

  const orderDir = params.sortOrder === "asc" ? asc : desc;
  const rows = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      domain: nodes.domain,
      port: nodes.port,
      wgPublicKey: nodes.wgPublicKey,
      wgAddress: nodes.wgAddress,
      xrayEnabled: nodes.xrayEnabled,
      status: nodes.status,
      errorMessage: nodes.errorMessage,
      tags: nodes.tags,
      remark: nodes.remark,
      createdAt: nodes.createdAt,
      updatedAt: nodes.updatedAt,
    })
    .from(nodes)
    .where(where)
    .orderBy(orderDir(nodes.createdAt))
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  return paginated(rows, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, ip, domain, port, xrayEnabled, xrayProtocol, xrayTransport, xrayPort, xrayConfig, tags, remark } = body;

  if (!name || !ip) {
    return error("VALIDATION_ERROR", "节点名称和 IP 不能为空");
  }

  // Check IP uniqueness
  const existing = db.select().from(nodes).where(eq(nodes.ip, ip)).get();
  if (existing) {
    return error("CONFLICT", "该 IP 已被使用");
  }

  // Auto-generate WireGuard keys
  const keyPair = generateKeyPair();

  // Auto-allocate WG address
  const allAddresses = db
    .select({ wgAddress: nodes.wgAddress })
    .from(nodes)
    .all()
    .map((r) => r.wgAddress);

  const subnet =
    db.select().from(settings).where(eq(settings.key, "wg_default_subnet")).get()
      ?.value || "10.0.0.0/24";
  const ipStart = parseInt(
    db.select().from(settings).where(eq(settings.key, "wg_node_ip_start")).get()
      ?.value || "1"
  );
  const defaultPort = parseInt(
    db.select().from(settings).where(eq(settings.key, "wg_default_port")).get()
      ?.value || "51820"
  );

  const wgAddress = allocateNodeIp(allAddresses, subnet, ipStart);

  // Generate agent token
  const agentToken = uuidv4();

  const result = db
    .insert(nodes)
    .values({
      name,
      ip,
      domain: domain || null,
      port: port || defaultPort,
      agentToken,
      wgPrivateKey: encrypt(keyPair.privateKey),
      wgPublicKey: keyPair.publicKey,
      wgAddress,
      xrayEnabled: xrayEnabled || false,
      xrayProtocol: xrayEnabled ? xrayProtocol || "vless" : null,
      xrayTransport: xrayEnabled ? xrayTransport || "ws" : null,
      xrayPort: xrayEnabled ? xrayPort || 443 : null,
      xrayConfig: xrayConfig ? JSON.stringify(xrayConfig) : null,
      status: "offline",
      tags: tags || null,
      remark: remark || null,
    })
    .run();

  writeAuditLog({
    action: "create",
    targetType: "node",
    targetId: Number(result.lastInsertRowid),
    targetName: name,
  });

  return created({
    id: Number(result.lastInsertRowid),
    name,
    ip,
    wgAddress,
    wgPublicKey: keyPair.publicKey,
    agentToken,
  });
}
```

- [ ] **Step 2: Implement node detail/update/delete API**

Create `src/app/api/nodes/[id]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";
import { decrypt } from "@/lib/crypto";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const node = db
    .select()
    .from(nodes)
    .where(eq(nodes.id, parseInt(id)))
    .get();

  if (!node) return error("NOT_FOUND", "节点不存在");

  // Return public info only — private key excluded from response
  const { wgPrivateKey, ...rest } = node;
  return success(rest);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);

  const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "节点不存在");

  const body = await request.json();
  const { name, ip, domain, port, xrayEnabled, xrayProtocol, xrayTransport, xrayPort, xrayConfig, tags, remark } = body;

  // Check IP uniqueness if changed
  if (ip && ip !== node.ip) {
    const existing = db.select().from(nodes).where(eq(nodes.ip, ip)).get();
    if (existing) return error("CONFLICT", "该 IP 已被使用");
  }

  const updates: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (name !== undefined) updates.name = name;
  if (ip !== undefined) updates.ip = ip;
  if (domain !== undefined) updates.domain = domain || null;
  if (port !== undefined) updates.port = port;
  if (xrayEnabled !== undefined) {
    updates.xrayEnabled = xrayEnabled;
    updates.xrayProtocol = xrayEnabled ? xrayProtocol || node.xrayProtocol : null;
    updates.xrayTransport = xrayEnabled ? xrayTransport || node.xrayTransport : null;
    updates.xrayPort = xrayEnabled ? xrayPort || node.xrayPort : null;
  }
  if (xrayConfig !== undefined) updates.xrayConfig = JSON.stringify(xrayConfig);
  if (tags !== undefined) updates.tags = tags || null;
  if (remark !== undefined) updates.remark = remark || null;

  db.update(nodes).set(updates).where(eq(nodes.id, nodeId)).run();

  writeAuditLog({
    action: "update",
    targetType: "node",
    targetId: nodeId,
    targetName: name || node.name,
  });

  return success({ message: "节点已更新" });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);

  const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "节点不存在");

  db.delete(nodes).where(eq(nodes.id, nodeId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "node",
    targetId: nodeId,
    targetName: node.name,
  });

  return success({ message: "节点已删除" });
}
```

- [ ] **Step 3: Verify node API with curl**

```bash
npm run dev

# Create node
curl -X POST http://localhost:3000/api/nodes -b cookies.txt -H 'Content-Type: application/json' -d '{"name":"东京节点","ip":"1.2.3.4"}'

# List nodes
curl http://localhost:3000/api/nodes -b cookies.txt

# Get node detail
curl http://localhost:3000/api/nodes/1 -b cookies.txt

# Update node
curl -X PUT http://localhost:3000/api/nodes/1 -b cookies.txt -H 'Content-Type: application/json' -d '{"name":"东京节点v2"}'

# Delete node
curl -X DELETE http://localhost:3000/api/nodes/1 -b cookies.txt
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add node CRUD API with auto key/IP generation"
```

---

## Task 8: Node Management Pages

**Files:**
- Create: `src/app/(dashboard)/nodes/page.tsx`, `src/app/(dashboard)/nodes/new/page.tsx`, `src/app/(dashboard)/nodes/[id]/page.tsx`, `src/components/data-table.tsx`

- [ ] **Step 1: Create reusable data table component**

Create `src/components/data-table.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useState } from "react";

interface DataTableProps<T> {
  data: T[];
  columns: {
    key: string;
    label: string;
    render?: (row: T) => React.ReactNode;
  }[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  onPageChange?: (page: number) => void;
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  pagination,
  onPageChange,
  onSearch,
  searchPlaceholder,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    onSearch?.(search);
  }

  return (
    <div className="space-y-4">
      {onSearch && (
        <form onSubmit={handleSearch} className="flex gap-2 max-w-sm">
          <Input
            placeholder={searchPlaceholder || "搜索..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, i) => (
            <TableRow key={(row.id as number) ?? i}>
              {columns.map((col) => (
                <TableCell key={col.key}>
                  {col.render
                    ? col.render(row)
                    : (row[col.key] as React.ReactNode) ?? "-"}
                </TableCell>
              ))}
            </TableRow>
          ))}
          {data.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="text-center text-gray-500"
              >
                暂无数据
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center gap-2 justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page <= 1}
            onClick={() => onPageChange?.(pagination.page - 1)}
          >
            上一页
          </Button>
          <span className="text-sm text-gray-500">
            {pagination.page} / {pagination.totalPages}（共 {pagination.total} 条）
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => onPageChange?.(pagination.page + 1)}
          >
            下一页
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create node list page**

Create `src/app/(dashboard)/nodes/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { toast } from "sonner";

interface Node {
  id: number;
  name: string;
  ip: string;
  wgAddress: string;
  status: string;
  tags: string | null;
  createdAt: string;
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  online: { label: "在线", variant: "default" },
  offline: { label: "离线", variant: "secondary" },
  installing: { label: "安装中", variant: "outline" },
  error: { label: "异常", variant: "destructive" },
};

export default function NodesPage() {
  const router = useRouter();
  const [nodes, setNodes] = useState<Node[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const fetchNodes = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/nodes?${params}`);
    const data = await res.json();
    setNodes(data.data);
    setPagination(data.pagination);
  }, [page, search]);

  useEffect(() => {
    fetchNodes();
  }, [fetchNodes]);

  async function handleDelete(id: number) {
    if (!confirm("确定删除该节点？")) return;
    const res = await fetch(`/api/nodes/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("节点已删除");
      fetchNodes();
    } else {
      toast.error("删除失败");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">节点管理</h2>
        <Button asChild>
          <Link href="/nodes/new">新增节点</Link>
        </Button>
      </div>
      <DataTable
        data={nodes}
        searchPlaceholder="搜索节点名称或 IP..."
        onSearch={(q) => {
          setSearch(q);
          setPage(1);
        }}
        pagination={pagination}
        onPageChange={setPage}
        columns={[
          { key: "name", label: "名称", render: (row) => (
            <Link href={`/nodes/${row.id}`} className="text-blue-600 hover:underline">{row.name}</Link>
          )},
          { key: "ip", label: "IP 地址" },
          { key: "wgAddress", label: "内网地址" },
          {
            key: "status",
            label: "状态",
            render: (row) => {
              const s = STATUS_MAP[row.status] || { label: row.status, variant: "outline" as const };
              return <Badge variant={s.variant}>{s.label}</Badge>;
            },
          },
          {
            key: "tags",
            label: "标签",
            render: (row) =>
              row.tags
                ? row.tags.split(",").map((t: string) => (
                    <Badge key={t} variant="outline" className="mr-1">{t.trim()}</Badge>
                  ))
                : "-",
          },
          {
            key: "actions",
            label: "操作",
            render: (row) => (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/nodes/${row.id}`}>编辑</Link>
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <Link href={`/nodes/${row.id}/script`}>安装脚本</Link>
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDelete(row.id)}
                >
                  删除
                </Button>
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 3: Create node creation page**

Create `src/app/(dashboard)/nodes/new/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function NewNodePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [xrayEnabled, setXrayEnabled] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        ip: form.get("ip"),
        domain: form.get("domain") || undefined,
        port: form.get("port") ? Number(form.get("port")) : undefined,
        xrayEnabled,
        xrayTransport: xrayEnabled ? form.get("xrayTransport") : undefined,
        xrayPort: xrayEnabled && form.get("xrayPort") ? Number(form.get("xrayPort")) : undefined,
        tags: form.get("tags") || undefined,
        remark: form.get("remark") || undefined,
      }),
    });

    if (res.ok) {
      toast.success("节点创建成功");
      router.push("/nodes");
    } else {
      const data = await res.json();
      toast.error(data.error?.message || "创建失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">新增节点</h2>
      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">基本信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">节点名称 *</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="ip">公网 IP *</Label>
                <Input id="ip" name="ip" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="domain">域名（可选）</Label>
                <Input id="domain" name="domain" />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="port">WireGuard 端口（默认 51820）</Label>
              <Input id="port" name="port" type="number" placeholder="51820" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags">标签（逗号分隔）</Label>
              <Input id="tags" name="tags" placeholder="亚洲,高带宽" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="remark">备注</Label>
              <Textarea id="remark" name="remark" />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">Xray 设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-2">
              <Switch
                checked={xrayEnabled}
                onCheckedChange={setXrayEnabled}
              />
              <Label>启用 Xray</Label>
            </div>
            {xrayEnabled && (
              <>
                <div className="space-y-1">
                  <Label>传输层</Label>
                  <Select name="xrayTransport" defaultValue="ws">
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ws">WebSocket</SelectItem>
                      <SelectItem value="grpc">gRPC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="xrayPort">Xray 端口（默认 443）</Label>
                  <Input id="xrayPort" name="xrayPort" type="number" placeholder="443" />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建节点"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Create node detail/edit page**

Create `src/app/(dashboard)/nodes/[id]/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface NodeDetail {
  id: number;
  name: string;
  ip: string;
  domain: string | null;
  port: number;
  agentToken: string;
  wgPublicKey: string;
  wgAddress: string;
  xrayEnabled: boolean;
  xrayProtocol: string | null;
  xrayTransport: string | null;
  xrayPort: number | null;
  status: string;
  errorMessage: string | null;
  tags: string | null;
  remark: string | null;
  createdAt: string;
  updatedAt: string;
}

export default function NodeDetailPage() {
  const router = useRouter();
  const params = useParams();
  const [node, setNode] = useState<NodeDetail | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/nodes/${params.id}`)
      .then((r) => r.json())
      .then((data) => setNode(data.data));
  }, [params.id]);

  if (!node) return <div>加载中...</div>;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);

    const res = await fetch(`/api/nodes/${params.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        ip: form.get("ip"),
        domain: form.get("domain") || null,
        port: Number(form.get("port")),
        xrayEnabled: node!.xrayEnabled,
        xrayTransport: form.get("xrayTransport") || undefined,
        xrayPort: form.get("xrayPort") ? Number(form.get("xrayPort")) : undefined,
        tags: form.get("tags") || null,
        remark: form.get("remark") || null,
      }),
    });

    if (res.ok) {
      toast.success("节点已更新");
      router.push("/nodes");
    } else {
      const data = await res.json();
      toast.error(data.error?.message || "更新失败");
    }
    setSaving(false);
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-3 mb-4">
        <h2 className="text-2xl font-bold">{node.name}</h2>
        <Badge>{node.status}</Badge>
      </div>

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="text-lg">只读信息</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div><span className="font-medium">内网地址：</span>{node.wgAddress}</div>
          <div><span className="font-medium">公钥：</span><code className="text-xs">{node.wgPublicKey}</code></div>
          <div><span className="font-medium">Agent Token：</span><code className="text-xs">{node.agentToken}</code></div>
          {node.errorMessage && (
            <div className="text-red-500"><span className="font-medium">错误：</span>{node.errorMessage}</div>
          )}
        </CardContent>
      </Card>

      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader>
            <CardTitle className="text-lg">编辑节点</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">节点名称</Label>
              <Input id="name" name="name" defaultValue={node.name} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="ip">公网 IP</Label>
                <Input id="ip" name="ip" defaultValue={node.ip} required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="domain">域名</Label>
                <Input id="domain" name="domain" defaultValue={node.domain || ""} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="port">WireGuard 端口</Label>
              <Input id="port" name="port" type="number" defaultValue={node.port} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={node.xrayEnabled}
                onCheckedChange={(v) => setNode({ ...node, xrayEnabled: v })}
              />
              <Label>启用 Xray</Label>
            </div>
            {node.xrayEnabled && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>传输层</Label>
                  <Select name="xrayTransport" defaultValue={node.xrayTransport || "ws"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ws">WebSocket</SelectItem>
                      <SelectItem value="grpc">gRPC</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="xrayPort">Xray 端口</Label>
                  <Input id="xrayPort" name="xrayPort" type="number" defaultValue={node.xrayPort || 443} />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="tags">标签</Label>
              <Input id="tags" name="tags" defaultValue={node.tags || ""} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="remark">备注</Label>
              <Textarea id="remark" name="remark" defaultValue={node.remark || ""} />
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>
            {saving ? "保存中..." : "保存"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>
            返回
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 5: Verify node management UI**

```bash
npm run dev
```

1. Go to `/nodes` — should see empty list with "新增节点" button
2. Click "新增节点", fill form, create — should redirect to list with new node
3. Click node name — should show detail/edit page
4. Edit and save — should update
5. Delete — should remove from list

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add node management pages (list, create, edit)"
```

---

## Task 9: Device CRUD API and Pages

**Files:**
- Create: `src/app/api/devices/route.ts`, `src/app/api/devices/[id]/route.ts`, `src/app/api/devices/[id]/line/route.ts`, `src/app/(dashboard)/devices/page.tsx`, `src/app/(dashboard)/devices/new/page.tsx`, `src/app/(dashboard)/devices/[id]/page.tsx`

- [ ] **Step 1: Implement device list + create API**

Create `src/app/api/devices/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, settings } from "@/lib/db/schema";
import { success, created, paginated, error } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { writeAuditLog } from "@/lib/audit-log";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateDeviceIp } from "@/lib/ip-allocator";
import { eq, like, count, desc, or, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");
  const protocol = request.nextUrl.searchParams.get("protocol");

  const conditions = [];
  if (search) conditions.push(like(devices.name, `%${search}%`));
  if (status) conditions.push(eq(devices.status, status));
  if (protocol) conditions.push(eq(devices.protocol, protocol));

  const where =
    conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined;

  const total =
    db.select({ count: count() }).from(devices).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(devices)
    .where(where)
    .orderBy(desc(devices.createdAt))
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  // Strip private keys from response
  const safeRows = rows.map(({ wgPrivateKey, ...rest }) => rest);

  return paginated(safeRows, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, protocol, lineId, tags, remark } = body;

  if (!name || !protocol) {
    return error("VALIDATION_ERROR", "设备名称和协议不能为空");
  }

  if (!["wireguard", "xray"].includes(protocol)) {
    return error("VALIDATION_ERROR", "协议必须是 wireguard 或 xray");
  }

  const values: Record<string, unknown> = {
    name,
    protocol,
    lineId: lineId || null,
    tags: tags || null,
    remark: remark || null,
  };

  if (protocol === "wireguard") {
    const keyPair = generateKeyPair();
    const allAddresses = db
      .select({ wgAddress: devices.wgAddress })
      .from(devices)
      .all()
      .filter((r) => r.wgAddress)
      .map((r) => r.wgAddress!);

    const subnet =
      db.select().from(settings).where(eq(settings.key, "wg_default_subnet")).get()?.value || "10.0.0.0/24";
    const ipStart = parseInt(
      db.select().from(settings).where(eq(settings.key, "wg_device_ip_start")).get()?.value || "100"
    );

    values.wgPrivateKey = encrypt(keyPair.privateKey);
    values.wgPublicKey = keyPair.publicKey;
    values.wgAddress = allocateDeviceIp(allAddresses, subnet, ipStart);
  } else {
    values.xrayUuid = uuidv4();
  }

  const result = db.insert(devices).values(values).run();

  writeAuditLog({
    action: "create",
    targetType: "device",
    targetId: Number(result.lastInsertRowid),
    targetName: name,
  });

  return created({
    id: Number(result.lastInsertRowid),
    name,
    protocol,
    ...(protocol === "wireguard"
      ? { wgAddress: values.wgAddress, wgPublicKey: values.wgPublicKey }
      : { xrayUuid: values.xrayUuid }),
  });
}
```

- [ ] **Step 2: Implement device detail/update/delete API**

Create `src/app/api/devices/[id]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const device = db.select().from(devices).where(eq(devices.id, parseInt(id))).get();
  if (!device) return error("NOT_FOUND", "设备不存在");

  const { wgPrivateKey, ...rest } = device;
  return success(rest);
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) return error("NOT_FOUND", "设备不存在");

  const body = await request.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.tags !== undefined) updates.tags = body.tags || null;
  if (body.remark !== undefined) updates.remark = body.remark || null;

  db.update(devices).set(updates).where(eq(devices.id, deviceId)).run();

  writeAuditLog({
    action: "update",
    targetType: "device",
    targetId: deviceId,
    targetName: body.name || device.name,
  });

  return success({ message: "设备已更新" });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) return error("NOT_FOUND", "设备不存在");

  db.delete(devices).where(eq(devices.id, deviceId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "device",
    targetId: deviceId,
    targetName: device.name,
  });

  return success({ message: "设备已删除" });
}
```

- [ ] **Step 3: Implement device line switch API**

Create `src/app/api/devices/[id]/line/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const deviceId = parseInt(id);
  const device = db.select().from(devices).where(eq(devices.id, deviceId)).get();
  if (!device) return error("NOT_FOUND", "设备不存在");

  const body = await request.json();
  const { lineId } = body;

  if (lineId) {
    const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
    if (!line) return error("NOT_FOUND", "线路不存在");
  }

  db.update(devices)
    .set({ lineId: lineId || null, updatedAt: new Date().toISOString() })
    .where(eq(devices.id, deviceId))
    .run();

  writeAuditLog({
    action: "update",
    targetType: "device",
    targetId: deviceId,
    targetName: device.name,
    detail: lineId ? `切换到线路 ${lineId}` : "取消关联线路",
  });

  return success({ message: "线路已更新" });
}
```

- [ ] **Step 4: Create device list page**

Create `src/app/(dashboard)/devices/page.tsx` — follows the same pattern as the nodes list page. Key differences:
- Columns: name, protocol (Badge "WireGuard" / "Xray"), wgAddress/xrayUuid, status, line, tags, actions
- Delete button calls `DELETE /api/devices/:id`

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { toast } from "sonner";

interface Device {
  id: number;
  name: string;
  protocol: string;
  wgAddress: string | null;
  xrayUuid: string | null;
  status: string;
  lineId: number | null;
  tags: string | null;
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const fetchDevices = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/devices?${params}`);
    const data = await res.json();
    setDevices(data.data);
    setPagination(data.pagination);
  }, [page, search]);

  useEffect(() => { fetchDevices(); }, [fetchDevices]);

  async function handleDelete(id: number) {
    if (!confirm("确定删除该设备？")) return;
    const res = await fetch(`/api/devices/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("设备已删除"); fetchDevices(); }
    else toast.error("删除失败");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">设备管理</h2>
        <Button asChild><Link href="/devices/new">新增设备</Link></Button>
      </div>
      <DataTable
        data={devices}
        searchPlaceholder="搜索设备名称..."
        onSearch={(q) => { setSearch(q); setPage(1); }}
        pagination={pagination}
        onPageChange={setPage}
        columns={[
          { key: "name", label: "名称", render: (row) => (
            <Link href={`/devices/${row.id}`} className="text-blue-600 hover:underline">{row.name}</Link>
          )},
          { key: "protocol", label: "协议", render: (row) => (
            <Badge variant="outline">{row.protocol === "wireguard" ? "WireGuard" : "Xray"}</Badge>
          )},
          { key: "address", label: "地址", render: (row) => row.wgAddress || row.xrayUuid || "-" },
          { key: "status", label: "状态", render: (row) => (
            <Badge variant={row.status === "online" ? "default" : "secondary"}>
              {row.status === "online" ? "在线" : "离线"}
            </Badge>
          )},
          { key: "actions", label: "操作", render: (row) => (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/devices/${row.id}`}>编辑</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link href={`/devices/${row.id}/config`}>配置</Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(row.id)}>删除</Button>
            </div>
          )},
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 5: Create device creation page**

Create `src/app/(dashboard)/devices/new/page.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export default function NewDevicePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [protocol, setProtocol] = useState("wireguard");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);

    const res = await fetch("/api/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        protocol,
        tags: form.get("tags") || undefined,
        remark: form.get("remark") || undefined,
      }),
    });

    if (res.ok) {
      toast.success("设备创建成功");
      router.push("/devices");
    } else {
      const data = await res.json();
      toast.error(data.error?.message || "创建失败");
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">新增设备</h2>
      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-lg">设备信息</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">设备名称 *</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1">
              <Label>接入协议 *</Label>
              <Select value={protocol} onValueChange={setProtocol}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="wireguard">WireGuard</SelectItem>
                  <SelectItem value="xray">Xray (VLESS)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags">标签</Label>
              <Input id="tags" name="tags" placeholder="手机,个人" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="remark">备注</Label>
              <Textarea id="remark" name="remark" />
            </div>
          </CardContent>
        </Card>
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建设备"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>取消</Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 6: Create device detail/edit page**

Create `src/app/(dashboard)/devices/[id]/page.tsx` — similar to node detail page. Shows read-only info (protocol, wgAddress/wgPublicKey/xrayUuid), editable fields (name, tags, remark), and a line selector dropdown.

The full implementation follows the same pattern as `nodes/[id]/page.tsx` — fetch device from `/api/devices/:id`, display read-only fields in a Card, editable fields in a form that PUTs to `/api/devices/:id`. Add a line selector that calls `PUT /api/devices/:id/line`.

- [ ] **Step 7: Verify device pages**

```bash
npm run dev
```

Test CRUD flow: create WG device, create Xray device, edit, delete.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add device management (API + pages)"
```

---

## Task 10: Line Management API

**Files:**
- Create: `src/app/api/lines/route.ts`, `src/app/api/lines/[id]/route.ts`, `src/app/api/lines/[id]/devices/route.ts`

- [ ] **Step 1: Implement line list + create API**

Create `src/app/api/lines/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lines, lineNodes, lineTunnels, nodes, settings } from "@/lib/db/schema";
import { success, created, paginated, error } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { writeAuditLog } from "@/lib/audit-log";
import { encrypt } from "@/lib/crypto";
import { generateKeyPair } from "@/lib/wireguard";
import { allocateTunnelSubnet, allocateTunnelPort } from "@/lib/ip-allocator";
import { eq, like, count, desc, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");
  const status = request.nextUrl.searchParams.get("status");

  const conditions = [];
  if (search) conditions.push(like(lines.name, `%${search}%`));
  if (status) conditions.push(eq(lines.status, status));

  const where =
    conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined;

  const total =
    db.select({ count: count() }).from(lines).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(lines)
    .where(where)
    .orderBy(desc(lines.createdAt))
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  // Attach node info to each line
  const result = rows.map((line) => {
    const lineNodeRows = db
      .select({
        hopOrder: lineNodes.hopOrder,
        role: lineNodes.role,
        nodeId: lineNodes.nodeId,
        nodeName: nodes.name,
      })
      .from(lineNodes)
      .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
      .where(eq(lineNodes.lineId, line.id))
      .orderBy(lineNodes.hopOrder)
      .all();
    return { ...line, nodes: lineNodeRows };
  });

  return paginated(result, {
    page: params.page,
    pageSize: params.pageSize,
    total,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, nodeIds, tags, remark } = body;

  // nodeIds: ordered array of node IDs [entryId, ...relayIds, exitId]
  if (!name || !nodeIds || nodeIds.length < 2) {
    return error("VALIDATION_ERROR", "线路至少需要入口和出口两个节点");
  }

  // Verify all nodes exist
  for (const nodeId of nodeIds) {
    const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
    if (!node) return error("NOT_FOUND", `节点 ${nodeId} 不存在`);
  }

  // Create line
  const lineResult = db
    .insert(lines)
    .values({ name, tags: tags || null, remark: remark || null })
    .run();
  const lineId = Number(lineResult.lastInsertRowid);

  // Create line_nodes
  for (let i = 0; i < nodeIds.length; i++) {
    let role: string;
    if (i === 0) role = "entry";
    else if (i === nodeIds.length - 1) role = "exit";
    else role = "relay";

    db.insert(lineNodes)
      .values({ lineId, nodeId: nodeIds[i], hopOrder: i, role })
      .run();
  }

  // Create line_tunnels for each adjacent pair
  const tunnelSubnet =
    db.select().from(settings).where(eq(settings.key, "tunnel_subnet")).get()?.value || "10.1.0.0/16";
  const portStart = parseInt(
    db.select().from(settings).where(eq(settings.key, "tunnel_port_start")).get()?.value || "51830"
  );

  // Get all used addresses and ports
  const usedAddresses = db
    .select()
    .from(lineTunnels)
    .all()
    .flatMap((t) => [t.fromWgAddress, t.toWgAddress]);

  const usedPorts = db
    .select()
    .from(lineTunnels)
    .all()
    .flatMap((t) => [t.fromWgPort, t.toWgPort]);

  for (let i = 0; i < nodeIds.length - 1; i++) {
    const fromNodeId = nodeIds[i];
    const toNodeId = nodeIds[i + 1];

    const fromKeyPair = generateKeyPair();
    const toKeyPair = generateKeyPair();

    const subnet = allocateTunnelSubnet(usedAddresses, tunnelSubnet);
    usedAddresses.push(subnet.fromAddress, subnet.toAddress);

    const fromPort = allocateTunnelPort(usedPorts, portStart);
    usedPorts.push(fromPort);
    const toPort = allocateTunnelPort(usedPorts, portStart);
    usedPorts.push(toPort);

    db.insert(lineTunnels)
      .values({
        lineId,
        hopIndex: i,
        fromNodeId,
        toNodeId,
        fromWgPrivateKey: encrypt(fromKeyPair.privateKey),
        fromWgPublicKey: fromKeyPair.publicKey,
        fromWgAddress: subnet.fromAddress,
        fromWgPort: fromPort,
        toWgPrivateKey: encrypt(toKeyPair.privateKey),
        toWgPublicKey: toKeyPair.publicKey,
        toWgAddress: subnet.toAddress,
        toWgPort: toPort,
      })
      .run();
  }

  writeAuditLog({
    action: "create",
    targetType: "line",
    targetId: lineId,
    targetName: name,
    detail: `节点: ${nodeIds.join(" → ")}`,
  });

  return created({ id: lineId, name });
}
```

- [ ] **Step 2: Implement line detail/update/delete API**

Create `src/app/api/lines/[id]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { lines, lineNodes, lineTunnels, nodes, devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return error("NOT_FOUND", "线路不存在");

  const lineNodeRows = db
    .select({
      hopOrder: lineNodes.hopOrder,
      role: lineNodes.role,
      nodeId: lineNodes.nodeId,
      nodeName: nodes.name,
      nodeIp: nodes.ip,
      nodeStatus: nodes.status,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(eq(lineNodes.lineId, lineId))
    .orderBy(lineNodes.hopOrder)
    .all();

  const tunnels = db
    .select()
    .from(lineTunnels)
    .where(eq(lineTunnels.lineId, lineId))
    .orderBy(lineTunnels.hopIndex)
    .all()
    .map(({ fromWgPrivateKey, toWgPrivateKey, ...rest }) => rest);

  const deviceCount = db
    .select({ count: require("drizzle-orm").count() })
    .from(devices)
    .where(eq(devices.lineId, lineId))
    .get()?.count ?? 0;

  return success({ ...line, nodes: lineNodeRows, tunnels, deviceCount });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return error("NOT_FOUND", "线路不存在");

  const body = await request.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.status !== undefined) updates.status = body.status;
  if (body.tags !== undefined) updates.tags = body.tags || null;
  if (body.remark !== undefined) updates.remark = body.remark || null;

  db.update(lines).set(updates).where(eq(lines.id, lineId)).run();

  writeAuditLog({
    action: "update",
    targetType: "line",
    targetId: lineId,
    targetName: body.name || line.name,
  });

  return success({ message: "线路已更新" });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const lineId = parseInt(id);
  const line = db.select().from(lines).where(eq(lines.id, lineId)).get();
  if (!line) return error("NOT_FOUND", "线路不存在");

  // Cascade delete handles line_nodes and line_tunnels
  // Unlink devices
  db.update(devices)
    .set({ lineId: null })
    .where(eq(devices.lineId, lineId))
    .run();

  db.delete(lines).where(eq(lines.id, lineId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "line",
    targetId: lineId,
    targetName: line.name,
  });

  return success({ message: "线路已删除" });
}
```

- [ ] **Step 3: Implement line devices API**

Create `src/app/api/lines/[id]/devices/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { devices } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const rows = db
    .select({
      id: devices.id,
      name: devices.name,
      protocol: devices.protocol,
      status: devices.status,
      wgAddress: devices.wgAddress,
      xrayUuid: devices.xrayUuid,
    })
    .from(devices)
    .where(eq(devices.lineId, parseInt(id)))
    .all();

  return success(rows);
}
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add line management API with tunnel auto-generation"
```

---

## Task 11: Line Management Pages

**Files:**
- Create: `src/app/(dashboard)/lines/page.tsx`, `src/app/(dashboard)/lines/new/page.tsx`, `src/app/(dashboard)/lines/[id]/page.tsx`

- [ ] **Step 1: Create line list page**

Create `src/app/(dashboard)/lines/page.tsx`:

```tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/data-table";
import { toast } from "sonner";

interface LineNode {
  hopOrder: number;
  role: string;
  nodeId: number;
  nodeName: string;
}

interface Line {
  id: number;
  name: string;
  status: string;
  tags: string | null;
  nodes: LineNode[];
}

export default function LinesPage() {
  const [lines, setLines] = useState<Line[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const fetchLines = useCallback(async () => {
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (search) params.set("search", search);
    const res = await fetch(`/api/lines?${params}`);
    const data = await res.json();
    setLines(data.data);
    setPagination(data.pagination);
  }, [page, search]);

  useEffect(() => { fetchLines(); }, [fetchLines]);

  async function handleDelete(id: number) {
    if (!confirm("确定删除该线路？关联设备将被取消绑定。")) return;
    const res = await fetch(`/api/lines/${id}`, { method: "DELETE" });
    if (res.ok) { toast.success("线路已删除"); fetchLines(); }
    else toast.error("删除失败");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">线路管理</h2>
        <Button asChild><Link href="/lines/new">新增线路</Link></Button>
      </div>
      <DataTable
        data={lines}
        searchPlaceholder="搜索线路名称..."
        onSearch={(q) => { setSearch(q); setPage(1); }}
        pagination={pagination}
        onPageChange={setPage}
        columns={[
          { key: "name", label: "名称", render: (row) => (
            <Link href={`/lines/${row.id}`} className="text-blue-600 hover:underline">{row.name}</Link>
          )},
          { key: "nodes", label: "节点链路", render: (row) => (
            <span className="text-sm">
              {row.nodes.map((n: LineNode, i: number) => (
                <span key={n.nodeId}>
                  {i > 0 && " → "}
                  <span className="font-medium">{n.nodeName}</span>
                  <span className="text-gray-400 text-xs ml-1">
                    ({n.role === "entry" ? "入口" : n.role === "exit" ? "出口" : "中转"})
                  </span>
                </span>
              ))}
            </span>
          )},
          { key: "status", label: "状态", render: (row) => (
            <Badge variant={row.status === "active" ? "default" : "secondary"}>
              {row.status === "active" ? "活跃" : "停用"}
            </Badge>
          )},
          { key: "actions", label: "操作", render: (row) => (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link href={`/lines/${row.id}`}>详情</Link>
              </Button>
              <Button variant="destructive" size="sm" onClick={() => handleDelete(row.id)}>删除</Button>
            </div>
          )},
        ]}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create line creation page with node selector**

Create `src/app/(dashboard)/lines/new/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

interface Node {
  id: number;
  name: string;
  ip: string;
}

export default function NewLinePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [allNodes, setAllNodes] = useState<Node[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<number[]>([0, 0]); // at least entry + exit

  useEffect(() => {
    fetch("/api/nodes?pageSize=100")
      .then((r) => r.json())
      .then((data) => setAllNodes(data.data));
  }, []);

  function addRelay() {
    const newNodes = [...selectedNodes];
    newNodes.splice(newNodes.length - 1, 0, 0); // insert before exit
    setSelectedNodes(newNodes);
  }

  function removeRelay(index: number) {
    if (selectedNodes.length <= 2) return;
    setSelectedNodes(selectedNodes.filter((_, i) => i !== index));
  }

  function setNodeAt(index: number, nodeId: number) {
    const newNodes = [...selectedNodes];
    newNodes[index] = nodeId;
    setSelectedNodes(newNodes);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = new FormData(e.currentTarget);
    const nodeIds = selectedNodes.filter((id) => id > 0);

    if (nodeIds.length < 2) {
      toast.error("至少选择入口和出口节点");
      setSubmitting(false);
      return;
    }

    const res = await fetch("/api/lines", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        nodeIds,
        tags: form.get("tags") || undefined,
        remark: form.get("remark") || undefined,
      }),
    });

    if (res.ok) {
      toast.success("线路创建成功");
      router.push("/lines");
    } else {
      const data = await res.json();
      toast.error(data.error?.message || "创建失败");
      setSubmitting(false);
    }
  }

  function roleLabel(index: number): string {
    if (index === 0) return "入口节点";
    if (index === selectedNodes.length - 1) return "出口节点";
    return `中转节点 ${index}`;
  }

  return (
    <div className="max-w-2xl">
      <h2 className="text-2xl font-bold mb-4">新增线路</h2>
      <form onSubmit={handleSubmit}>
        <Card className="mb-4">
          <CardHeader><CardTitle className="text-lg">基本信息</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">线路名称 *</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="tags">标签</Label>
              <Input id="tags" name="tags" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="remark">备注</Label>
              <Textarea id="remark" name="remark" />
            </div>
          </CardContent>
        </Card>

        <Card className="mb-4">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">节点编排</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addRelay}>
                + 添加中转
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {selectedNodes.map((nodeId, index) => (
              <div key={index} className="flex items-center gap-2">
                <span className="text-sm font-medium w-24 shrink-0">
                  {roleLabel(index)}
                </span>
                <Select
                  value={String(nodeId)}
                  onValueChange={(v) => setNodeAt(index, parseInt(v))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="选择节点" />
                  </SelectTrigger>
                  <SelectContent>
                    {allNodes.map((node) => (
                      <SelectItem key={node.id} value={String(node.id)}>
                        {node.name} ({node.ip})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {index > 0 && index < selectedNodes.length - 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeRelay(index)}
                  >
                    移除
                  </Button>
                )}
              </div>
            ))}
            {selectedNodes.length >= 2 && (
              <div className="text-sm text-gray-500 mt-2">
                链路: {selectedNodes
                  .filter((id) => id > 0)
                  .map((id) => allNodes.find((n) => n.id === id)?.name || "?")
                  .join(" → ")}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "创建中..." : "创建线路"}
          </Button>
          <Button type="button" variant="outline" onClick={() => router.back()}>取消</Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Create line detail page**

Create `src/app/(dashboard)/lines/[id]/page.tsx` — fetches from `GET /api/lines/:id`, displays:
- Line info (name, status, tags, remark) in editable form
- Node chain visualization (table: hop_order, name, role, status)
- Tunnel info (table: hop_index, from/to nodes, IPs, ports) — read-only
- Associated device count with link to filtered device list
- Edit form for name/status/tags/remark

Follow the same component pattern as `nodes/[id]/page.tsx`.

- [ ] **Step 4: Verify line management**

```bash
npm run dev
```

1. Create 2-3 nodes first
2. Create a line with entry → exit
3. Create a line with entry → relay → exit
4. Verify line list shows node chain
5. Verify line detail shows tunnels with auto-generated IPs and ports

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add line management pages with node orchestration UI"
```

---

## Task 12: Install Script and Client Config Generation

**Files:**
- Create: `src/app/api/nodes/[id]/script/route.ts`, `src/app/api/devices/[id]/config/route.ts`, `src/app/(dashboard)/nodes/[id]/script/page.tsx`, `src/app/(dashboard)/devices/[id]/config/page.tsx`

- [ ] **Step 1: Implement install script API**

Create `src/app/api/nodes/[id]/script/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { nodes, settings } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { error } from "@/lib/api-response";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

function getSetting(key: string, fallback: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value || fallback;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const node = db.select().from(nodes).where(eq(nodes.id, parseInt(id))).get();
  if (!node) return error("NOT_FOUND", "节点不存在");

  const privateKey = decrypt(node.wgPrivateKey);
  const serverUrl = request.nextUrl.origin;

  let script = `#!/bin/bash
# === WireMesh Node Install Script ===
# Node: ${node.name}
# Generated: ${new Date().toISOString()}

set -e

echo "Installing WireMesh Agent for node: ${node.name}"

# 1. Create directories
mkdir -p /etc/wiremesh/wireguard

# 2. Install WireGuard
if ! command -v wg &> /dev/null; then
  apt-get update && apt-get install -y wireguard
fi

# 3. Write WireGuard config
cat > /etc/wiremesh/wireguard/wm-wg0.conf << 'WGEOF'
[Interface]
PrivateKey = ${privateKey}
Address = ${node.wgAddress}
ListenPort = ${node.port}

# Peers managed by Agent
WGEOF

# 4. Enable IP forwarding
echo 'net.ipv4.ip_forward = 1' > /etc/sysctl.d/99-wiremesh.conf
sysctl -p /etc/sysctl.d/99-wiremesh.conf

# 5. Start WireGuard
ip link add wm-wg0 type wireguard 2>/dev/null || true
wg setconf wm-wg0 /etc/wiremesh/wireguard/wm-wg0.conf
ip addr add ${node.wgAddress} dev wm-wg0 2>/dev/null || true
ip link set wm-wg0 up
`;

  if (node.xrayEnabled) {
    const xrayPort = node.xrayPort || 443;
    const xrayTransport = node.xrayTransport || "ws";
    script += `
# 6. Install Xray
if ! command -v xray &> /dev/null; then
  bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
fi

echo "Xray configuration should be set up separately (port: ${xrayPort}, transport: ${xrayTransport})"
`;
  }

  script += `
# 7. Download Agent binary
curl -fsSL ${serverUrl}/api/agent/binary -o /usr/local/bin/wiremesh-agent
chmod +x /usr/local/bin/wiremesh-agent

# 8. Write Agent config
cat > /etc/wiremesh/agent.yaml << 'AGENTEOF'
server_url: "${serverUrl}"
node_id: ${node.id}
token: "${node.agentToken}"
report_interval: 300
AGENTEOF

# 9. Register systemd service
cat > /etc/systemd/system/wiremesh-agent.service << 'SVCEOF'
[Unit]
Description=WireMesh Node Agent
After=network.target

[Service]
ExecStart=/usr/local/bin/wiremesh-agent
Restart=always
RestartSec=5
WorkingDirectory=/etc/wiremesh

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable wiremesh-agent
systemctl start wiremesh-agent

echo "Installation complete. Agent is connecting to management platform..."
`;

  return new NextResponse(script, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
```

- [ ] **Step 2: Implement client config API**

Create `src/app/api/devices/[id]/config/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { devices, nodes, lines, lineNodes, settings } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { error, success } from "@/lib/api-response";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

function getSetting(key: string, fallback: string): string {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value || fallback;
}

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const device = db.select().from(devices).where(eq(devices.id, parseInt(id))).get();
  if (!device) return error("NOT_FOUND", "设备不存在");

  if (!device.lineId) {
    return error("VALIDATION_ERROR", "设备未关联线路，无法生成配置");
  }

  // Find entry node for the line
  const entryNode = db
    .select({
      nodeId: lineNodes.nodeId,
      ip: nodes.ip,
      domain: nodes.domain,
      port: nodes.port,
      wgPublicKey: nodes.wgPublicKey,
    })
    .from(lineNodes)
    .innerJoin(nodes, eq(lineNodes.nodeId, nodes.id))
    .where(eq(lineNodes.lineId, device.lineId))
    .orderBy(lineNodes.hopOrder)
    .get();

  if (!entryNode) return error("INTERNAL_ERROR", "线路入口节点未找到");

  const dns = getSetting("wg_default_dns", "1.1.1.1");

  if (device.protocol === "wireguard") {
    const privateKey = decrypt(device.wgPrivateKey!);
    const endpoint = entryNode.domain || entryNode.ip;

    const conf = `[Interface]
PrivateKey = ${privateKey}
Address = ${device.wgAddress}
DNS = ${dns}

[Peer]
PublicKey = ${entryNode.wgPublicKey}
Endpoint = ${endpoint}:${entryNode.port}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

    return success({ format: "wireguard", config: conf, filename: `${device.name}.conf` });
  } else {
    // Xray VLESS config
    const xrayNode = db.select().from(nodes).where(eq(nodes.id, entryNode.nodeId)).get();
    const endpoint = xrayNode?.domain || xrayNode?.ip;
    const transport = xrayNode?.xrayTransport || "ws";
    const port = xrayNode?.xrayPort || 443;

    const config = {
      inbounds: [{ port: 1080, protocol: "socks", settings: { udp: true } }],
      outbounds: [{
        protocol: "vless",
        settings: {
          vnext: [{
            address: endpoint,
            port,
            users: [{ id: device.xrayUuid, encryption: "none" }],
          }],
        },
        streamSettings: {
          network: transport,
          security: "tls",
          ...(transport === "ws" ? { wsSettings: { path: "/" } } : {}),
          ...(transport === "grpc" ? { grpcSettings: { serviceName: "wiremesh" } } : {}),
        },
      }],
    };

    return success({ format: "xray", config: JSON.stringify(config, null, 2), filename: `${device.name}.json` });
  }
}
```

- [ ] **Step 3: Create install script view page**

Create `src/app/(dashboard)/nodes/[id]/script/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function NodeScriptPage() {
  const params = useParams();
  const [script, setScript] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/nodes/${params.id}/script`)
      .then((r) => r.text())
      .then((text) => {
        setScript(text);
        setLoading(false);
      });
  }, [params.id]);

  function handleCopy() {
    navigator.clipboard.writeText(script);
    toast.success("脚本已复制到剪贴板");
  }

  if (loading) return <div>生成脚本中...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">安装脚本</h2>
        <Button onClick={handleCopy}>复制脚本</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <pre className="p-4 text-sm overflow-x-auto bg-gray-950 text-gray-100 rounded-lg">
            <code>{script}</code>
          </pre>
        </CardContent>
      </Card>
      <p className="text-sm text-gray-500 mt-4">
        复制上述脚本到节点服务器上以 root 权限执行：<code className="bg-gray-100 px-1">bash install.sh</code>
      </p>
    </div>
  );
}
```

- [ ] **Step 4: Create device config view page**

Create `src/app/(dashboard)/devices/[id]/config/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

interface ConfigData {
  format: string;
  config: string;
  filename: string;
}

export default function DeviceConfigPage() {
  const params = useParams();
  const [data, setData] = useState<ConfigData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/devices/${params.id}/config`)
      .then((r) => r.json())
      .then((res) => {
        if (res.error) setError(res.error.message);
        else setData(res.data);
      });
  }, [params.id]);

  function handleCopy() {
    if (!data) return;
    navigator.clipboard.writeText(data.config);
    toast.success("配置已复制到剪贴板");
  }

  function handleDownload() {
    if (!data) return;
    const blob = new Blob([data.config], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = data.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (error) return <div className="text-red-500">{error}</div>;
  if (!data) return <div>生成配置中...</div>;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold">
          客户端配置（{data.format === "wireguard" ? "WireGuard" : "Xray"}）
        </h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleCopy}>复制</Button>
          <Button onClick={handleDownload}>下载 {data.filename}</Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          <pre className="p-4 text-sm overflow-x-auto bg-gray-950 text-gray-100 rounded-lg">
            <code>{data.config}</code>
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Test install script generation and client config generation via the UI.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add install script and client config generation"
```

---

## Task 13: Filter Management

**Files:**
- Create: `src/app/api/filters/route.ts`, `src/app/api/filters/[id]/route.ts`, `src/app/api/filters/[id]/toggle/route.ts`, `src/app/(dashboard)/filters/page.tsx`, `src/app/(dashboard)/filters/new/page.tsx`, `src/app/(dashboard)/filters/[id]/page.tsx`

- [ ] **Step 1: Implement filter CRUD API**

Create `src/app/api/filters/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, lineFilters } from "@/lib/db/schema";
import { success, created, paginated, error } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { writeAuditLog } from "@/lib/audit-log";
import { eq, like, count, desc, sql } from "drizzle-orm";

export async function GET(request: NextRequest) {
  const params = parsePaginationParams(request.nextUrl.searchParams);
  const search = request.nextUrl.searchParams.get("search");

  const conditions = [];
  if (search) conditions.push(like(filters.name, `%${search}%`));

  const where =
    conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined;

  const total =
    db.select({ count: count() }).from(filters).where(where).get()?.count ?? 0;

  const rows = db
    .select()
    .from(filters)
    .where(where)
    .orderBy(desc(filters.createdAt))
    .limit(params.pageSize)
    .offset(paginationOffset(params))
    .all();

  return paginated(rows, { page: params.page, pageSize: params.pageSize, total });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, rules, mode, lineIds, tags, remark } = body;

  if (!name || !rules) {
    return error("VALIDATION_ERROR", "规则名称和内容不能为空");
  }

  const result = db
    .insert(filters)
    .values({
      name,
      rules,
      mode: mode || "whitelist",
      tags: tags || null,
      remark: remark || null,
    })
    .run();

  const filterId = Number(result.lastInsertRowid);

  // Associate with lines
  if (lineIds && Array.isArray(lineIds)) {
    for (const lineId of lineIds) {
      db.insert(lineFilters).values({ lineId, filterId }).run();
    }
  }

  writeAuditLog({
    action: "create",
    targetType: "filter",
    targetId: filterId,
    targetName: name,
  });

  return created({ id: filterId, name });
}
```

- [ ] **Step 2: Implement filter detail/update/delete and toggle APIs**

Create `src/app/api/filters/[id]/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters, lineFilters, lines } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filter = db.select().from(filters).where(eq(filters.id, parseInt(id))).get();
  if (!filter) return error("NOT_FOUND", "规则不存在");

  const associatedLines = db
    .select({ lineId: lineFilters.lineId, lineName: lines.name })
    .from(lineFilters)
    .innerJoin(lines, eq(lineFilters.lineId, lines.id))
    .where(eq(lineFilters.filterId, filter.id))
    .all();

  return success({ ...filter, lines: associatedLines });
}

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  const filter = db.select().from(filters).where(eq(filters.id, filterId)).get();
  if (!filter) return error("NOT_FOUND", "规则不存在");

  const body = await request.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.rules !== undefined) updates.rules = body.rules;
  if (body.mode !== undefined) updates.mode = body.mode;
  if (body.tags !== undefined) updates.tags = body.tags || null;
  if (body.remark !== undefined) updates.remark = body.remark || null;

  db.update(filters).set(updates).where(eq(filters.id, filterId)).run();

  // Update line associations if provided
  if (body.lineIds !== undefined) {
    db.delete(lineFilters).where(eq(lineFilters.filterId, filterId)).run();
    for (const lineId of body.lineIds) {
      db.insert(lineFilters).values({ lineId, filterId }).run();
    }
  }

  writeAuditLog({
    action: "update",
    targetType: "filter",
    targetId: filterId,
    targetName: body.name || filter.name,
  });

  return success({ message: "规则已更新" });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  const filter = db.select().from(filters).where(eq(filters.id, filterId)).get();
  if (!filter) return error("NOT_FOUND", "规则不存在");

  db.delete(filters).where(eq(filters.id, filterId)).run();

  writeAuditLog({
    action: "delete",
    targetType: "filter",
    targetId: filterId,
    targetName: filter.name,
  });

  return success({ message: "规则已删除" });
}
```

Create `src/app/api/filters/[id]/toggle/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { filters } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { writeAuditLog } from "@/lib/audit-log";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const filterId = parseInt(id);
  const filter = db.select().from(filters).where(eq(filters.id, filterId)).get();
  if (!filter) return error("NOT_FOUND", "规则不存在");

  const newEnabled = !filter.isEnabled;
  db.update(filters)
    .set({ isEnabled: newEnabled, updatedAt: new Date().toISOString() })
    .where(eq(filters.id, filterId))
    .run();

  writeAuditLog({
    action: "update",
    targetType: "filter",
    targetId: filterId,
    targetName: filter.name,
    detail: newEnabled ? "启用" : "禁用",
  });

  return success({ isEnabled: newEnabled });
}
```

- [ ] **Step 3: Create filter pages**

Create filter list, create, and detail pages following the same patterns as nodes/devices. The create/edit form has:
- Name input
- Mode select (whitelist/blacklist)
- Rules textarea (one IP/CIDR per line)
- Line multi-select (checkboxes for available lines)
- Tags input
- Remark textarea

- [ ] **Step 4: Verify filter management**

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add filter management with line association"
```

---

## Task 14: Dashboard

**Files:**
- Create: `src/app/api/dashboard/route.ts`
- Modify: `src/app/(dashboard)/dashboard/page.tsx`

- [ ] **Step 1: Implement dashboard API**

Create `src/app/api/dashboard/route.ts`:

```typescript
import { db } from "@/lib/db";
import { nodes, devices, lines, nodeStatus } from "@/lib/db/schema";
import { success } from "@/lib/api-response";
import { eq, count, desc, sql } from "drizzle-orm";

export async function GET() {
  // Node stats
  const totalNodes = db.select({ count: count() }).from(nodes).get()?.count ?? 0;
  const onlineNodes = db.select({ count: count() }).from(nodes).where(eq(nodes.status, "online")).get()?.count ?? 0;
  const offlineNodes = db.select({ count: count() }).from(nodes).where(eq(nodes.status, "offline")).get()?.count ?? 0;
  const errorNodes = db.select({ count: count() }).from(nodes).where(eq(nodes.status, "error")).get()?.count ?? 0;

  // Device stats
  const totalDevices = db.select({ count: count() }).from(devices).get()?.count ?? 0;
  const onlineDevices = db.select({ count: count() }).from(devices).where(eq(devices.status, "online")).get()?.count ?? 0;

  // Line stats
  const totalLines = db.select({ count: count() }).from(lines).get()?.count ?? 0;
  const activeLines = db.select({ count: count() }).from(lines).where(eq(lines.status, "active")).get()?.count ?? 0;

  // Traffic data — latest status per node
  const traffic = db
    .select({
      nodeId: nodes.id,
      nodeName: nodes.name,
      uploadBytes: nodeStatus.uploadBytes,
      downloadBytes: nodeStatus.downloadBytes,
    })
    .from(nodeStatus)
    .innerJoin(nodes, eq(nodeStatus.nodeId, nodes.id))
    .orderBy(desc(nodeStatus.checkedAt))
    .limit(50)
    .all();

  // Deduplicate to latest per node
  const trafficMap = new Map<number, typeof traffic[0]>();
  for (const t of traffic) {
    if (!trafficMap.has(t.nodeId)) trafficMap.set(t.nodeId, t);
  }

  // Recent nodes
  const recentNodes = db
    .select({
      id: nodes.id,
      name: nodes.name,
      ip: nodes.ip,
      status: nodes.status,
    })
    .from(nodes)
    .orderBy(desc(nodes.updatedAt))
    .limit(10)
    .all();

  // Recent devices
  const recentDevices = db
    .select({
      id: devices.id,
      name: devices.name,
      status: devices.status,
      lastHandshake: devices.lastHandshake,
    })
    .from(devices)
    .orderBy(desc(devices.updatedAt))
    .limit(10)
    .all();

  return success({
    nodes: { total: totalNodes, online: onlineNodes, offline: offlineNodes, error: errorNodes },
    devices: { total: totalDevices, online: onlineDevices, offline: totalDevices - onlineDevices },
    lines: { total: totalLines, active: activeLines, inactive: totalLines - activeLines },
    traffic: Array.from(trafficMap.values()),
    recentNodes,
    recentDevices,
  });
}
```

- [ ] **Step 2: Implement dashboard page**

Update `src/app/(dashboard)/dashboard/page.tsx`:

```tsx
"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import Link from "next/link";

interface DashboardData {
  nodes: { total: number; online: number; offline: number; error: number };
  devices: { total: number; online: number; offline: number };
  lines: { total: number; active: number; inactive: number };
  traffic: { nodeId: number; nodeName: string; uploadBytes: number; downloadBytes: number }[];
  recentNodes: { id: number; name: string; ip: string; status: string }[];
  recentDevices: { id: number; name: string; status: string; lastHandshake: string | null }[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);

  useEffect(() => {
    fetch("/api/dashboard")
      .then((r) => r.json())
      .then((res) => setData(res.data));
  }, []);

  if (!data) return <div>加载中...</div>;

  const statCards = [
    { title: "节点", total: data.nodes.total, details: `${data.nodes.online} 在线 / ${data.nodes.offline} 离线${data.nodes.error > 0 ? ` / ${data.nodes.error} 异常` : ""}` },
    { title: "设备", total: data.devices.total, details: `${data.devices.online} 在线 / ${data.devices.offline} 离线` },
    { title: "线路", total: data.lines.total, details: `${data.lines.active} 活跃 / ${data.lines.inactive} 停用` },
  ];

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">仪表盘</h2>

      <div className="grid grid-cols-3 gap-4">
        {statCards.map((card) => (
          <Card key={card.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-gray-500">{card.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{card.total}</div>
              <p className="text-sm text-gray-500 mt-1">{card.details}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-lg">节点状态</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentNodes.map((node) => (
                  <TableRow key={node.id}>
                    <TableCell>
                      <Link href={`/nodes/${node.id}`} className="text-blue-600 hover:underline">{node.name}</Link>
                    </TableCell>
                    <TableCell>{node.ip}</TableCell>
                    <TableCell>
                      <Badge variant={node.status === "online" ? "default" : node.status === "error" ? "destructive" : "secondary"}>
                        {node.status === "online" ? "在线" : node.status === "error" ? "异常" : "离线"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">设备状态</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>最后握手</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.recentDevices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <Link href={`/devices/${device.id}`} className="text-blue-600 hover:underline">{device.name}</Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant={device.status === "online" ? "default" : "secondary"}>
                        {device.status === "online" ? "在线" : "离线"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {device.lastHandshake ? new Date(device.lastHandshake).toLocaleString("zh-CN") : "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {data.traffic.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">节点流量</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>节点</TableHead>
                  <TableHead>上行</TableHead>
                  <TableHead>下行</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.traffic.map((t) => (
                  <TableRow key={t.nodeId}>
                    <TableCell>{t.nodeName}</TableCell>
                    <TableCell>{formatBytes(t.uploadBytes)}</TableCell>
                    <TableCell>{formatBytes(t.downloadBytes)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify dashboard**

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add dashboard with stats and status overview"
```

---

## Task 15: SSE Manager and Agent APIs

**Files:**
- Create: `src/lib/sse-manager.ts`, `src/app/api/agent/sse/route.ts`, `src/app/api/agent/config/route.ts`, `src/app/api/agent/status/route.ts`, `src/app/api/agent/error/route.ts`, `src/app/api/agent/installed/route.ts`, `src/app/api/agent/binary/route.ts`

- [ ] **Step 1: Implement SSE connection manager**

Create `src/lib/sse-manager.ts`:

```typescript
type SSEConnection = {
  nodeId: number;
  controller: ReadableStreamDefaultController;
  connectedAt: Date;
};

class SSEManager {
  private connections = new Map<number, SSEConnection>();

  addConnection(nodeId: number, controller: ReadableStreamDefaultController) {
    // Close existing connection for this node
    this.removeConnection(nodeId);
    this.connections.set(nodeId, {
      nodeId,
      controller,
      connectedAt: new Date(),
    });
  }

  removeConnection(nodeId: number) {
    const conn = this.connections.get(nodeId);
    if (conn) {
      try {
        conn.controller.close();
      } catch {
        // Already closed
      }
      this.connections.delete(nodeId);
    }
  }

  sendEvent(nodeId: number, event: string, data?: string) {
    const conn = this.connections.get(nodeId);
    if (!conn) return false;

    try {
      const message = `event: ${event}\ndata: ${data || "{}"}\n\n`;
      conn.controller.enqueue(new TextEncoder().encode(message));
      return true;
    } catch {
      this.removeConnection(nodeId);
      return false;
    }
  }

  // Send event to multiple nodes
  broadcast(nodeIds: number[], event: string, data?: string) {
    for (const nodeId of nodeIds) {
      this.sendEvent(nodeId, event, data);
    }
  }

  isConnected(nodeId: number): boolean {
    return this.connections.has(nodeId);
  }

  getConnectedNodeIds(): number[] {
    return Array.from(this.connections.keys());
  }
}

// Singleton
export const sseManager = new SSEManager();
```

- [ ] **Step 2: Implement SSE endpoint**

Create `src/app/api/agent/sse/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { sseManager } from "@/lib/sse-manager";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

function authenticateAgent(
  request: NextRequest
): { nodeId: number } | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);

  const node = db
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.agentToken, token))
    .get();

  return node ? { nodeId: node.id } : null;
}

export async function GET(request: NextRequest) {
  const auth = authenticateAgent(request);
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { nodeId } = auth;

  const stream = new ReadableStream({
    start(controller) {
      sseManager.addConnection(nodeId, controller);

      // Send initial heartbeat
      const msg = `event: connected\ndata: {"nodeId":${nodeId}}\n\n`;
      controller.enqueue(new TextEncoder().encode(msg));

      // Update node status to online
      db.update(nodes)
        .set({ status: "online", updatedAt: new Date().toISOString() })
        .where(eq(nodes.id, nodeId))
        .run();
    },
    cancel() {
      sseManager.removeConnection(nodeId);
      // Mark node offline
      db.update(nodes)
        .set({ status: "offline", updatedAt: new Date().toISOString() })
        .where(eq(nodes.id, nodeId))
        .run();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 3: Implement agent config API**

Create `src/app/api/agent/config/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, devices, lines, lineNodes, lineTunnels } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { eq, and } from "drizzle-orm";

export const dynamic = "force-dynamic";

function authenticateAgent(request: NextRequest): number | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const node = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.agentToken, token)).get();
  return node?.id ?? null;
}

export async function GET(request: NextRequest) {
  const nodeId = authenticateAgent(request);
  if (!nodeId) return new Response("Unauthorized", { status: 401 });

  const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return new Response("Not found", { status: 404 });

  // Get peers (devices assigned to lines where this node is entry)
  const entryLines = db
    .select({ lineId: lineNodes.lineId })
    .from(lineNodes)
    .where(and(eq(lineNodes.nodeId, nodeId), eq(lineNodes.role, "entry")))
    .all();

  const entryLineIds = entryLines.map((l) => l.lineId);

  const peers = entryLineIds.length > 0
    ? db
        .select()
        .from(devices)
        .all()
        .filter((d) => d.lineId && entryLineIds.includes(d.lineId) && d.protocol === "wireguard" && d.wgPublicKey)
        .map((d) => ({
          public_key: d.wgPublicKey!,
          allowed_ips: d.wgAddress?.replace(/\/\d+$/, "/32") || "",
          endpoint: null,
          persistent_keepalive: 25,
        }))
    : [];

  // Get tunnel configs for this node
  const tunnelConfigs = [];

  // Find all lines this node participates in
  const nodeLines = db
    .select()
    .from(lineNodes)
    .where(eq(lineNodes.nodeId, nodeId))
    .all();

  for (const nodeLine of nodeLines) {
    const line = db.select().from(lines).where(eq(lines.id, nodeLine.lineId)).get();
    if (!line) continue;

    const tunnels = db
      .select()
      .from(lineTunnels)
      .where(eq(lineTunnels.lineId, nodeLine.lineId))
      .all();

    const interfaces = [];
    const iptablesRules: string[] = [];

    for (const tunnel of tunnels) {
      // This node is the "from" side
      if (tunnel.fromNodeId === nodeId) {
        const toNode = db.select().from(nodes).where(eq(nodes.id, tunnel.toNodeId)).get();
        interfaces.push({
          name: `wm-tun${tunnel.id}`,
          direction: "downstream",
          private_key: decrypt(tunnel.fromWgPrivateKey),
          address: tunnel.fromWgAddress,
          listen_port: tunnel.fromWgPort,
          peer: {
            public_key: tunnel.toWgPublicKey,
            allowed_ips: "0.0.0.0/0",
            endpoint: toNode ? `${toNode.ip}:${tunnel.toWgPort}` : "",
          },
        });
      }

      // This node is the "to" side
      if (tunnel.toNodeId === nodeId) {
        const fromNode = db.select().from(nodes).where(eq(nodes.id, tunnel.fromNodeId)).get();
        interfaces.push({
          name: `wm-tun${tunnel.id}`,
          direction: "upstream",
          private_key: decrypt(tunnel.toWgPrivateKey),
          address: tunnel.toWgAddress,
          listen_port: tunnel.toWgPort,
          peer: {
            public_key: tunnel.fromWgPublicKey,
            allowed_ips: tunnel.fromWgAddress.replace(/\/\d+$/, "/30"),
            endpoint: fromNode ? `${fromNode.ip}:${tunnel.fromWgPort}` : "",
          },
        });
      }
    }

    // Generate iptables rules based on role
    const comment = `wm-line-${nodeLine.lineId}`;
    if (nodeLine.role === "entry" && interfaces.length > 0) {
      const tunName = interfaces[0].name;
      iptablesRules.push(
        `iptables -A FORWARD -i wm-wg0 -o ${tunName} -m comment --comment '${comment}' -j ACCEPT`,
        `iptables -A FORWARD -i ${tunName} -o wm-wg0 -m comment --comment '${comment}' -j ACCEPT`
      );
    } else if (nodeLine.role === "relay" && interfaces.length >= 2) {
      const upstream = interfaces.find((i) => i.direction === "upstream");
      const downstream = interfaces.find((i) => i.direction === "downstream");
      if (upstream && downstream) {
        iptablesRules.push(
          `iptables -A FORWARD -i ${upstream.name} -o ${downstream.name} -m comment --comment '${comment}' -j ACCEPT`,
          `iptables -A FORWARD -i ${downstream.name} -o ${upstream.name} -m comment --comment '${comment}' -j ACCEPT`
        );
      }
    } else if (nodeLine.role === "exit" && interfaces.length > 0) {
      const tunName = interfaces[0].name;
      iptablesRules.push(
        `iptables -A FORWARD -i ${tunName} -o eth0 -m comment --comment '${comment}' -j ACCEPT`,
        `iptables -A FORWARD -i eth0 -o ${tunName} -m state --state RELATED,ESTABLISHED -m comment --comment '${comment}' -j ACCEPT`,
        `iptables -t nat -A POSTROUTING -o eth0 -s ${interfaces[0].address.replace(/\.\d+\//, ".0/")} -m comment --comment '${comment}' -j MASQUERADE`
      );
    }

    tunnelConfigs.push({
      line_id: nodeLine.lineId,
      line_name: line.name,
      role: nodeLine.role,
      interfaces,
      iptables_rules: iptablesRules,
    });
  }

  const config = {
    node: {
      id: node.id,
      name: node.name,
      ip: node.ip,
      wg_address: node.wgAddress,
      wg_port: node.port,
      wg_private_key: decrypt(node.wgPrivateKey),
    },
    peers,
    tunnels: tunnelConfigs,
    xray: {
      enabled: node.xrayEnabled,
      protocol: node.xrayProtocol,
      transport: node.xrayTransport,
      port: node.xrayPort,
      config: node.xrayConfig ? JSON.parse(node.xrayConfig) : null,
    },
    version: node.updatedAt,
  };

  return Response.json({ data: config });
}
```

- [ ] **Step 4: Implement status, error, installed, and binary APIs**

Create `src/app/api/agent/status/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes, nodeStatus, devices } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function authenticateAgent(request: NextRequest): number | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const node = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.agentToken, token)).get();
  return node?.id ?? null;
}

export async function POST(request: NextRequest) {
  const nodeId = authenticateAgent(request);
  if (!nodeId) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const { is_online, latency, transfers, handshakes } = body;

  // Insert status record
  const totalUpload = (transfers || []).reduce((s: number, t: any) => s + (t.upload_bytes || 0), 0);
  const totalDownload = (transfers || []).reduce((s: number, t: any) => s + (t.download_bytes || 0), 0);

  db.insert(nodeStatus)
    .values({
      nodeId,
      isOnline: is_online ?? true,
      latency: latency ?? null,
      uploadBytes: totalUpload,
      downloadBytes: totalDownload,
    })
    .run();

  // Update node status
  db.update(nodes)
    .set({ status: is_online ? "online" : "offline", updatedAt: new Date().toISOString() })
    .where(eq(nodes.id, nodeId))
    .run();

  // Update device handshakes
  if (handshakes) {
    for (const hs of handshakes) {
      db.update(devices)
        .set({
          status: "online",
          lastHandshake: hs.last_handshake,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(devices.wgPublicKey, hs.peer_public_key))
        .run();
    }
  }

  return Response.json({ data: { message: "ok" } });
}
```

Create `src/app/api/agent/error/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

function authenticateAgent(request: NextRequest): number | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const node = db.select({ id: nodes.id }).from(nodes).where(eq(nodes.agentToken, token)).get();
  return node?.id ?? null;
}

export async function POST(request: NextRequest) {
  const nodeId = authenticateAgent(request);
  if (!nodeId) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();

  db.update(nodes)
    .set({
      status: "error",
      errorMessage: body.message || "Unknown error",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, nodeId))
    .run();

  return Response.json({ data: { message: "ok" } });
}
```

Create `src/app/api/agent/installed/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { writeAuditLog } from "@/lib/audit-log";
import { eq } from "drizzle-orm";

function authenticateAgent(request: NextRequest): number | null {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const token = auth.slice(7);
  const node = db.select({ id: nodes.id, name: nodes.name }).from(nodes).where(eq(nodes.agentToken, token)).get();
  return node?.id ?? null;
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return new Response("Unauthorized", { status: 401 });
  const token = auth.slice(7);
  const node = db.select().from(nodes).where(eq(nodes.agentToken, token)).get();
  if (!node) return new Response("Unauthorized", { status: 401 });

  db.update(nodes)
    .set({
      status: "online",
      errorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(nodes.id, node.id))
    .run();

  writeAuditLog({
    action: "update",
    targetType: "node",
    targetId: node.id,
    targetName: node.name,
    detail: "Agent 安装完成",
  });

  return Response.json({ data: { message: "ok" } });
}
```

Create `src/app/api/agent/binary/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET() {
  const binaryPath = path.join(
    process.cwd(),
    "public",
    "agent",
    "wiremesh-agent-linux-amd64"
  );

  if (!fs.existsSync(binaryPath)) {
    return new NextResponse("Agent binary not found", { status: 404 });
  }

  const binary = fs.readFileSync(binaryPath);
  return new NextResponse(binary, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition":
        "attachment; filename=wiremesh-agent",
    },
  });
}
```

- [ ] **Step 5: Wire SSE notifications into CRUD operations**

Add a helper function in `src/lib/sse-manager.ts`:

```typescript
// Add to SSEManager class:
  notifyNodePeerUpdate(nodeId: number) {
    this.sendEvent(nodeId, "peer_update");
  }

  notifyNodeConfigUpdate(nodeId: number) {
    this.sendEvent(nodeId, "config_update");
  }

  notifyNodeTunnelUpdate(nodeId: number) {
    this.sendEvent(nodeId, "tunnel_update");
  }
```

Then in the node, device, and line CRUD APIs, after mutations that affect agents, call the appropriate SSE notification. For example:

- After creating/deleting a device → `sseManager.notifyNodePeerUpdate(entryNodeId)` for the device's line entry node
- After updating a node's config → `sseManager.notifyNodeConfigUpdate(nodeId)`
- After creating/updating/deleting a line → `sseManager.notifyNodeTunnelUpdate(nodeId)` for all nodes in the line

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add SSE manager and all Agent API endpoints"
```

---

## Task 16: Node Status History

**Files:**
- Create: `src/app/api/nodes/[id]/status/route.ts`, `src/app/api/nodes/[id]/check/route.ts`

- [ ] **Step 1: Implement node status history API**

Create `src/app/api/nodes/[id]/status/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodeStatus } from "@/lib/db/schema";
import { paginated, error } from "@/lib/api-response";
import { parsePaginationParams, paginationOffset } from "@/lib/pagination";
import { eq, count, desc } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);
  const pParams = parsePaginationParams(request.nextUrl.searchParams);

  const total = db
    .select({ count: count() })
    .from(nodeStatus)
    .where(eq(nodeStatus.nodeId, nodeId))
    .get()?.count ?? 0;

  const rows = db
    .select()
    .from(nodeStatus)
    .where(eq(nodeStatus.nodeId, nodeId))
    .orderBy(desc(nodeStatus.checkedAt))
    .limit(pParams.pageSize)
    .offset(paginationOffset(pParams))
    .all();

  return paginated(rows, { page: pParams.page, pageSize: pParams.pageSize, total });
}
```

- [ ] **Step 2: Implement manual check API**

Create `src/app/api/nodes/[id]/check/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { nodes } from "@/lib/db/schema";
import { success, error } from "@/lib/api-response";
import { sseManager } from "@/lib/sse-manager";
import { eq } from "drizzle-orm";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const nodeId = parseInt(id);

  const node = db.select().from(nodes).where(eq(nodes.id, nodeId)).get();
  if (!node) return error("NOT_FOUND", "节点不存在");

  const isConnected = sseManager.isConnected(nodeId);

  if (!isConnected && node.status === "online") {
    db.update(nodes)
      .set({ status: "offline", updatedAt: new Date().toISOString() })
      .where(eq(nodes.id, nodeId))
      .run();
  }

  return success({ isConnected, status: isConnected ? "online" : "offline" });
}
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: add node status history and manual check APIs"
```

---

## Task 17: Worker Process

**Files:**
- Create: `worker/index.js`, `worker/node-checker.js`, `worker/line-syncer.js`, `worker/data-cleaner.js`

- [ ] **Step 1: Create worker entry point**

Create `worker/index.js`:

```javascript
const { checkNodes } = require("./node-checker");
const { syncLineStatus } = require("./line-syncer");
const { cleanOldData } = require("./data-cleaner");

console.log("[Worker] Starting WireMesh Worker...");

// Node status check — every 5 minutes (configurable via settings)
const CHECK_INTERVAL = 5 * 60 * 1000;
setInterval(async () => {
  try {
    await checkNodes();
    await syncLineStatus();
  } catch (err) {
    console.error("[Worker] Check failed:", err);
  }
}, CHECK_INTERVAL);

// Data cleanup — every hour (cleans data older than 7 days)
const CLEANUP_INTERVAL = 60 * 60 * 1000;
setInterval(async () => {
  try {
    await cleanOldData();
  } catch (err) {
    console.error("[Worker] Cleanup failed:", err);
  }
}, CLEANUP_INTERVAL);

// Run initial check after 30s
setTimeout(async () => {
  try {
    await checkNodes();
    await syncLineStatus();
    await cleanOldData();
    console.log("[Worker] Initial check complete");
  } catch (err) {
    console.error("[Worker] Initial check failed:", err);
  }
}, 30000);

console.log("[Worker] Worker started");
```

- [ ] **Step 2: Create node checker**

Create `worker/node-checker.js`:

```javascript
// Worker runs in the same container as Next.js but as a separate process.
// It accesses the SQLite database directly.
const Database = require("better-sqlite3");
const path = require("path");

const dbPath =
  process.env.DATABASE_URL?.replace("file:", "") ||
  path.join(__dirname, "../data/wiremesh.db");

function getDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

async function checkNodes() {
  const db = getDb();
  try {
    // Get all nodes that are currently "online"
    const onlineNodes = db
      .prepare("SELECT id, name FROM nodes WHERE status = 'online'")
      .all();

    // In the Worker process, we can't check SSE connections directly
    // (they live in the Next.js process). Instead, we check for recent
    // status reports. If no report in 2x the check interval, mark offline.
    const threshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();

    for (const node of onlineNodes) {
      const recentStatus = db
        .prepare(
          "SELECT id FROM node_status WHERE node_id = ? AND checked_at > ? LIMIT 1"
        )
        .get(node.id, threshold);

      if (!recentStatus) {
        db.prepare(
          "UPDATE nodes SET status = 'offline', updated_at = ? WHERE id = ?"
        ).run(new Date().toISOString(), node.id);
        console.log(`[Worker] Node ${node.name} (${node.id}) marked offline`);
      }
    }
  } finally {
    db.close();
  }
}

module.exports = { checkNodes };
```

- [ ] **Step 3: Create line syncer**

Create `worker/line-syncer.js`:

```javascript
const Database = require("better-sqlite3");
const path = require("path");

const dbPath =
  process.env.DATABASE_URL?.replace("file:", "") ||
  path.join(__dirname, "../data/wiremesh.db");

function getDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

async function syncLineStatus() {
  const db = getDb();
  try {
    const allLines = db.prepare("SELECT id, status FROM lines").all();

    for (const line of allLines) {
      // Get all nodes in this line
      const lineNodeRows = db
        .prepare("SELECT node_id FROM line_nodes WHERE line_id = ?")
        .all(line.id);

      if (lineNodeRows.length === 0) continue;

      // Check if all nodes are online
      const allOnline = lineNodeRows.every((ln) => {
        const node = db
          .prepare("SELECT status FROM nodes WHERE id = ?")
          .get(ln.node_id);
        return node && node.status === "online";
      });

      const newStatus = allOnline ? "active" : "inactive";
      if (newStatus !== line.status) {
        db.prepare(
          "UPDATE lines SET status = ?, updated_at = ? WHERE id = ?"
        ).run(newStatus, new Date().toISOString(), line.id);
      }
    }
  } finally {
    db.close();
  }
}

module.exports = { syncLineStatus };
```

- [ ] **Step 4: Create data cleaner**

Create `worker/data-cleaner.js`:

```javascript
const Database = require("better-sqlite3");
const path = require("path");

const dbPath =
  process.env.DATABASE_URL?.replace("file:", "") ||
  path.join(__dirname, "../data/wiremesh.db");

function getDb() {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  return db;
}

async function cleanOldData() {
  const db = getDb();
  try {
    const threshold = new Date(
      Date.now() - 7 * 24 * 60 * 60 * 1000
    ).toISOString();

    const result = db
      .prepare("DELETE FROM node_status WHERE checked_at < ?")
      .run(threshold);

    if (result.changes > 0) {
      console.log(
        `[Worker] Cleaned ${result.changes} old node_status records`
      );
    }
  } finally {
    db.close();
  }
}

module.exports = { cleanOldData };
```

- [ ] **Step 5: Add worker start script to package.json**

Add to `package.json` scripts:

```json
{
  "scripts": {
    "worker": "node worker/index.js"
  }
}
```

- [ ] **Step 6: Verify worker starts**

```bash
npm run worker
# Should print "[Worker] Starting WireMesh Worker..." and "[Worker] Worker started"
# After 30s: "[Worker] Initial check complete"
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add worker process (node checker, line syncer, data cleaner)"
```

---

## Task 18: Docker Configuration

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`

- [ ] **Step 1: Create Dockerfile**

Create `Dockerfile`:

```dockerfile
FROM node:20-alpine AS base

# Build Agent (placeholder — actual Go build will be added in Agent plan)
# FROM golang:1.22-alpine AS agent-builder
# WORKDIR /agent
# COPY agent/ .
# RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o wiremesh-agent .

# Build Next.js
FROM base AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY worker/ ./worker/

# Agent binary placeholder directory
RUN mkdir -p ./public/agent

EXPOSE 3000

CMD ["sh", "-c", "node worker/index.js & node server.js"]
```

- [ ] **Step 2: Create docker-compose.yml**

Create `docker-compose.yml`:

```yaml
version: '3.8'
services:
  wiremesh:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ./data:/app/data
    environment:
      - DATABASE_URL=file:/app/data/wiremesh.db
      - JWT_SECRET=${JWT_SECRET:-change-me-to-a-random-64-char-string}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY:-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef}
    restart: unless-stopped
```

- [ ] **Step 3: Update next.config.ts for standalone output**

Ensure `next.config.ts` has:

```typescript
const nextConfig = {
  output: "standalone",
};
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: add Docker configuration"
```

---

## Summary

| Task | Description | Estimated Steps |
|------|-------------|-----------------|
| 1 | Project initialization | 8 |
| 2 | Database schema | 6 |
| 3 | Core utility libraries | 21 |
| 4 | Middleware and auth system | 7 |
| 5 | Global layout and auth pages | 10 |
| 6 | Settings and audit logs | 7 |
| 7 | Node CRUD API | 4 |
| 8 | Node management pages | 6 |
| 9 | Device CRUD API and pages | 8 |
| 10 | Line management API | 4 |
| 11 | Line management pages | 5 |
| 12 | Install script and client config | 6 |
| 13 | Filter management | 5 |
| 14 | Dashboard | 4 |
| 15 | SSE manager and Agent APIs | 6 |
| 16 | Node status history | 3 |
| 17 | Worker process | 7 |
| 18 | Docker configuration | 4 |

**Total: 18 tasks, ~121 steps**

**Not covered in this plan (separate plans):**
- Go Agent development (Phase 12)
- End-to-end integration testing (Phase 13)
