import { useState, useEffect, useRef } from 'react';
import {
  User, Building2, ShieldCheck, Download, RotateCcw,
  ChevronRight, ChevronLeft, Loader2, AlertCircle,
  CheckCircle, DollarSign, Percent,
  Clock, Printer
} from 'lucide-react';
import { supabase, callAvailityApi } from '../lib/supabase';
import { InsurancePicker } from './InsurancePicker';

/* ─── Types ─────────────────────────────────────────── */
interface PatientForm {
  first_name: string; last_name: string; date_of_birth: string;
  member_id: string; group_number: string; ssn_last4: string;
}
interface InsuranceForm {
  carrier_id: string; carrier_name: string; plan_name: string;
}
interface EligResult { [key: string]: unknown }

const BLANK_PATIENT: PatientForm = {
  first_name: '', last_name: '', date_of_birth: '',
  member_id: '', group_number: '', ssn_last4: '',
};
const BLANK_INS: InsuranceForm = { carrier_id: '', carrier_name: '', plan_name: '' };

/* ─── Helpers ───────────────────────────────────────── */
const fmt$ = (v: unknown) => {
  const n = Number(v);
  return isNaN(n) ? (v ? String(v) : '—') : `$${n.toLocaleString()}`;
};
const fmtPct = (v: unknown) => {
  const n = Number(v);
  return isNaN(n) ? (v ? String(v) : '—') : `${n}%`;
};
const fmtDate = (d: string) => {
  try { return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }); }
  catch { return d; }
};

