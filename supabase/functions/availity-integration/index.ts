// Supabase Edge Function: availity-integration
// Handles: check_eligibility, submit_preauthorization, check_auth_status
// Availity Sandbox — scope: healthcare-hipaa-transactions-demo

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Validate caller via anon key OR user JWT
    const authHeader = req.headers.get('Authorization') ?? '';
    const callerToken = authHeader.replace('Bearer ', '');
    if (!callerToken) return json({ error: 'Missing authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const supabase    = createClient(supabaseUrl, serviceKey);

    let validToken = (callerToken === anonKey);
    if (!validToken) {
      const { data: { user }, error } = await supabase.auth.getUser(callerToken);
      validToken = !error && !!user;
    }
    if (!validToken) return json({ error: 'Invalid or expired session.' }, 401);

    // ── Availity credentials ──────────────────────────────────────
    const AVAILITY_CLIENT_ID     = Deno.env.get('AVAILITY_CLIENT_ID')     ?? 'ad76f0c6-093b-4a7d-9a04-6dd29d13a6e3';
    const AVAILITY_CLIENT_SECRET = Deno.env.get('AVAILITY_CLIENT_SECRET') ?? 'cUCs3YDS50jgYPviiqNogGddHPASs4F2V_c34iAcujOtzrMw98cR_15SAyDIppre4tRTCKPrDlOLX5uB4Z04Q';
    const AVAILITY_SCOPE         = Deno.env.get('AVAILITY_SCOPE')         ?? 'healthcare-hipaa-transactions-demo';
    const AVAILITY_ORG_ID        = Deno.env.get('AVAILITY_ORG_ID') ?? '';
    const useMock = !AVAILITY_CLIENT_ID || !AVAILITY_CLIENT_SECRET;

    const body   = await req.json() as Record<string, unknown>;
    const action = String(body.action ?? '');

    // ── check_eligibility ────────────────────────────────────────
    if (action === 'check_eligibility') {
      const { memberId, groupNumber, firstName, lastName, dateOfBirth, carrierCode } = body as Record<string, string>;
      if (!memberId || !firstName || !lastName || !dateOfBirth || !carrierCode)
        return json({ error: 'Missing required fields: memberId, firstName, lastName, dateOfBirth, carrierCode' }, 400);

      if (useMock) return json(mockEligibility(firstName, lastName, memberId, carrierCode, groupNumber));

      try {
        const tok = await getAvailityToken(AVAILITY_CLIENT_ID!, AVAILITY_CLIENT_SECRET!, AVAILITY_SCOPE);
        const result = await checkAvailityEligibility(tok, AVAILITY_ORG_ID, { memberId, groupNumber, firstName, lastName, dateOfBirth, carrierCode });
        return json(result);
      } catch (e: unknown) {
        console.error('Eligibility error:', e);
        // Fallback to mock on API error so UI never fully breaks
        const mock = mockEligibility(firstName, lastName, memberId, carrierCode, groupNumber);
        mock._api_error = e instanceof Error ? e.message : String(e);
        return json(mock);
      }
    }

    // ── submit_preauthorization ───────────────────────────────────
    if (action === 'submit_preauthorization') {
      const p = body as Record<string, string>;
      if (!p.memberId || !p.firstName || !p.lastName || !p.dateOfBirth || !p.carrierCode || !p.procedureCode)
        return json({ error: 'Missing required fields for preauthorization' }, 400);

      if (useMock) return json(mockPreauth(p.firstName, p.lastName, p.memberId, p.carrierCode, p.procedureCode, p.procedureDesc));

      try {
        const tok = await getAvailityToken(AVAILITY_CLIENT_ID!, AVAILITY_CLIENT_SECRET!, AVAILITY_SCOPE);
        const result = await submitAvailityPreauth(tok, AVAILITY_ORG_ID, p);
        return json(result);
      } catch (e: unknown) {
        console.error('Preauth error:', e);
        const mock = mockPreauth(p.firstName, p.lastName, p.memberId, p.carrierCode, p.procedureCode, p.procedureDesc);
        mock._api_error = e instanceof Error ? e.message : String(e);
        return json(mock);
      }
    }

    // ── check_auth_status ────────────────────────────────────────
    if (action === 'check_auth_status') {
      const { authorizationId, carrierCode } = body as Record<string, string>;
      if (!authorizationId) return json({ error: 'authorizationId is required' }, 400);

      if (useMock) {
        const opts = ['pending', 'approved', 'approved', 'approved'] as const;
        const st   = opts[Math.floor(Math.random() * opts.length)];
        return json({ status: st, authorizationId, message: `Status refreshed — ${st}`, _mock: true });
      }

      try {
        const tok = await getAvailityToken(AVAILITY_CLIENT_ID!, AVAILITY_CLIENT_SECRET!, AVAILITY_SCOPE);
        const result = await getAvailityAuthStatus(tok, AVAILITY_ORG_ID, authorizationId, carrierCode);
        return json(result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return json({ error: msg }, 502);
      }
    }

    return json({ error: `Unknown action "${action}". Valid: check_eligibility, submit_preauthorization, check_auth_status` }, 400);

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error('Edge function error:', msg);
    return json({ error: msg }, 500);
  }
});

