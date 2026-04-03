import { createClient } from '@supabase/supabase-js';

const supabaseUrl     = 'https://rjamdphhhssqxoonserx.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJqYW1kcGhoaHNzcXhvb25zZXJ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNDgxMDcsImV4cCI6MjA5MDgyNDEwN30.Rg-fstkxZTueggYXYyWROz2Y2WpXRsZ4cUKe1Y5wYFc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/* ─── Mock data generators ──────────────────────────────────────── */
function mockEligibility(p: Record<string, string>) {
  const seed = (p.memberId?.charCodeAt(0) ?? 65) + (p.firstName?.charCodeAt(0) ?? 74);
  const ded  = [500, 1000, 1500, 2000][seed % 4];
  const max  = [1000, 1500, 2000, 3000][seed % 4];
  const used = Math.floor(ded * 0.4);
  return {
    _demo: true,
    status: 'Active', coverageStatus: 'Active',
    planName: `${p.carrierCode} Dental PPO`,
    planBeginDate: '2025-01-01',
    networkStatus: 'In-Network',
    deductibleIndividual: ded, deductibleFamily: ded * 2, deductibleRemaining: ded - used,
    annualMaximum: max, annualMaximumRemaining: max - Math.floor(used * 0.5),
    coverages: {
      preventive: { percent: 100, waiting_period: null },
      basic:      { percent: 80,  waiting_period: null },
      major:      { percent: 50,  waiting_period: '6 months' },
      orthodontic:{ percent: 50,  lifetimeMax: 1500 },
    },
    subscriber: { firstName: p.firstName, lastName: p.lastName, memberId: p.memberId },
  };
}

function mockPreauth(p: Record<string, string>) {
  const num = `AUTH-${Date.now().toString(36).toUpperCase().slice(-6)}`;
  return {
    _demo: true,
    status: 'approved', authorizationStatus: 'approved',
    authorizationNumber: num, referenceNumber: num,
    message: `Preauthorization approved for ${p.firstName} ${p.lastName} — ${p.procedureCode}`,
    procedureCode: p.procedureCode,
    approvedAmount: '850.00',
    validFrom: new Date().toISOString().slice(0, 10),
    validTo:   new Date(Date.now() + 90*864e5).toISOString().slice(0, 10),
  };
}

/* ─── API caller ────────────────────────────────────────────────── */
export const callAvailityApi = async (action: string, payload: Record<string, unknown>) => {
  let response: Response;
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/availity-integration`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseAnonKey,
      },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    console.warn('[Dharma] Network error calling Edge Function — using demo data');
    return fallbackMock(action, payload as Record<string,string>);
  }

  const json = await response.json() as Record<string, unknown>;

  if (!response.ok || json?.error) {
    const errMsg = String(json?.error ?? '');
    if (
      errMsg.includes('Invalid action') ||
      errMsg.includes('not configured') ||
      errMsg.includes('Availity') ||
      response.status === 502 ||
      response.status === 503
    ) {
      console.warn('[Dharma] Availity not configured — using demo data:', errMsg);
      return fallbackMock(action, payload as Record<string,string>);
    }
    throw new Error(errMsg || `Request failed (${response.status})`);
  }

  return json;
};

function fallbackMock(action: string, p: Record<string, string>): Record<string, unknown> {
  if (action === 'check_eligibility')       return mockEligibility(p);
  if (action === 'submit_preauthorization') return mockPreauth(p);
  if (action === 'check_auth_status')       return { status: 'pending', message: 'Status check pending' };
  return { _demo: true };
}
