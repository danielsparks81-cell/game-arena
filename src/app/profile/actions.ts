'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { isValidAccent } from '@/lib/accentColors';

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/;

export async function updateAccentColor(color: string): Promise<{ ok: boolean; error?: string }> {
  if (!isValidAccent(color)) {
    return { ok: false, error: 'Invalid color.' };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };
  const { error } = await supabase
    .from('profiles')
    .update({ accent_color: color })
    .eq('id', user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/profile');
  revalidatePath('/lobby');
  return { ok: true };
}

export async function updateUsername(formData: FormData): Promise<{ ok: boolean; error?: string }> {
  const raw = String(formData.get('username') || '').trim();
  if (!USERNAME_RE.test(raw)) {
    return { ok: false, error: 'Username must be 3–20 characters: letters, digits, underscore, or hyphen.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'Not signed in.' };

  // Pre-check uniqueness (case-insensitive) so we can return a clean message.
  const { data: clash } = await supabase
    .from('profiles')
    .select('id')
    .ilike('username', raw)
    .neq('id', user.id)
    .maybeSingle();
  if (clash) return { ok: false, error: 'That username is already taken.' };

  const { error } = await supabase
    .from('profiles')
    .update({ username: raw })
    .eq('id', user.id);
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'That username is already taken.' };
    return { ok: false, error: error.message };
  }

  revalidatePath('/profile');
  revalidatePath('/lobby');
  return { ok: true };
}