// ── Helpers ───────────────────────────────────────────────────────
function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ── Availity OAuth 2.0 token ──────────────────────────────────────
async function getAvailityToken(clientId: string, clientSecret: string, scope: string): Promise<string> {
  const resp = await fetch('https://api.availity.com/availity/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      // Availity requires HTTP Basic auth with client credentials
      'Authorization': 'Basic ' + btoa(`${clientId}:${clientSecret}`),
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Availity token error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const d = await resp.json() as { access_token?: string; error?: string };
  if (!d.access_token) throw new Error(`No access_token in Availity response: ${JSON.stringify(d)}`);
  return d.access_token;
}

// ── Eligibility (270/271 — /coverages) ───────────────────────────
async function checkAvailityEligibility(token: string, orgId: string, p: Record<string, string>) {
  // Availity uses /coverages for real-time eligibility (ASC X12 270/271)
  const params = new URLSearchParams({
    payerId:         p.carrierCode,
    memberId:        p.memberId,
    firstName:       p.firstName,
    lastName:        p.lastName,
    dateOfBirth:     p.dateOfBirth,           // YYYY-MM-DD
    serviceTypeCode: '35',                    // 35 = dental care
  });
  if (p.groupNumber) params.append('groupNumber', p.groupNumber);

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };
  if (orgId) headers['av-organization-id'] = orgId;

  const resp = await fetch(`https://api.availity.com/availity/v1/coverages?${params}`, { headers });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Availity eligibility ${resp.status}: ${text.slice(0, 300)}`);
  }
  const raw = await resp.json() as Record<string, unknown>;
  return normalizeEligibilityResponse(raw, p);
}

function normalizeEligibilityResponse(raw: Record<string, unknown>, p: Record<string, string>): Record<string, unknown> {
  // Availity returns nested coverage object — flatten for our UI
  const coverages = (raw.coverages as Record<string, unknown>[]) ?? [];
  const first = coverages[0] ?? {};
  const subscriber = (first.subscriber ?? raw.subscriber ?? {}) as Record<string, unknown>;
  const benefits = (first.benefitInformation ?? []) as Record<string, unknown>[];

  // Find deductible / max benefit amounts
  function findBenefit(code: string, qualifier: string) {
    return benefits.find((b: Record<string, unknown>) => b.benefitCode === code && b.qualifier === qualifier);
  }
  const dedInd  = (findBenefit('C', 'IND') as Record<string, unknown> | undefined)?.benefitAmount;
  const dedFam  = (findBenefit('C', 'FAM') as Record<string, unknown> | undefined)?.benefitAmount;
  const maxInd  = (findBenefit('B', 'IND') as Record<string, unknown> | undefined)?.benefitAmount;

  return {
    _live: true,
    status: first.coverageStatus ?? (raw.coverageStatus as string) ?? 'Unknown',
    coverageStatus: first.coverageStatus ?? 'Unknown',
    planName: (first.insurancePolicyName ?? raw.planName ?? `${p.carrierCode} Dental`) as string,
    groupName: (first.group ?? p.groupNumber ?? '') as string,
    planBeginDate: (first.benefitPeriodBeginDate ?? '') as string,
    planEndDate: (first.benefitPeriodEndDate ?? '') as string,
    memberId: p.memberId,
    groupNumber: p.groupNumber,
    networkStatus: (first.planNetworkIndicator ?? 'Unknown') as string,
    deductibleIndividual: dedInd ?? null,
    deductibleFamily: dedFam ?? null,
    annualMaximum: maxInd ?? null,
    coverages: raw,   // full raw response available for debugging
    subscriber: subscriber,
  };
}

// ── Preauth (278) — /prior-auth-requests ─────────────────────────
async function submitAvailityPreauth(token: string, orgId: string, p: Record<string, string>) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  if (orgId) headers['av-organization-id'] = orgId;

  const body = {
    payerId: p.carrierCode,
    serviceType: 'dental',
    subscriber: {
      memberId:    p.memberId,
      firstName:   p.firstName,
      lastName:    p.lastName,
      dateOfBirth: p.dateOfBirth,
      groupNumber: p.groupNumber ?? '',
    },
    serviceLines: [{
      procedureCode:   p.procedureCode,
      description:     p.procedureDesc ?? '',
      toothNumber:     p.toothNumber ?? '',
      quantity:        '1',
      estimatedAmount: p.estimatedCost ?? '',
    }],
  };

  const resp = await fetch('https://api.availity.com/availity/v1/prior-auth-requests', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Availity preauth ${resp.status}: ${text.slice(0, 300)}`);
  }
  const raw = await resp.json() as Record<string, unknown>;
  return normalizePreauthResponse(raw, p);
}

