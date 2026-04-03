/**
 * Preauth.tsx — Preauthorization Check & Request
 *
 * Two sub-tabs:
 *   1. Submit Request  — enter patient + procedure inline, submit to Availity
 *   2. History         — past submissions (stored in Supabase)
 *
 * No pre-existing patient record required — inline entry like SingleCheck.
 */
import { useState, useEffect } from 'react';
import {
  FileText, Send, RefreshCw, AlertCircle, CheckCircle, Loader2,
  Clock, XCircle, Info, Search, ChevronRight, Building2,
  User, Stethoscope, DollarSign, Hash, RotateCcw, Download,
  ClipboardList, History
} from 'lucide-react';
import { supabase, callAvailityApi } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { InsurancePicker } from './InsurancePicker';
import { DemoBanner } from './DemoBanner';

/* ── Common ADA procedure codes ─────────────────────────────────── */
const ADA_CODES = [
  { code: 'D0120', desc: 'Periodic oral evaluation – established patient' },
  { code: 'D0150', desc: 'Comprehensive oral evaluation – new or established patient' },
  { code: 'D0210', desc: 'Radiographic survey of the whole mouth (full mouth x-rays)' },
  { code: 'D0220', desc: 'Periapical radiographic image – first image' },
  { code: 'D0272', desc: 'Bitewing radiographic images – two images' },
  { code: 'D0274', desc: 'Bitewing radiographic images – four images' },
  { code: 'D1110', desc: 'Prophylaxis (cleaning) – adult' },
  { code: 'D1120', desc: 'Prophylaxis (cleaning) – child' },
  { code: 'D1208', desc: 'Topical application of fluoride – excluding varnish' },
  { code: 'D2140', desc: 'Amalgam restoration – one surface, primary or permanent' },
  { code: 'D2160', desc: 'Amalgam restoration – three surfaces, primary or permanent' },
  { code: 'D2330', desc: 'Resin-based composite – one surface, anterior' },
  { code: 'D2391', desc: 'Resin-based composite – one surface, posterior (primary tooth)' },
  { code: 'D2740', desc: 'Crown – porcelain/ceramic substrate' },
  { code: 'D2750', desc: 'Crown – porcelain fused to high noble metal' },
  { code: 'D3310', desc: 'Endodontic therapy, anterior tooth (root canal)' },
  { code: 'D3320', desc: 'Endodontic therapy, premolar tooth (root canal)' },
  { code: 'D3330', desc: 'Endodontic therapy, molar tooth (root canal)' },
  { code: 'D4341', desc: 'Periodontal scaling and root planing – four or more teeth per quadrant' },
  { code: 'D4342', desc: 'Periodontal scaling and root planing – one to three teeth per quadrant' },
  { code: 'D5110', desc: 'Complete denture – maxillary' },
  { code: 'D5120', desc: 'Complete denture – mandibular' },
  { code: 'D6010', desc: 'Surgical placement of implant body – endosteal implant' },
  { code: 'D6065', desc: 'Implant supported porcelain/ceramic crown' },
  { code: 'D7110', desc: 'Extraction, coronal remnants – deciduous tooth' },
  { code: 'D7140', desc: 'Extraction, erupted tooth or exposed root' },
  { code: 'D7210', desc: 'Surgical removal of erupted tooth requiring elevation of mucoperiosteal flap' },
  { code: 'D7240', desc: 'Removal of impacted tooth – completely bony' },
  { code: 'D8080', desc: 'Comprehensive orthodontic treatment of the adolescent dentition' },
  { code: 'D8090', desc: 'Comprehensive orthodontic treatment of the adult dentition' },
  { code: 'D9930', desc: 'Treatment of complications (unusual circumstances) – post-surgical' },
];

