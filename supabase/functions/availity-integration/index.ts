// Supabase Edge Function: availity-integration
// Handles: check_eligibility, submit_preauthorization, check_auth_status
// Availity Sandbox — scope: healthcare-hipaa-transactions-demo

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-user-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// ── Mock data helpers ─────────────────────────────────────────────────────────
function mockEligibility(firstName: string, lastName: string, memberId: string, carrierCode: string, groupNumber?: string) {
  return {
    _demo: true,
    status: 'active',
    memberId,
    groupNumber: groupNumber || 'GRP-001',
    firstName,
    lastName,
    dateOfBirth: '1985-03-15',
    carrier: carrierCode,
    planName: 'Blue Choice PPO',
    planType: 'PPO',
    effectiveDate: '2024-01-01',
    termDate: '2024-12-31',
    deductible: { individual: 1500, family: 3000, met: 450, remaining: 1050 },
    outOfPocket: { individual: 4000, family: 8000, met: 900, remaining: 3100 },
    copay: { primaryCare: 25, specialist: 50, urgentCare: 75, emergencyRoom: 250 },
    coinsurance: 20,
    coverages: [
      { serviceType: 'Preventive Care', covered: true, copay: 0, coinsurance: 0, notes: 'Covered at 100%' },
      { serviceType: 'Primary Care', covered: true, copay: 25, coinsurance: 0 },
      { serviceType: 'Specialist', covered: true, copay: 50, coinsurance: 0 },
      { serviceType: 'Mental Health', covered: true, copay: 50, coinsurance: 0 },
      { serviceType: 'Physical Therapy', covered: true, copay: 0, coinsurance: 20, notes: '30 visits/year' },
      { serviceType: 'Chiropractic', covered: true, copay: 0, coinsurance: 20, notes: '20 visits/year' },
      { serviceType: 'Dental', covered: false, notes: 'Not covered under medical plan' },
      { serviceType: 'Vision', covered: true, copay: 0, coinsurance: 20, notes: 'Annual exam covered' },
    ],
    lastVerified: new Date().toISOString(),
  };
}

function mockPreauth(memberId: string, procedureCode: string, diagnosisCode: string) {
  const authNumber = `AUTH-${Date.now().toString(36).toUpperCase()}`;
  return {
    _demo: true,
    authorizationNumber: authNumber,
    status: 'pending',
    memberId,
    procedureCode,
    diagnosisCode,
    submittedAt: new Date().toISOString(),
    estimatedDecision: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    message: 'Prior authorization request submitted. Expected decision within 2 business days.',
  };
}

function mockAuthStatus(authNumber: string) {
  return {
    _demo: true,
    authorizationNumber: authNumber,
    status: 'approved',
    approvedUnits: 10,
    approvedFrom: new Date().toISOString(),
    approvedThrough: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    notes: 'Approved for 10 visits',
    lastUpdated: new Date().toISOString(),
  };
}

