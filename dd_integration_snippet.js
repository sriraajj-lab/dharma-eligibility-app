/**
 * DenialsDoctor <-> Eligibility Service Integration
 * File: src/brain/agents.js — add inside scrubber.handle, BEFORE scrubClaim()
 *
 * Required env vars in DD:
 *   ELIGIBILITY_API_URL=https://eligibility.denialsdoctor.com
 *   ELIGIBILITY_API_KEY=<same key as ELIGIBILITY_DD_API_KEY on the service>
 */

// ── Step 1: Add this helper near the top of agents.js ────────────────────────
async function checkEligibility(claim) {
  const url = process.env.ELIGIBILITY_API_URL;
  const key = process.env.ELIGIBILITY_API_KEY;
  if (!url || !key) {
    console.warn("[eligibility] env vars not set — skipping check");
    return null;
  }
  const payload = {
    first_name: claim.patientFirstName || claim.patient?.firstName || "",
    last_name:  claim.patientLastName  || claim.patient?.lastName  || "",
    dob:        claim.patientDOB       || claim.patient?.dob       || "",
    gender:     claim.patientGender    || claim.patient?.gender    || "",
    state:      claim.patientState     || claim.patient?.state     || "",
    coverages: (claim.insurances || claim.coverages || []).map((ins) => ({
      payer_name:     ins.payerName     || ins.payer_name     || "",
      member_id:      ins.memberId      || ins.member_id      || "",
      group_number:   ins.groupNumber   || ins.group_number   || "",
      plan_type:      ins.planType      || ins.plan_type      || "medical",
      subscriber_dob: ins.subscriberDOB || ins.subscriber_dob || "",
    })),
  };
  const resp = await fetch(`${url}/api/resolve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": key,
      "X-Request-ID": claim.caseId || crypto.randomUUID(),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) {
    console.error(`[eligibility] API error ${resp.status}: ${await resp.text()}`);
    return null; // Non-blocking — don't fail the whole scrub
  }
  return resp.json();
}

// ── Step 2: Add this block inside scrubber.handle(), BEFORE scrubClaim() ─────
async function scrubberEligibilityBlock(c, result) {
  const elig = await checkEligibility(c);
  if (elig) {
    c.eligibility = elig; // Attach snapshot to case for storage

    // Merge denial prevention flags into DD findings
    (elig.denial_prevention || []).forEach((flag) => {
      result.findings.push({
        severity: "error",
        code:     flag.code,
        message:  flag.description,
        source:   "eligibility-service",
      });
    });

    // Hard stop: no active coverage → hold the claim
    if (!elig.primary_payer) {
      result.findings.push({
        severity: "critical",
        code:     "CO-27",
        message:  "No active coverage found. Claim held — verify insurance before submitting.",
        source:   "eligibility-service",
      });
      result.hold = true;
    }

    if (elig.primary_payer) {
      console.info(`[eligibility] case=${c.caseId} primary=${elig.primary_payer}` +
        (elig.secondary_payer ? ` secondary=${elig.secondary_payer}` : ""));
    }
  }
  // ... existing scrubClaim() call continues here ...
}

// ── Step 3: Persist eligibility snapshot in CaseFile ─────────────────────────
// Add to your CaseFile schema:
//   eligibility: { primary_payer, secondary_payer, active_medical, denial_prevention, resolved_at }
//
// After scrubbing:
//   if (c.eligibility) {
//     c.eligibility.resolved_at = new Date();
//     await CaseFile.updateOne({ _id: c._id }, { $set: { eligibility: c.eligibility } });
//   }
