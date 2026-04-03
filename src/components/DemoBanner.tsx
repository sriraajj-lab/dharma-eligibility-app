/**
 * Shown when result._mock is true (API error fallback).
 * Hidden when result._live is true (real Availity response).
 */

interface Props {
  apiError?: string;
}

export function DemoBanner({ apiError }: Props) {
  return (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
      <span className="text-xl shrink-0">⚠️</span>
      <div>
        <p className="font-semibold text-amber-800">Availity API Error — Showing Sample Data</p>
        <p className="text-amber-700 text-xs mt-0.5">
          Credentials are configured but the Availity API returned an error.
          {apiError && (
            <span className="block mt-1 font-mono bg-amber-100 rounded px-1.5 py-0.5 text-amber-900 break-all">
              {apiError}
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export function LiveBanner() {
  return (
    <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-sm">
      <span className="text-base">✅</span>
      <p className="text-emerald-800 font-medium text-xs">
        Live Availity data — real-time eligibility from the payer
      </p>
    </div>
  );
}