// ── Availity OAuth2 token helper ──────────────────────────────────────────────
async function getAvailityToken(clientId: string, clientSecret: string, scope: string): Promise<string> {
  const resp = await fetch('https://api.availity.com/availity/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Availity token error ${resp.status}: ${text}`);
  }
  const data = await resp.json() as { access_token: string };
  return data.access_token;
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── Availity credentials ──────────────────────────────────────
    const AVAILITY_CLIENT_ID     = Deno.env.get('AVAILITY_CLIENT_ID')     ?? 'ad76f0c6-093b-4a7d-9a04-6dd29d13a6e3';
    const AVAILITY_CLIENT_SECRET = Deno.env.get('AVAILITY_CLIENT_SECRET') ?? 'cUCs3YDS50jgYPviiqNogGddHPASs4F2V_c34iAcujOtzrMw98cR_15SAyDIppre4tRTCKPrDlOLX5uB4Z04Q';
    const AVAILITY_SCOPE         = Deno.env.get('AVAILITY_SCOPE')         ?? 'healthcare-hipaa-transactions-demo';
    const AVAILITY_ORG_ID        = Deno.env.get('AVAILITY_ORG_ID')        ?? '';
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
        const token = await getAvailityToken(AVAILITY_CLIENT_ID, AVAILITY_CLIENT_SECRET, AVAILITY_SCOPE);
        const params = new URLSearchParams({
          memberId,
          firstName,
          lastName,
          dateOfBirth,
          serviceTypeCode: '30', // Health Benefit Plan Coverage
          ...(groupNumber ? { groupNumber } : {}),
          ...(AVAILITY_ORG_ID ? { npi: AVAILITY_ORG_ID } : {}),
        });
        const eligResp = await fetch(
          `https://api.availity.com/availity/v1/eligibility-and-benefits?${params}`,
          { headers: { Authorization: `Bearer ${token}`, 'av-client-id': AVAILITY_CLIENT_ID } }
        );
        if (!eligResp.ok) {
          const errText = await eligResp.text();
          console.error('Availity eligibility error:', eligResp.status, errText);
          return json(mockEligibility(firstName, lastName, memberId, carrierCode, groupNumber));
        }
        const data = await eligResp.json();
        return json(data);
      } catch (err) {
        console.error('Availity error, falling back to mock:', err);
        return json(mockEligibility(firstName, lastName, memberId, carrierCode, groupNumber));
      }
    }

    // ── submit_preauthorization ──────────────────────────────────
    if (action === 'submit_preauthorization') {
      const { memberId, procedureCode, diagnosisCode, providerId, facilityId, clinicalNotes } = body as Record<string, string>;
      if (!memberId || !procedureCode || !diagnosisCode)
        return json({ error: 'Missing required fields: memberId, procedureCode, diagnosisCode' }, 400);

      if (useMock) return json(mockPreauth(memberId, procedureCode, diagnosisCode));

      try {
        const token = await getAvailityToken(AVAILITY_CLIENT_ID, AVAILITY_CLIENT_SECRET, AVAILITY_SCOPE);
        const preauthResp = await fetch('https://api.availity.com/availity/v1/prior-authorization-requests', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'av-client-id': AVAILITY_CLIENT_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ memberId, procedureCode, diagnosisCode, providerId, facilityId, clinicalNotes }),
        });
        if (!preauthResp.ok) {
          console.error('Availity preauth error:', preauthResp.status);
          return json(mockPreauth(memberId, procedureCode, diagnosisCode));
        }
        return json(await preauthResp.json());
      } catch (err) {
        console.error('Availity preauth error, falling back to mock:', err);
        return json(mockPreauth(memberId, procedureCode, diagnosisCode));
      }
    }

    // ── check_auth_status ────────────────────────────────────────
    if (action === 'check_auth_status') {
      const { authorizationNumber } = body as Record<string, string>;
      if (!authorizationNumber)
        return json({ error: 'Missing required field: authorizationNumber' }, 400);

      if (useMock) return json(mockAuthStatus(authorizationNumber));

      try {
        const token = await getAvailityToken(AVAILITY_CLIENT_ID, AVAILITY_CLIENT_SECRET, AVAILITY_SCOPE);
        const statusResp = await fetch(
          `https://api.availity.com/availity/v1/prior-authorization-requests/${authorizationNumber}`,
          { headers: { Authorization: `Bearer ${token}`, 'av-client-id': AVAILITY_CLIENT_ID } }
        );
        if (!statusResp.ok) {
          console.error('Availity status error:', statusResp.status);
          return json(mockAuthStatus(authorizationNumber));
        }
        return json(await statusResp.json());
      } catch (err) {
        console.error('Availity status error, falling back to mock:', err);
        return json(mockAuthStatus(authorizationNumber));
      }
    }

    return json({ error: 'Invalid action. Use: check_eligibility, submit_preauthorization, check_auth_status' }, 400);

  } catch (err) {
    console.error('Edge function error:', err);
    return json({ error: 'Internal server error', details: String(err) }, 500);
  }
});