const STATUS_UI: Record<string, { color: string; icon: typeof Clock; label: string }> = {
  pending:          { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock,         label: 'Pending' },
  approved:         { color: 'bg-green-100 text-green-800 border-green-200',    icon: CheckCircle,   label: 'Approved' },
  denied:           { color: 'bg-red-100 text-red-800 border-red-200',          icon: XCircle,       label: 'Denied' },
  more_info_needed: { color: 'bg-blue-100 text-blue-800 border-blue-200',       icon: Info,          label: 'More Info Needed' },
};

/* ── Types ────────────────────────────────────────────────────────── */
interface PatientForm {
  first_name: string; last_name: string; date_of_birth: string;
  member_id: string; group_number: string;
}
interface InsuranceState { carrier_id: string; carrier_name: string; }
interface ProcForm {
  procedure_code: string; procedure_description: string;
  tooth_number: string; estimated_cost: string; notes: string;
}

const BLANK_PAT: PatientForm    = { first_name:'', last_name:'', date_of_birth:'', member_id:'', group_number:'' };
const BLANK_INS: InsuranceState = { carrier_id:'', carrier_name:'' };
const BLANK_PRO: ProcForm       = { procedure_code:'', procedure_description:'', tooth_number:'', estimated_cost:'', notes:'' };

