// Supabase Edge Function: connect-telegram
// Two modes:
//   - generate: web client requests a one-time link code
//   - verify:   bot service redeems a code and links the chat ID

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_SHARED_SECRET = Deno.env.get("BOT_SHARED_SECRET")!;

const CODE_TTL_SECONDS = 600;

serve(async (req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");

  if (mode === "generate") return handleGenerate(req);
  if (mode === "verify") return handleVerify(req);
  return json({ error: "unknown_mode" }, 400);
});

async function handleGenerate(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "unauthorized" }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { authorization: authHeader } },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: "unauthorized" }, 401);

  const code = generateCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000)
    .toISOString();

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { error } = await admin.from("telegram_link_codes").insert({
    code,
    user_id: user.id,
    expires_at: expiresAt,
    consumed: false,
  });
  if (error) throw error;

  return json({
    code,
    deepLink: `https://t.me/dgnterminalbot?start=${code}`,
    expiresAt,
  });
}

async function handleVerify(req: Request) {
  // Bot service caller — uses shared secret, not user JWT
  if (req.headers.get("x-bot-secret") !== BOT_SHARED_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const { code, telegramChatId } = await req.json();

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: row } = await admin
    .from("telegram_link_codes")
    .select("*")
    .eq("code", code)
    .single();

  if (!row) return json({ error: "invalid_code" }, 400);
  if (row.consumed) return json({ error: "code_already_used" }, 400);
  if (new Date(row.expires_at) < new Date()) {
    return json({ error: "code_expired" }, 400);
  }

  // Link account
  await admin.from("telegram_links").upsert({
    user_id: row.user_id,
    telegram_chat_id: telegramChatId,
    linked_at: new Date().toISOString(),
  });

  await admin
    .from("telegram_link_codes")
    .update({ consumed: true })
    .eq("code", code);

  return json({ status: "ok", userId: row.user_id });
}

function generateCode(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36)).join("").slice(0, 10);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
