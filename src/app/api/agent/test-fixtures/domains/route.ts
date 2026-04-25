// E2E test fixture — returns a stable, tiny list of test-only domains
// for the e2e-test skill's Phase 8f (sourceUrl + reload regression).
// The endpoint sits under /api/agent/* so it bypasses auth (see proxy.ts),
// matching what real Agents need: a public URL they can fetch without
// credentials. The domains here are reserved (.example) so they will
// never resolve in real DNS, which is fine — the test only verifies
// that the rules round-trip through the DNS matcher's external map.
export async function GET() {
  const body = "test-domain-a.example\ntest-domain-b.example\ntest-domain-c.example\n";
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain" },
  });
}