/* ── Small helpers ────────────────────────────────────────────────── */
const Field = ({ label, value, onChange, placeholder, mono, type='text', required=false }:
  { label:string; value:string; onChange:(v:string)=>void; placeholder?:string; mono?:boolean; type?:string; required?:boolean }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required && ' *'}</label>
    <input
      type={type} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none ${mono ? 'font-mono' : ''}`}
    />
  </div>
);

const fmtDate = (d?: string) => {
  if (!d) return '—';
  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }); }
  catch { return d; }
};

/* ══════════════════════════════════════════════════════════════════ */
export function Preauth() {
  const { user } = useAuth();
  const [subTab, setSubTab] = useState<'submit' | 'history'>('submit');

  /* ── Submit form state (3 steps) ── */
  const [step, setStep]         = useState(1);
  const [patient, setPatient]   = useState<PatientForm>(BLANK_PAT);
  const [insurance, setInsurance] = useState<InsuranceState>(BLANK_INS);
  const [proc, setProc]         = useState<ProcForm>(BLANK_PRO);
  const [codeSearch, setCodeSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]     = useState<Record<string,unknown> | null>(null);
  const [error, setError]       = useState('');

  /* ── History state ── */
  const [history, setHistory]   = useState<Record<string,unknown>[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [histSearch, setHistSearch]   = useState('');
  const [refreshing, setRefreshing]   = useState<string|null>(null);

  const pSet = (k: keyof PatientForm, v: string) => setPatient(p => ({...p,[k]:v}));
  const rSet = (k: keyof ProcForm,   v: string) => setProc(p  => ({...p,[k]:v}));

  const step1Valid = patient.first_name && patient.last_name && patient.date_of_birth && patient.member_id;
  const step2Valid = insurance.carrier_id && insurance.carrier_name;
  const step3Valid = proc.procedure_code && proc.procedure_description;

  /* ── Fetch history ── */
  const fetchHistory = async () => {
    setHistLoading(true);
    const { data } = await supabase.from('preauthorizations')
      .select('*').order('created_at', { ascending: false }).limit(100);
    setHistory((data || []) as Record<string,unknown>[]);
    setHistLoading(false);
  };

  useEffect(() => { if (subTab === 'history') fetchHistory(); }, [subTab]);

  /* ── Submit ── */
  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const payload = {
        memberId:          patient.member_id,
        groupNumber:       patient.group_number,
        firstName:         patient.first_name,
        lastName:          patient.last_name,
        dateOfBirth:       patient.date_of_birth,
        carrierCode:       insurance.carrier_id,
        procedureCode:     proc.procedure_code,
        procedureDesc:     proc.procedure_description,
        toothNumber:       proc.tooth_number,
        estimatedCost:     proc.estimated_cost,
        notes:             proc.notes,
      };
      const data = await callAvailityApi('submit_preauthorization', payload) as Record<string,unknown>;
      setResult(data);

      // Save to Supabase history
      await supabase.from('preauthorizations').insert({
        user_id:               user?.id,
        first_name:            patient.first_name,
        last_name:             patient.last_name,
        date_of_birth:         patient.date_of_birth,
        member_id:             patient.member_id,
        group_number:          patient.group_number,
        carrier_id:            insurance.carrier_id,
        carrier_name:          insurance.carrier_name,
        procedure_code:        proc.procedure_code,
        procedure_description: proc.procedure_description,
        tooth_number:          proc.tooth_number,
        estimated_cost:        proc.estimated_cost ? parseFloat(proc.estimated_cost) : null,
        notes:                 proc.notes,
        status:                String(data.status ?? data.authorizationStatus ?? 'pending').toLowerCase(),
        auth_number:           String(data.authorizationNumber ?? data.auth_number ?? data.referenceNumber ?? ''),
        response_raw:          data,
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setStep(1); setPatient(BLANK_PAT); setInsurance(BLANK_INS);
    setProc(BLANK_PRO); setResult(null); setError(''); setCodeSearch('');
  };

  /* ── Refresh a historical record status ── */
  const refreshStatus = async (id: string, carrier: string, auth: string) => {
    setRefreshing(id);
    try {
      const data = await callAvailityApi('check_auth_status', { authorizationId: auth, carrierCode: carrier }) as Record<string,unknown>;
      const newStatus = String(data.status ?? data.authorizationStatus ?? '').toLowerCase();
      if (newStatus) {
        await supabase.from('preauthorizations').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', id);
        setHistory(h => h.map(r => r.id === id ? {...r, status: newStatus} : r));
      }
    } catch { /* silently ignore */ }
    setRefreshing(null);
  };

  /* ── Code picker filter ── */
  const filteredCodes = ADA_CODES.filter(a =>
    !codeSearch || a.code.toLowerCase().includes(codeSearch.toLowerCase()) || a.desc.toLowerCase().includes(codeSearch.toLowerCase())
  );

  /* ── Result card ── */
  const ResultCard = () => {
    if (!result) return null;
    const status  = String(result.status ?? result.authorizationStatus ?? 'pending').toLowerCase();
    const authNum = String(result.authorizationNumber ?? result.auth_number ?? result.referenceNumber ?? '');
    const approvedAmt = String(result.approvedAmount ?? result.authorizedAmount ?? '');
    const notes   = String(result.notes ?? result.message ?? result.statusMessage ?? '');
    const ui = STATUS_UI[status] ?? STATUS_UI.pending;
    const Icon = ui.icon;

    return (
      <div className="space-y-4">
        {result._demo && <DemoBanner/>}
        {/* Status banner */
        <div className={`border rounded-xl p-5 flex items-start gap-4 ${ui.color}`}>
          <Icon className="w-7 h-7 shrink-0 mt-0.5"/>
          <div className="flex-1">
            <p className="font-bold text-lg">{ui.label}</p>
            {authNum && <p className="text-sm mt-0.5">Authorization #: <span className="font-mono font-semibold">{authNum}</span></p>}
            {notes && <p className="text-sm mt-1">{notes}</p>}
          </div>
        </div>

        {/* Details grid */}
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
          <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Summary</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {[
              ['Patient',    `${patient.first_name} ${patient.last_name}`],
              ['Member ID',  patient.member_id],
              ['Carrier',    insurance.carrier_name],
              ['Procedure',  `${proc.procedure_code} — ${proc.procedure_description}`],
              proc.tooth_number ? ['Tooth #', proc.tooth_number] : null,
              proc.estimated_cost ? ['Est. Cost', `$${proc.estimated_cost}`] : null,
              approvedAmt ? ['Approved Amt', `$${approvedAmt}`] : null,
            ].filter(Boolean).map(([label, value]) => (
              <div key={label as string} className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-400">{label as string}</p>
                <p className="font-semibold text-gray-800 text-sm mt-0.5">{value as string}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button onClick={() => window.print()}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition">
            <Download className="w-4 h-4"/> Print / Save PDF
          </button>
          <button onClick={resetForm}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition">
            <RotateCcw className="w-4 h-4"/> New Request
          </button>
          <button onClick={() => { setSubTab('history'); fetchHistory(); }}
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">
            <History className="w-4 h-4"/> View History
          </button>
        </div>
      </div>
    );
  };

  /* ── Step indicator ── */
  const steps = [
    { n:1, label:'Patient Info',  icon: User },
    { n:2, label:'Insurance',     icon: Building2 },
    { n:3, label:'Procedure',     icon: Stethoscope },
    { n:4, label:'Result',        icon: CheckCircle },
  ];

  /* ══════════════════════ RENDER ══════════════════════════════════ */
  return (
    <div className="space-y-5">

      {/* Sub-tab switcher */}
      <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
        {([['submit','Submit Request', ClipboardList],['history','History', History]] as const).map(([id, label, Icon]) => (
          <button key={id} onClick={() => setSubTab(id)}
            className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition flex-1 justify-center
              ${subTab === id ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
            <Icon className="w-4 h-4"/>{label}
          </button>
        ))}
      </div>

      {/* ═══════ SUBMIT TAB ═══════ */}
      {subTab === 'submit' && (
        <>
          {/* Step indicator */}
          {!result && (
            <div className="flex items-center gap-0">
              {steps.map((s, i) => {
                const Icon = s.icon;
                const done = step > s.n;
                const active = step === s.n;
                return (
                  <div key={s.n} className="flex items-center flex-1">
                    <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition
                      ${done   ? 'text-green-700' : active ? 'text-blue-700' : 'text-gray-400'}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                        ${done ? 'bg-green-100' : active ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}>
                        {done ? <CheckCircle className="w-3.5 h-3.5 text-green-600"/> : <Icon className="w-3.5 h-3.5"/>}
                      </div>
                      <span className="hidden sm:inline">{s.label}</span>
                    </div>
                    {i < steps.length - 1 && <div className="flex-1 h-px bg-gray-200 mx-1"/>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Result */}
          {result && <ResultCard/>}

          {/* Step 1 — Patient */}
          {!result && step === 1 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 text-lg mb-1 flex items-center gap-2">
                <User className="w-5 h-5 text-blue-600"/> Patient Information
              </h3>
              <p className="text-sm text-gray-500 mb-5">Enter the patient's details as they appear on their insurance card.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="First Name"   value={patient.first_name}   onChange={v => pSet('first_name',v)}   placeholder="John"       required/>
                <Field label="Last Name"    value={patient.last_name}    onChange={v => pSet('last_name',v)}    placeholder="Smith"      required/>
                <Field label="Date of Birth" value={patient.date_of_birth} onChange={v => pSet('date_of_birth',v)} type="date" required/>
                <Field label="Member ID"    value={patient.member_id}    onChange={v => pSet('member_id',v)}    placeholder="MEM123456"  mono required/>
                <Field label="Group Number" value={patient.group_number} onChange={v => pSet('group_number',v)} placeholder="GRP001 (optional)" mono/>
              </div>
              <div className="mt-6 flex justify-end">
                <button disabled={!step1Valid} onClick={() => setStep(2)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
                  Next — Insurance <ChevronRight className="w-4 h-4"/>
                </button>
              </div>
            </div>
          )}

          {/* Step 2 — Insurance */}
          {!result && step === 2 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
              <h3 className="font-bold text-gray-900 text-lg mb-1 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-blue-600"/> Insurance Information
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                Select the insurer — every carrier shows its <strong>Payer ID</strong>. Click the pencil to change it if needed.
              </p>
              <label className="block text-sm font-medium text-gray-700 mb-2">Insurance Company &amp; Payer ID *</label>
              <InsurancePicker
                selectedId={insurance.carrier_id}
                selectedName={insurance.carrier_name}
                onChange={(pid, name) => setInsurance({ carrier_id: pid, carrier_name: name })}
              />
              {/* Patient summary */}
              <div className="mt-4 p-3 bg-gray-50 rounded-lg text-sm text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                <span>👤 {patient.first_name} {patient.last_name}</span>
                <span>🎂 {fmtDate(patient.date_of_birth)}</span>
                <span>🪪 {patient.member_id}</span>
                {patient.group_number && <span>👥 {patient.group_number}</span>}
              </div>
              <div className="mt-5 flex justify-between">
                <button onClick={() => setStep(1)} className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">← Back</button>
                <button disabled={!step2Valid} onClick={() => setStep(3)}
                  className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
                  Next — Procedure <ChevronRight className="w-4 h-4"/>
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Procedure */}
          {!result && step === 3 && (
            <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm space-y-5">
              <div>
                <h3 className="font-bold text-gray-900 text-lg mb-1 flex items-center gap-2">
                  <Stethoscope className="w-5 h-5 text-blue-600"/> Procedure Details
                </h3>
                <p className="text-sm text-gray-500">Select an ADA procedure code or type it manually. Add tooth number and estimated cost for faster approval.</p>
              </div>

              {/* ADA code picker */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ADA Procedure Code *</label>
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  {/* Search */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
                    <Search className="w-4 h-4 text-gray-400"/>
                    <input value={codeSearch} onChange={e => setCodeSearch(e.target.value)}
                      placeholder="Search by code or description…"
                      className="flex-1 bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"/>
                  </div>
                  {/* Column headers */}
                  <div className="grid grid-cols-[90px_1fr] text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-1.5 bg-gray-50 border-b border-gray-100">
                    <span>Code</span><span>Description</span>
                  </div>
                  {/* Rows */}
                  <div className="max-h-48 overflow-y-auto divide-y divide-gray-50">
                    {filteredCodes.map(a => {
                      const sel = proc.procedure_code === a.code;
                      return (
                        <div key={a.code}
                          onClick={() => { rSet('procedure_code', a.code); rSet('procedure_description', a.desc); setCodeSearch(''); }}
                          className={`grid grid-cols-[90px_1fr] px-4 py-2 cursor-pointer text-sm transition select-none
                            ${sel ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'}`}>
                          <span className={`font-mono font-semibold ${sel ? 'text-blue-700' : 'text-gray-700'}`}>{a.code}</span>
                          <span className={sel ? 'text-blue-800' : 'text-gray-600'}>{a.desc}</span>
                        </div>
                      );
                    })}
                    {filteredCodes.length === 0 && (
                      <p className="text-center text-gray-400 text-sm py-4">No codes found — type the code manually below</p>
                    )}
                  </div>
                </div>

                {/* Manual override */}
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Or type code manually</label>
                    <input value={proc.procedure_code} onChange={e => rSet('procedure_code', e.target.value.toUpperCase())}
                      placeholder="e.g., D2740"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Description *</label>
                    <input value={proc.procedure_description} onChange={e => rSet('procedure_description', e.target.value)}
                      placeholder="Procedure description"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                  </div>
                </div>
              </div>

              {/* Additional fields */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Hash className="w-3.5 h-3.5"/> Tooth Number</label>
                  <input value={proc.tooth_number} onChange={e => rSet('tooth_number', e.target.value)}
                    placeholder="e.g., 14 (optional)"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><DollarSign className="w-3.5 h-3.5"/> Estimated Cost</label>
                  <input value={proc.estimated_cost} onChange={e => rSet('estimated_cost', e.target.value)}
                    placeholder="e.g., 1200 (optional)" type="number" min="0"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Clinical Notes <span className="text-gray-400">(optional)</span></label>
                  <textarea value={proc.notes} onChange={e => rSet('notes', e.target.value)}
                    placeholder="Any additional clinical details to support the request…"
                    rows={2}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"/>
                </div>
              </div>

              {/* Summary before submit */}
              <div className="p-3 bg-gray-50 rounded-lg text-sm text-gray-600 flex flex-wrap gap-x-5 gap-y-1">
                <span>👤 {patient.first_name} {patient.last_name}</span>
                <span>🪪 {patient.member_id}</span>
                <span>🏥 {insurance.carrier_name} ({insurance.carrier_id})</span>
                {proc.procedure_code && <span>🦷 {proc.procedure_code}</span>}
              </div>

              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5"/>{error}
                </div>
              )}

              <div className="flex justify-between">
                <button onClick={() => setStep(2)} className="px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition">← Back</button>
                <button disabled={!step3Valid || submitting} onClick={submit}
                  className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition">
                  {submitting ? <><Loader2 className="w-4 h-4 animate-spin"/> Submitting…</> : <><Send className="w-4 h-4"/> Submit Preauthorization</>}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ═══════ HISTORY TAB ═══════ */}
      {subTab === 'history' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <History className="w-4 h-4 text-blue-600"/> Preauth Submissions
            </h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2"/>
                <input value={histSearch} onChange={e => setHistSearch(e.target.value)}
                  placeholder="Search…"
                  className="pl-8 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-40"/>
              </div>
              <button onClick={fetchHistory} disabled={histLoading}
                className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition text-gray-500">
                <RefreshCw className={`w-4 h-4 ${histLoading ? 'animate-spin' : ''}`}/>
              </button>
            </div>
          </div>

          {histLoading ? (
            <div className="flex items-center justify-center py-12 text-gray-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2"/> Loading history…
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <FileText className="w-10 h-10 mx-auto mb-2 opacity-40"/>
              <p>No preauthorization requests yet.</p>
              <button onClick={() => setSubTab('submit')} className="mt-3 text-blue-600 text-sm hover:underline">Submit your first request →</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>{['Patient','Member ID','Carrier','Procedure','Tooth','Est. Cost','Status','Auth #','Date',''].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {history
                    .filter(r => {
                      const q = histSearch.toLowerCase();
                      return !q || [r.first_name, r.last_name, r.member_id, r.carrier_name, r.procedure_code, r.auth_number]
                        .some(v => String(v ?? '').toLowerCase().includes(q));
                    })
                    .map(r => {
                      const uid = String(r.id ?? '');
                      const st  = String(r.status ?? 'pending').toLowerCase();
                      const ui  = STATUS_UI[st] ?? STATUS_UI.pending;
                      const Icon = ui.icon;
                      return (
                        <tr key={uid} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{String(r.first_name ?? '')} {String(r.last_name ?? '')}</td>
                          <td className="px-3 py-2 font-mono">{String(r.member_id ?? '')}</td>
                          <td className="px-3 py-2">{String(r.carrier_name ?? '')}</td>
                          <td className="px-3 py-2 font-mono text-blue-700">{String(r.procedure_code ?? '')}</td>
                          <td className="px-3 py-2">{String(r.tooth_number ?? '—')}</td>
                          <td className="px-3 py-2">{r.estimated_cost ? `$${r.estimated_cost}` : '—'}</td>
                          <td className="px-3 py-2">
                            <span className={`flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-medium w-fit ${ui.color}`}>
                              <Icon className="w-3 h-3"/>{ui.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono">{String(r.auth_number ?? '—')}</td>
                          <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                            {r.created_at ? new Date(String(r.created_at)).toLocaleDateString() : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {['pending','more_info_needed'].includes(st) && String(r.auth_number ?? '') && (
                              <button
                                disabled={refreshing === uid}
                                onClick={() => refreshStatus(uid, String(r.carrier_id ?? ''), String(r.auth_number ?? ''))}
                                className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 transition" title="Refresh status">
                                <RefreshCw className={`w-3.5 h-3.5 ${refreshing === uid ? 'animate-spin' : ''}`}/>
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