function normalizePreauthResponse(raw: Record<string, unknown>, p: Record<string, string>): Record<string, unknown> {
  return {
    _live: true,
    status: (raw.authorizationStatus ?? raw.status ?? 'pending') as string,
    authorizationStatus: (raw.authorizationStatus ?? 'pending') as string,
    authorizationNumber: (raw.authorizationNumber ?? raw.referenceNumber ?? '') as string,
    referenceNumber: (raw.referenceNumber ?? '') as string,
    message: (raw.message ?? `Preauthorization submitted for ${p.firstName} ${p.lastName}`) as string,
    procedureCode: p.procedureCode,
    approvedAmount: (raw.approvedAmount ?? '') as string,
    validFrom: (raw.effectiveDate ?? new Date().toISOString().slice(0, 10)) as string,
    validTo: (raw.expirationDate ?? '') as string,
    raw,
  };
}

// ── Auth status ───────────────────────────────────────────────────
async function getAvailityAuthStatus(token: string, orgId: string, authId: string, carrierId: string) {
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/json',
  };
  if (orgId) headers['av-organization-id'] = orgId;

  const params = new URLSearchParams({ payerId: carrierId ?? '' });
  const resp = await fetch(
    `https://api.availity.com/availity/v1/prior-auth-requests/${authId}?${params}`,
    { headers }
  );
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Availity auth status ${resp.status}: ${text.slice(0, 300)}`);
  }
  const raw = await resp.json() as Record<string, unknown>;
  return {
    _live: true,
    status: (raw.authorizationStatus ?? raw.status ?? 'pending') as string,
    authorizationId: authId,
    authorizationNumber: (raw.authorizationNumber ?? authId) as string,
    message: (raw.message ?? '') as string,
    raw,
  };
}

// ── Mock data (fallback when creds absent) ────────────────────────
function mockEligibility(first: string, last: string, memberId: string, carrier: string, group: string): Record<string, unknown> {
  const seed = memberId.charCodeAt(0) + (first.charCodeAt(0) || 0);
  const ded  = [500, 1000, 1500, 2000][seed % 4];
  const max  = [1000, 1500, 2000, 3000][seed % 4];
  const used = Math.floor(ded * 0.4);
  return {
    _mock: true,
    _note: 'Demo data — Availity credentials loaded but API returned an error. See _api_error for details.',
    status: 'Active', coverageStatus: 'Active',
    planName: `${carrier} Dental PPO`,
    groupName: group ?? '',
    planBeginDate: '2025-01-01',
    memberId, groupNumber: group,
    networkStatus: 'In-Network',
    deductibleIndividual: ded, deductibleFamily: ded * 2, deductibleRemaining: ded - used,
    annualMaximum: max, annualMaximumRemaining: max - Math.floor(used * 0.5),
    coverages: {
      preventive: { coveragePercent: 100 },
      basic:      { coveragePercent: 80  },
      major:      { coveragePercent: 50, waiting_period: '6 months' },
      orthodontic:{ coveragePercent: 50, lifetimeMax: 1500 },
    },
    subscriber: { firstName: first, lastName: last, memberId },
  };
}

function mockPreauth(first: string, last: string, memberId: string, carrier: string, code: string, desc: string): Record<string, unknown> {
  const authNum = `AUTH-${Date.now().toString(36).toUpperCase()}-${Math.floor(Math.random()*9000+1000)}`;
  return {
    _mock: true,
    _note: 'Demo data — Availity credentials loaded but API returned an error. See _api_error for details.',
    status: 'approved', authorizationStatus: 'approved',
    authorizationNumber: authNum, referenceNumber: authNum,
    message: `Preauthorization approved for ${first} ${last} — ${code}`,
    procedureCode: code, procedureDescription: desc,
    approvedAmount: '850.00', carrier, memberId,
    validFrom: new Date().toISOString().slice(0, 10),
    validTo:   new Date(Date.now() + 90*24*60*60*1000).toISOString().slice(0, 10),
  };
}
