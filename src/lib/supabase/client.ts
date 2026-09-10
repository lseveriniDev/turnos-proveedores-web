import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

let cliente: SupabaseClient | null = null;

export const supabaseConfigurado = Boolean(url && key);

export function obtenerSupabase(): SupabaseClient | null {
  if (!url || !key) return null;
  if (!cliente) cliente = createClient(url, key);
  return cliente;
}
