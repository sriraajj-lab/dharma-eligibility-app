import { useState, useEffect } from 'react';
import { ShieldCheck, Loader2, AlertCircle, CheckCircle, User, DollarSign, Percent, Calendar, Award, Info, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase, callAvailityApi } from '../lib/supabase';
import type { Patient, DentalPlan } from '../types';

export function Eligibility() {
  const [patients, setPatients]       = useState<Patient[]>([]);
  const [selectedId, setSelectedId]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [fetching, setFetching]       = useState(true);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState<Record<string, unknown> | null>(null);
  const [showRaw, setShowRaw]         = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('patients')
        .select('*, insurance_company:insurance_companies(*), dental_plan:dental_plans(*)')
        .order('last_name');
      setPatients(data ?? []);
      setFetching(false);
    })();
  }, []);

  const patient   = patients.find(p => p.id === selectedId) ?? null;
  const plan      = patient?.dental_plan as DentalPlan | null ?? null;
  const company   = patient?.insurance_company;

  const handleCheck = async () => {
    if (!patient) return;
    if (!company?.availity_carrier_id) { setError('This patient\'s insurance company has no Availity Carrier ID set.'); return; }

    setLoading(true); setError(''); setResult(null);
    try {
      const data = await callAvailityApi('check_eligibility', {
        memberId:      patient.member_id,
        groupNumber:   patient.group_number ?? '',
        firstName:     patient.first_name,
        lastName:      patient.last_name,
        dateOfBirth:   patient.date_of_birth,
        carrierCode:   company.availity_carrier_id,   // ✅ Fixed: carrier code not UUID
      });
      setResult(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eligibility check failed');
    }
    setLoading(false);
  };

  const fmt$ = (v?: number) => v != null ? `$${v.toLocaleString()}` : '—';
  const fmtPct = (v?: number) => v != null ? `${v}%` : '—';

  return (
    <div className="space-y-5">
      {/* Patient Selector */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-blue-600"/> Select Patient
        </h3>
        {fetching ? (
          <div className="flex items-center gap-2 text-gray-500 text-sm"><Loader2 className="w-4 h-4 animate-spin"/>Loading patients…</div>
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setResult(null); setError(''); }}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
              <option value="">— Choose a patient —</option>
              {patients.map(p => (
                <option key={p.id} value={p.id}>
                  {p.last_name}, {p.first_name} — Member ID: {p.member_id}
                </option>
              ))}
            </select>
            <button onClick={handleCheck} disabled={!selectedId || loading}
              className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
              {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4"/>}
              {loading ? 'Checking…' : 'Check Eligibility'}
            </button>
          </div>
        )}

        {/* Patient + Plan Summary Card */}
        {patient && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Patient info */}
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Patient Details</p>
              <p className="font-semibold text-gray-900">{patient.first_name} {patient.last_name}</p>
              <p className="text-sm text-gray-600 mt-1">DOB: {new Date(patient.date_of_birth).toLocaleDateString()}</p>
              <p className="text-sm text-gray-600">Member ID: <span className="font-mono font-medium">{patient.member_id}</span></p>
              {patient.group_number && <p className="text-sm text-gray-600">Group #: <span className="font-mono font-medium">{patient.group_number}</span></p>}
              <p className="text-sm text-gray-600 mt-1">
                Insurer: <span className="font-medium">{company?.name ?? '—'}</span>
                {company?.availity_carrier_id && <span className="ml-1 text-xs text-blue-600 font-mono">({company.availity_carrier_id})</span>}
              </p>
            </div>

            {/* Dental Plan fields — shown here so user understands what their plan covers */}
            <div className="bg-blue-50 rounded-lg p-4 border border-blue-100">
              <p className="text-xs font-semibold text-blue-400 uppercase tracking-wide mb-2 flex items-center gap-1">
                <Award className="w-3 h-3"/> Dental Plan on File
              </p>
              {plan ? (
                <div className="space-y-1.5">
                  <p className="font-semibold text-gray-900">{plan.plan_name}</p>
                  <p className="text-xs text-gray-500">Plan ID: <span className="font-mono">{plan.plan_id}</span> · {plan.coverage_type}</p>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <DollarSign className="w-3.5 h-3.5 text-orange-500"/>
                      <span className="text-xs text-gray-500">Deductible:</span>
                      <span className="font-semibold">{fmt$(plan.deductible)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <DollarSign className="w-3.5 h-3.5 text-green-500"/>
                      <span className="text-xs text-gray-500">Annual Max:</span>
                      <span className="font-semibold">{fmt$(plan.annual_max)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <Percent className="w-3.5 h-3.5 text-blue-500"/>
                      <span className="text-xs text-gray-500">Preventive:</span>
                      <span className="font-semibold text-green-700">{fmtPct(plan.preventive_coverage)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-700">
                      <Percent className="w-3.5 h-3.5 text-blue-500"/>
                      <span className="text-xs text-gray-500">Basic:</span>
                      <span className="font-semibold text-yellow-700">{fmtPct(plan.basic_coverage)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-gray-700 col-span-2">
                      <Percent className="w-3.5 h-3.5 text-blue-500"/>
                      <span className="text-xs text-gray-500">Major:</span>
                      <span className="font-semibold text-red-700">{fmtPct(plan.major_coverage)}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 rounded-lg p-2 mt-1">
                  <Info className="w-4 h-4 shrink-0 mt-0.5"/>
                  <span>No dental plan linked to this patient. Go to the Patients tab to assign one.</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-4 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/>
          <div><p className="font-medium">Eligibility check failed</p><p className="mt-0.5 text-red-600">{error}</p></div>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-xl text-green-700">
            <CheckCircle className="w-5 h-5"/>
            <span className="font-semibold">Eligibility Verified via Availity</span>
          </div>

          {/* Plan fields summary in results */}
          {plan && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 bg-blue-50">
                <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                  <Award className="w-4 h-4 text-blue-600"/> Plan Coverage Summary — {plan.plan_name}
                </h4>
                <p className="text-xs text-gray-500 mt-0.5">Based on your saved dental plan. Confirm exact amounts with the Availity response below.</p>
              </div>
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                {[
                  { label: 'Annual Deductible', value: fmt$(plan.deductible), icon: DollarSign, color: 'text-orange-600', bg: 'bg-orange-50' },
                  { label: 'Annual Maximum',    value: fmt$(plan.annual_max), icon: DollarSign, color: 'text-green-600', bg: 'bg-green-50' },
                  { label: 'Preventive Care',   value: fmtPct(plan.preventive_coverage), icon: Percent, color: 'text-blue-600', bg: 'bg-blue-50', note: 'Cleanings, X-rays, Exams' },
                  { label: 'Basic Services',    value: fmtPct(plan.basic_coverage), icon: Percent, color: 'text-yellow-600', bg: 'bg-yellow-50', note: 'Fillings, Simple extractions' },
                  { label: 'Major Services',    value: fmtPct(plan.major_coverage), icon: Percent, color: 'text-red-600', bg: 'bg-red-50', note: 'Crowns, Root canals, Dentures' },
                ].map(({ label, value, icon: Icon, color, bg, note }) => (
                  <div key={label} className={`${bg} rounded-xl p-4 text-center border border-white`}>
                    <Icon className={`w-5 h-5 ${color} mx-auto mb-1`}/>
                    <p className="text-2xl font-bold text-gray-900">{value}</p>
                    <p className="text-xs font-medium text-gray-600 mt-0.5">{label}</p>
                    {note && <p className="text-xs text-gray-400 mt-0.5">{note}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Key Availity fields if present */}
          {(result.status || result.planBeginDate || result.networkStatus) && (
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-5">
              <h4 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600"/> Live Availity Response — Key Details
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
                {result.status && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-400 uppercase tracking-wide">Coverage Status</span>
                    <span className={`font-semibold ${result.status === 'Active' ? 'text-green-600' : 'text-red-600'}`}>{String(result.status)}</span>
                  </div>
                )}
                {result.planBeginDate && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-400 uppercase tracking-wide">Plan Start Date</span>
                    <span className="font-semibold text-gray-900 flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-gray-400"/>{String(result.planBeginDate)}
                    </span>
                  </div>
                )}
                {result.networkStatus && (
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs text-gray-400 uppercase tracking-wide">Network</span>
                    <span className="font-semibold text-gray-900">{String(result.networkStatus)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Raw JSON toggle */}
          <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <button onClick={() => setShowRaw(s => !s)}
              className="w-full flex items-center justify-between px-5 py-3 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
              <span>Full Availity API Response (JSON)</span>
              {showRaw ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
            </button>
            {showRaw && (
              <pre className="px-5 pb-5 text-xs bg-gray-50 overflow-auto max-h-80 text-gray-700">
                {JSON.stringify(result, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
