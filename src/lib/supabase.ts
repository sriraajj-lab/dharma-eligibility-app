import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://slkcjzqlupdoocxficug.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNsa2NqenFsdXBkb29jeGZpY3VnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUwNDkyNzksImV4cCI6MjA5MDYyNTI3OX0.Yrklj2y3hxQNsM7d8kKs2Anh_Onhx623C8-BfIvxU50';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export const callAvailityApi = async (action: string, payload: Record<string, unknown>) => {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('You must be logged in to use this feature.');

  const response = await fetch(`${supabaseUrl}/functions/v1/availity-integration`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ action, ...payload }),
  });

  const json = await response.json();
  if (!response.ok) {
    const msg = json?.error ?? json?.message ?? `API error ${response.status}`;
    throw new Error(msg);
  }
  return json;
};
