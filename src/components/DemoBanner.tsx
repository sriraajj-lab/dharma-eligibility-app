/**
 * Shown inside eligibility/preauth result cards when _demo:true is returned.
 * Makes it clear this is sample data, not a real Availity response.
 */
export function DemoBanner() {
  return (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
      <span className="text-xl shrink-0">🔌</span>
      <div>
        <p className="font-semibold text-amber-800">Demo Mode — Sample Data</p>
        <p className="text-amber-700 text-xs mt-0.5">
          Availity API credentials are not yet connected. Results shown are realistic sample data.{' '}
          <a href="https://developer.availity.com" target="_blank" rel="noopener noreferrer"
            className="underline font-medium hover:text-amber-900">
            Set up Availity →
          </a>
          {' '}then add <code className="bg-amber-100 px-1 rounded">AVAILITY_CLIENT_ID</code> and{' '}
          <code className="bg-amber-100 px-1 rounded">AVAILITY_CLIENT_SECRET</code> as Supabase secrets.
        </p>
      </div>
    </div>
  );
}
