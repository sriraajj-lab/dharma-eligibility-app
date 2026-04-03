import React, { useState, useEffect } from 'react';
import { FileText, Send, RefreshCw, AlertCircle, CheckCircle, Loader2, Clock, XCircle, Info, Search } from 'lucide-react';
import { supabase, callAvailityApi } from '../lib/supabase';
import { Patient, Preauthorization } from '../types';
import { useAuth } from '../hooks/useAuth';

const STATUS_CONFIG = {
  pending:          { color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Clock,       label: 'Pending' },
  approved:         { color: 'bg-green-100 text-green-800 border-green-200',    icon: CheckCircle, label: 'Approved' },
  denied:           { color: 'bg-red-100 text-red-800 border-red-200',          icon: XCircle,     label: 'Denied' },
  more_info_needed: { color: 'bg-blue-100 text-blue-800 border-blue-200',       icon: Info,        label: 'More Info Needed' },
};

const defaultForm = { patient_id: '', procedure_code: '', procedure_description: '', tooth_number: '', estimated_cost: '' };

export function Preauth() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'submit' | 'history'>('submit');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [preauths, setPreauths] = useState<Preauthorization[]>([]);
  const [form, setForm] = useState(defaultForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchPatients(); fetchPreauths(); }, []);

  const fetchPatients = async () => {
    const { data } = await supabase.from('patients')
      .select('*, insurance_company:insurance_companies(id, name, availity_carrier_id), dental_plan:dental_plans(id, plan_name)')
      .order('last_name, first_name');
    setPatients((data || []) as Patient[]);
    setLoadingPatients(false);
  };

  const fetchPreauths = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('preauthorizations')
      .select('*, patient:patients(first_name, last_name, member_id)')
      .order('created_at', { ascending: false });
    if (error) setError(error.message);
    else setPreauths((data || []) as Preauthorization[]);
    setLoading(false);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.patient_id) errs.patient_id = 'Select a patient';
    if (!form.procedure_code.trim()) errs.procedure_code = 'Procedure code is required';
    else if (!/^D\d{4}$/i.test(form.procedure_code.trim())) errs.procedure_code = 'Use ADA code format (e.g., D0150)';
    if (!form.procedure_description.trim()) errs.procedure_description = 'Description is required';
    if (form.estimated_cost && isNaN(parseFloat(form.estimated_cost))) errs.estimated_cost = 'Must be a number';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const patient = patients.find(p => p.id === form.patient_id);
    if (!patient) return;
    setError(null); setSuccess(null); setSubmitting(true);
    try {
      const apiResult = await callAvailityApi('submit-preauth', {
        memberId: patient.member_id,
        groupNumber: patient.group_number,
        dateOfBirth: patient.date_of_birth,
        lastName: patient.last_name,
        firstName: patient.first_name,
        carrierCode: (patient.insurance_company as any)?.availity_carrier_id,
        procedureCode: form.procedure_code.toUpperCase(),
        procedureDescription: form.procedure_description,
        toothNumber: form.tooth_number || undefined,
        estimatedCost: form.estimated_cost ? parseFloat(form.estimated_cost) : undefined,
      });
      const { error: dbErr } = await supabase.from('preauthorizations').insert([{
        patient_id: patient.id,
        dental_plan_id: patient.dental_plan_id || null,
        procedure_code: form.procedure_code.toUpperCase(),
        procedure_description: form.procedure_description,
        tooth_number: form.tooth_number || null,
        estimated_cost: form.estimated_cost ? parseFloat(form.estimated_cost) : null,
        status: apiResult.status ?? 'pending',
        availity_reference_id: apiResult.referenceId ?? apiResult.reference_id ?? null,
        response_data: apiResult,
        submitted_by: user!.id,
      }]);
      if (dbErr) throw dbErr;
      setSuccess(`Preauthorization submitted! Reference: ${apiResult.referenceId ?? 'Pending'}`);
      setForm(defaultForm);
      fetchPreauths();
      setTab('history');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit preauthorization');
    } finally { setSubmitting(false); }
  };

  const checkStatus = async (preauth: Preauthorization) => {
    if (!preauth.availity_reference_id) { setError('No Availity reference ID available for this preauth.'); return; }
    setCheckingStatus(preauth.id); setError(null);
    try {
      const result = await callAvailityApi('check-preauth-status', { referenceId: preauth.availity_reference_id });
      const newStatus = result.status ?? preauth.status;
      await supabase.from('preauthorizations')
        .update({ status: newStatus, response_data: result, updated_at: new Date().toISOString() })
        .eq('id', preauth.id);
      fetchPreauths();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status check failed');
    } finally { setCheckingStatus(null); }
  };

  const ic = (field: string) =>
    `w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-500 text-sm ${fieldErrors[field] ? 'border-red-400 bg-red-50' : 'border-gray-300'}`;

  const F = ({ label, required, error, hint, children }: { label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {hint && !error && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  );

  const filteredPreauths = preauths.filter(p => {
    const pt = p.patient as any;
    return `${pt?.first_name} ${pt?.last_name} ${pt?.member_id} ${p.procedure_code}`.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1 w-fit">
        {(['submit', 'history'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setError(null); setSuccess(null); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${tab === t ? 'bg-white text-purple-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            {t === 'submit' ? '📋 Submit Preauthorization' : `📂 History (${preauths.length})`}
          </button>
        ))}
      </div>

      {tab === 'submit' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm max-w-lg">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Send className="w-5 h-5 text-purple-600" /> Submit Preauthorization
          </h3>
          <form onSubmit={handleSubmit} className="space-y-3" noValidate>
            <F label="Patient" required error={fieldErrors.patient_id}>
              {loadingPatients ? <p className="text-sm italic text-gray-500 py-1.5">Loading patients...</p> : (
                <select value={form.patient_id} onChange={e => setForm({...form, patient_id: e.target.value})} className={ic('patient_id')}>
                  <option value="">Choose a patient...</option>
                  {patients.map(p => <option key={p.id} value={p.id}>{p.first_name} {p.last_name} ({p.member_id})</option>)}
                </select>
              )}
            </F>
            <F label="Procedure Code (ADA)" required error={fieldErrors.procedure_code} hint="Format: D0150, D1110, D2140…">
              <input type="text" value={form.procedure_code} onChange={e => setForm({...form, procedure_code: e.target.value.toUpperCase()})}
                className={ic('procedure_code')} placeholder="D0150" maxLength={5} />
            </F>
            <F label="Procedure Description" required error={fieldErrors.procedure_description}>
              <input type="text" value={form.procedure_description} onChange={e => setForm({...form, procedure_description: e.target.value})}
                className={ic('procedure_description')} placeholder="e.g., Comprehensive Oral Evaluation" />
            </F>
            <div className="grid grid-cols-2 gap-3">
              <F label="Tooth Number" error={fieldErrors.tooth_number} hint="Optional, e.g. #14">
                <input type="text" value={form.tooth_number} onChange={e => setForm({...form, tooth_number: e.target.value})}
                  className={ic('tooth_number')} placeholder="#14" />
              </F>
              <F label="Estimated Cost ($)" error={fieldErrors.estimated_cost}>
                <input type="number" min={0} step="0.01" value={form.estimated_cost} onChange={e => setForm({...form, estimated_cost: e.target.value})}
                  className={ic('estimated_cost')} placeholder="0.00" />
              </F>
            </div>
            {error && <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg"><AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" /><p className="text-sm text-red-700">{error}</p></div>}
            {success && <div className="flex items-start gap-2 p-3 bg-green-50 border border-green-200 rounded-lg"><CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" /><p className="text-sm text-green-700">{success}</p></div>}
            <button type="submit" disabled={submitting}
              className="w-full bg-purple-600 text-white py-2.5 rounded-lg hover:bg-purple-700 disabled:bg-gray-400 font-medium transition flex items-center justify-center gap-2 text-sm">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" />Submitting to Availity...</> : <><Send className="w-4 h-4" />Submit Preauthorization to Availity</>}
            </button>
          </form>
        </div>
      )}

      {tab === 'history' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-gray-500" /> Preauthorization History
            </h3>
            <button onClick={fetchPreauths} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </div>
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by patient name or procedure code..." className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
          </div>
          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-3"><AlertCircle className="w-4 h-4 text-red-600 shrink-0" /><p className="text-sm text-red-700">{error}</p></div>}
          {loading ? (
            <div className="flex items-center justify-center py-8 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>
          ) : filteredPreauths.length === 0 ? (
            <div className="text-center py-8 text-gray-500"><FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" /><p>{search ? 'No results match your search.' : 'No preauthorizations submitted yet.'}</p></div>
          ) : (
            <div className="space-y-3">
              {filteredPreauths.map(pa => {
                const cfg = STATUS_CONFIG[pa.status] ?? STATUS_CONFIG.pending;
                const StatusIcon = cfg.icon;
                const pt = pa.patient as any;
                return (
                  <div key={pa.id} className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium text-gray-900 text-sm">{pa.procedure_code} — {pa.procedure_description}</p>
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.color}`}>
                            <StatusIcon className="w-3 h-3" />{cfg.label}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Patient: {pt?.first_name} {pt?.last_name} ({pt?.member_id})
                          {pa.tooth_number && ` · Tooth ${pa.tooth_number}`}
                          {pa.estimated_cost && ` · Est. $${pa.estimated_cost.toLocaleString()}`}
                        </p>
                        {pa.availity_reference_id && (
                          <p className="text-xs text-gray-400 mt-0.5">Ref: {pa.availity_reference_id}</p>
                        )}
                        <p className="text-xs text-gray-400">{new Date(pa.created_at).toLocaleString()}</p>
                      </div>
                      <button onClick={() => checkStatus(pa)} disabled={checkingStatus === pa.id}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 rounded-lg hover:bg-gray-100 transition disabled:opacity-50">
                        {checkingStatus === pa.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                        Status
                      </button>
                    </div>
                    {pa.response_data && (
                      <details className="mt-2">
                        <summary className="text-xs text-blue-600 cursor-pointer hover:underline">View API response</summary>
                        <pre className="mt-1 p-2 bg-gray-50 rounded text-xs text-gray-600 overflow-auto max-h-32">{JSON.stringify(pa.response_data, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