/* ─── Result Renderer ───────────────────────────────── */
function DentalEligibilityCard({ result, patient, insurance }: {
  result: EligResult;
  patient: PatientForm;
  insurance: InsuranceForm;
}) {
  // Parse common Availity dental fields (handles various response shapes)
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const val = result[k] ?? (result.data as EligResult)?.[k] ?? (result.eligibility as EligResult)?.[k];
      if (val !== undefined && val !== null && val !== '') return val;
    }
    return null;
  };

  const status        = get('status', 'coverageStatus', 'eligibilityStatus') ?? 'Unknown';
  const isActive      = String(status).toLowerCase().includes('active') || String(status) === '1';
  const planName      = get('planName', 'plan_name', 'groupName') ?? insurance.plan_name ?? '—';
  const effectiveDate = get('planBeginDate', 'effectiveDate', 'coverageBeginDate', 'startDate');
  const termDate      = get('planEndDate', 'terminationDate', 'coverageEndDate', 'endDate');
  const network       = get('networkStatus', 'network', 'inNetworkIndicator', 'planNetworkId');
  const memberId      = get('memberId', 'member_id', 'subscriberId') ?? patient.member_id;
  const groupNum      = get('groupNumber', 'group_number', 'groupId') ?? patient.group_number;

  // Financial — nested or flat
  const dedInd  = get('deductibleIndividual', 'individual_deductible') ?? (result.deductible as EligResult)?.individual ?? (result.deductible as EligResult)?.amount;
  const dedFam  = get('deductibleFamily',     'family_deductible')     ?? (result.deductible as EligResult)?.family;
  const dedRem  = get('deductibleRemaining',  'remaining_deductible')  ?? (result.deductible as EligResult)?.remaining;
  const maxInd  = get('annualMaximum', 'annual_max', 'maximumBenefit') ?? (result.maximumBenefit as EligResult)?.individual ?? (result.maximumBenefit as EligResult)?.amount;
  const maxRem  = get('annualMaximumRemaining', 'remaining_benefit')   ?? (result.maximumBenefit as EligResult)?.remaining;

  // Coverage pct — nested coverages obj or flat
  const cvg     = (result.coverages ?? result.coverage ?? {}) as EligResult;
  const prevPct = get('preventiveCoverage', 'preventive_pct') ?? (cvg.preventive as EligResult)?.percent ?? (cvg.preventive as EligResult)?.coveragePercent;
  const basePct = get('basicCoverage',      'basic_pct')      ?? (cvg.basic      as EligResult)?.percent ?? (cvg.basic      as EligResult)?.coveragePercent;
  const majPct  = get('majorCoverage',      'major_pct')      ?? (cvg.major      as EligResult)?.percent ?? (cvg.major      as EligResult)?.coveragePercent;
  const orthPct = get('orthodonticCoverage','ortho_pct')      ?? (cvg.orthodontic as EligResult)?.percent;
  const orthMax = (cvg.orthodontic as EligResult)?.lifetime_max ?? get('orthodonticLifetimeMax');
  const waitPrev= (cvg.preventive  as EligResult)?.waiting_period as string|null ?? null;
  const waitBasic=(cvg.basic       as EligResult)?.waiting_period as string|null ?? null;
  const waitMaj = (cvg.major       as EligResult)?.waiting_period as string|null ?? null;

  return (
    <div id="eligibility-result" className="space-y-4">
      {/* Header */}
      <div className={`flex items-center gap-3 p-4 rounded-xl border ${isActive ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
        {isActive
          ? <CheckCircle className="w-6 h-6 text-green-600 shrink-0"/>
          : <AlertCircle className="w-6 h-6 text-red-600 shrink-0"/>}
        <div>
          <p className={`font-bold text-lg ${isActive ? 'text-green-800' : 'text-red-800'}`}>
            Coverage {isActive ? 'Active ✓' : 'Inactive / Not Found'}
          </p>
          <p className="text-sm text-gray-600">{insurance.carrier_name} · {String(planName)}</p>
        </div>
      </div>

      {/* Patient + Member info */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Patient & Membership</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          {[
            ['Patient',      `${patient.first_name} ${patient.last_name}`] as [string,string],
            ['Date of Birth', fmtDate(patient.date_of_birth)] as [string,string],
            ['Member ID',    String(memberId || '')] as [string,string],
            ['Group #',      String(groupNum || '—')] as [string,string],
            ['Network',      String(network  || '—')] as [string,string],
            ['Effective',    effectiveDate ? fmtDate(String(effectiveDate)) : '—'] as [string,string],
            ...(termDate ? [['Term Date', fmtDate(String(termDate))] as [string,string]] : []),
          ].map(([label, val]) => (
            <div key={label}>
              <p className="text-xs text-gray-400">{label}</p>
              <p className="font-semibold text-gray-900">{String(val)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Financial */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1">
          <DollarSign className="w-3.5 h-3.5"/> Deductibles & Maximums
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Deductible (Ind.)',   value: fmt$(dedInd),  bg: 'bg-orange-50',  color: 'text-orange-700' },
            { label: 'Deductible (Family)', value: fmt$(dedFam),  bg: 'bg-orange-50',  color: 'text-orange-700' },
            { label: 'Deductible Remaining',value: fmt$(dedRem),  bg: 'bg-amber-50',   color: 'text-amber-700' },
            { label: 'Annual Maximum',      value: fmt$(maxInd),  bg: 'bg-green-50',   color: 'text-green-700' },
            { label: 'Max Remaining',       value: fmt$(maxRem),  bg: 'bg-emerald-50', color: 'text-emerald-700' },
          ].map(({ label, value, bg }) => (
            <div key={label} className={`${bg} rounded-lg p-3 text-center`}>
              <p className="text-xl font-bold text-gray-900">{value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Coverage percentages */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
        <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Percent className="w-3.5 h-3.5"/> Dental Coverage by Service Type
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Preventive',   sub: 'Cleanings, X-rays, Exams',             value: fmtPct(prevPct), wait: waitPrev, bg: 'bg-blue-50',   bar: 'bg-blue-500',   pct: Number(prevPct)||0 },
            { label: 'Basic',        sub: 'Fillings, Simple Extractions',           value: fmtPct(basePct), wait: waitBasic,bg: 'bg-yellow-50', bar: 'bg-yellow-500', pct: Number(basePct)||0 },
            { label: 'Major',        sub: 'Crowns, Root Canals, Dentures',          value: fmtPct(majPct),  wait: waitMaj,  bg: 'bg-red-50',    bar: 'bg-red-500',    pct: Number(majPct)||0  },
            { label: 'Orthodontic',  sub: orthMax ? `Lifetime Max: ${fmt$(orthMax)}` : 'Braces & aligners', value: fmtPct(orthPct), wait: null, bg: 'bg-purple-50', bar: 'bg-purple-500', pct: Number(orthPct)||0 },
          ].map(({ label, sub, value, wait, bg, bar, pct }) => (
            <div key={String(label)} className={`${bg} rounded-xl p-4`}>
              <p className="text-3xl font-bold text-gray-900">{value}</p>
              <p className="font-semibold text-gray-700 mt-1">{label}</p>
              <p className="text-xs text-gray-400">{sub}</p>
              <div className="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className={`h-full ${bar} rounded-full`} style={{ width: `${Math.min(pct,100)}%` }}/>
              </div>
              {wait && <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><Clock className="w-3 h-3"/>Waiting: {String(wait)}</p>}
            </div>
          ))}
        </div>
      </div>

      {/* Extra / raw fields if API returned more */}
      {Object.keys(result).length > 0 && (
        <details className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <summary className="px-5 py-3 text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-50">
            Full API Response (expand to view)
          </summary>
          <pre className="px-5 pb-5 text-xs bg-gray-50 overflow-auto max-h-64 text-gray-700">
            {JSON.stringify(result, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

/* ─── Main Component ─────────────────────────────────── */
export function SingleCheck() {
  const [step, setStep]         = useState<1|2|3>(1);
  const [patient, setPatient]   = useState<PatientForm>(BLANK_PATIENT);
  const [insurance, setInsurance] = useState<InsuranceForm>(BLANK_INS);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState<EligResult|null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from('insurance_companies').select('id,name,availity_carrier_id').order('name')
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  const pSet = (k: keyof PatientForm, v: string) => setPatient(p => ({ ...p, [k]: v }));
  const iSet = (k: keyof InsuranceForm, v: string) => setInsurance(i => ({ ...i, [k]: v }));

  const step1Valid = patient.first_name && patient.last_name && patient.date_of_birth && patient.member_id;
  const step2Valid = insurance.carrier_id && insurance.carrier_name;

  const handleCheck = async () => {
    setLoading(true); setError('');
    try {
      const data = await callAvailityApi('check_eligibility', {
        memberId:    patient.member_id,
        groupNumber: patient.group_number,
        firstName:   patient.first_name,
        lastName:    patient.last_name,
        dateOfBirth: patient.date_of_birth,
        ssnLast4:    patient.ssn_last4,
        carrierCode: insurance.carrier_id,
        planName:    insurance.plan_name,
      });
      setResult(data);
      setStep(3);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Eligibility check failed');
    }
    setLoading(false);
  };

  const handlePrint = () => window.print();

  const handleDownloadCSV = () => {
    if (!result) return;
    const flat = (obj: unknown, prefix = ''): Record<string,string> => {
      if (typeof obj !== 'object' || obj === null) return {};
      return Object.entries(obj as Record<string,unknown>).reduce((acc, [k, v]) => {
        const key = prefix ? `${prefix}_${k}` : k;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) Object.assign(acc, flat(v, key));
        else acc[key] = String(v ?? '');
        return acc;
      }, {} as Record<string,string>);
    };
    const flatResult = flat(result);
    const patientFields = {
      first_name: patient.first_name, last_name: patient.last_name,
      date_of_birth: patient.date_of_birth, member_id: patient.member_id,
      group_number: patient.group_number, carrier: insurance.carrier_name,
      carrier_id: insurance.carrier_id,
    };
    const row = { ...patientFields, ...flatResult };
    const headers = Object.keys(row).join(',');
    const values  = Object.values(row).map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
    const csv = `${headers}\n${values}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `eligibility_${patient.last_name}_${patient.first_name}_${Date.now()}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const reset = () => {
    setStep(1); setPatient(BLANK_PATIENT); setInsurance(BLANK_INS);
    setResult(null); setError('');
  };

  /* ── Step indicators ── */
  const steps = [
    { n: 1, label: 'Patient Info', icon: User },
    { n: 2, label: 'Insurance',    icon: Building2 },
    { n: 3, label: 'Results',      icon: ShieldCheck },
  ];

  return (
    <div className="space-y-5">

      {/* Step bar */}
      <div className="flex items-center bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
        {steps.map((s, i) => {
          const Icon = s.icon;
          const done = step > s.n;
          const active = step === s.n;
          return (
            <div key={s.n} className="flex items-center flex-1">
              <div className={`flex items-center gap-2 flex-1 ${i > 0 ? 'ml-2' : ''}`}>
                {i > 0 && <div className={`flex-1 h-0.5 rounded ${done ? 'bg-blue-500' : 'bg-gray-200'}`}/>}
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg transition ${active ? 'bg-blue-600 text-white' : done ? 'bg-green-50 text-green-700' : 'text-gray-400'}`}>
                  {done ? <CheckCircle className="w-4 h-4"/> : <Icon className="w-4 h-4"/>}
                  <span className="text-sm font-medium hidden sm:inline">{s.label}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── STEP 1: Patient Info ── */}
      {step === 1 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 text-lg mb-1 flex items-center gap-2">
            <User className="w-5 h-5 text-blue-600"/> Patient Information
          </h3>
          <p className="text-sm text-gray-500 mb-5">Enter the patient's details exactly as they appear on their insurance card.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="First Name *"      value={patient.first_name}    onChange={v => pSet('first_name',v)}    placeholder="e.g., John" />
            <Field label="Last Name *"       value={patient.last_name}     onChange={v => pSet('last_name',v)}     placeholder="e.g., Smith" />
            <Field label="Date of Birth *"   value={patient.date_of_birth} onChange={v => pSet('date_of_birth',v)} type="date" />
            <Field label="Member ID *"       value={patient.member_id}     onChange={v => pSet('member_id',v)}     placeholder="As shown on insurance card" mono />
            <Field label="Group Number"      value={patient.group_number}  onChange={v => pSet('group_number',v)}  placeholder="Optional" mono />
            <Field label="SSN Last 4 digits" value={patient.ssn_last4}     onChange={v => pSet('ssn_last4',v)}     placeholder="Optional — some carriers require" mono maxLength={4} />
          </div>

          <div className="mt-6 flex justify-end">
            <button onClick={() => setStep(2)} disabled={!step1Valid}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 transition">
              Next: Insurance Info <ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 2: Insurance Info ── */}
      {step === 2 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h3 className="font-bold text-gray-900 text-lg mb-1 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-blue-600"/> Insurance Information
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Select the patient's insurance below. Every insurer shows its <strong>Payer ID</strong> — click
            the&nbsp;<span className="inline-flex items-center gap-0.5 text-gray-600 font-medium">✏️ pencil</span>&nbsp;icon on any row to change the Payer ID if needed.
          </p>

          {/* Rich carrier picker */}
          <div className="mb-5">
            <label className="block text-sm font-medium text-gray-700 mb-2">Insurance Company &amp; Payer ID *</label>
            <InsurancePicker
              selectedId={insurance.carrier_id}
              selectedName={insurance.carrier_name}
              onChange={(payer_id, name) => { iSet('carrier_id', payer_id); iSet('carrier_name', name); }}
            />
          </div>

          {/* Plan name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Plan Name <span className="text-gray-400">(optional)</span></label>
            <input value={insurance.plan_name} onChange={e => iSet('plan_name', e.target.value)}
              placeholder="e.g., Delta Dental PPO Plus Premier"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>

          {/* Patient summary */}
          <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>👤 {patient.first_name} {patient.last_name}</span>
            <span>🎂 {fmtDate(patient.date_of_birth)}</span>
            <span>🪪 Member: {patient.member_id}</span>
            {patient.group_number && <span>👥 Group: {patient.group_number}</span>}
          </div>

          {error && (
            <div className="mt-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/>{error}
            </div>
          )}

          <div className="mt-6 flex justify-between">
            <button onClick={() => setStep(1)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-xl hover:bg-gray-200 transition">
              <ChevronLeft className="w-4 h-4"/> Back
            </button>
            <button onClick={handleCheck} disabled={!step2Valid || loading}
              className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 disabled:opacity-40 transition">
              {loading ? <Loader2 className="w-4 h-4 animate-spin"/> : <ShieldCheck className="w-4 h-4"/>}
              {loading ? 'Checking with Availity…' : 'Check Eligibility'}
            </button>
          </div>
        </div>
      )}

      {/* ── STEP 3: Results ── */}
      {step === 3 && result && (
        <div>
          {/* Action bar */}
          <div className="flex flex-wrap gap-2 mb-4">
            <button onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition">
              <Printer className="w-4 h-4"/> Print / Save PDF
            </button>
            <button onClick={handleDownloadCSV}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition">
              <Download className="w-4 h-4"/> Download CSV
            </button>
            <button onClick={reset}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
              <RotateCcw className="w-4 h-4"/> New Check
            </button>
          </div>

          <div ref={resultRef}>
            <DentalEligibilityCard result={result} patient={patient} insurance={insurance}/>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Shared Field component ── */
function Field({ label, value, onChange, placeholder, type = 'text', mono = false, maxLength }: {
  label: string; value: string; onChange: (v:string)=>void;
  placeholder?: string; type?: string; mono?: boolean; maxLength?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} maxLength={maxLength}
        className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${mono ? 'font-mono' : ''}`}/>
    </div>
  );
}
