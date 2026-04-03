import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, CheckCircle, AlertCircle, Loader2, FileText } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { DentalPlan, InsuranceCompany } from '../types';
import { useAuth } from '../hooks/useAuth';

const defaultForm = {
  insurance_company_id: '', plan_name: '', plan_id: '',
  coverage_type: 'comprehensive' as 'basic' | 'standard' | 'comprehensive',
  deductible: 0, annual_max: 1200,
  preventive_coverage: 100, basic_coverage: 80, major_coverage: 50,
};

export function Plans() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<DentalPlan[]>([]);
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => { fetchCompanies(); fetchPlans(); }, []);

  const fetchCompanies = async () => {
    setLoadingCompanies(true);
    const { data } = await supabase.from('insurance_companies').select('*').eq('is_active', true).order('name');
    setCompanies(data || []);
    setLoadingCompanies(false);
  };

  const fetchPlans = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('dental_plans')
      .select('*, insurance_company:insurance_companies(name, availity_carrier_id)')
      .eq('is_active', true).order('plan_name');
    if (error) setError(error.message);
    else setPlans((data || []) as DentalPlan[]);
    setLoading(false);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.insurance_company_id) errs.insurance_company_id = 'Select an insurance company';
    if (!form.plan_name.trim()) errs.plan_name = 'Plan name is required';
    if (!form.plan_id.trim()) errs.plan_id = 'Plan ID is required';
    if (form.annual_max <= 0) errs.annual_max = 'Annual max must be greater than 0';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setError(null); setSuccess(false); setSubmitting(true);
    try {
      const payload = { ...form, is_active: true, created_by: user!.id };
      if (editId) {
        const { error } = await supabase.from('dental_plans').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('dental_plans').insert([payload]);
        if (error) throw error;
      }
      setSuccess(true); setForm(defaultForm); setEditId(null); fetchPlans();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save plan');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this plan?')) return;
    await supabase.from('dental_plans').update({ is_active: false }).eq('id', id);
    fetchPlans();
  };

  const startEdit = (p: DentalPlan) => {
    setEditId(p.id);
    setForm({ insurance_company_id: p.insurance_company_id, plan_name: p.plan_name, plan_id: p.plan_id,
      coverage_type: p.coverage_type, deductible: p.deductible, annual_max: p.annual_max,
      preventive_coverage: p.preventive_coverage, basic_coverage: p.basic_coverage, major_coverage: p.major_coverage });
    setFieldErrors({}); setError(null);
  };

  const Field = ({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );

  const inputClass = (field: string) =>
    `w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldErrors[field] ? 'border-red-400 bg-red-50' : 'border-gray-300'}`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" />
          {editId ? 'Edit Dental Plan' : 'Add Dental Plan'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <Field label="Insurance Company" required error={fieldErrors.insurance_company_id}>
            {loadingCompanies ? <p className="text-sm text-gray-500 italic py-2">Loading companies...</p> : (
              <select value={form.insurance_company_id} onChange={e => setForm({...form, insurance_company_id: e.target.value})}
                className={inputClass('insurance_company_id')}>
                <option value="">Select a company...</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Plan Name" required error={fieldErrors.plan_name}>
              <input type="text" value={form.plan_name} onChange={e => setForm({...form, plan_name: e.target.value})}
                className={inputClass('plan_name')} placeholder="e.g., Dental Premium" />
            </Field>
            <Field label="Plan ID" required error={fieldErrors.plan_id}>
              <input type="text" value={form.plan_id} onChange={e => setForm({...form, plan_id: e.target.value})}
                className={inputClass('plan_id')} placeholder="e.g., PLAN001" />
            </Field>
          </div>
          <Field label="Coverage Type">
            <select value={form.coverage_type} onChange={e => setForm({...form, coverage_type: e.target.value as typeof form.coverage_type})}
              className={inputClass('coverage_type')}>
              <option value="basic">Basic</option>
              <option value="standard">Standard</option>
              <option value="comprehensive">Comprehensive</option>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deductible ($)" error={fieldErrors.deductible}>
              <input type="number" min={0} value={form.deductible} onChange={e => setForm({...form, deductible: Number(e.target.value)})}
                className={inputClass('deductible')} />
            </Field>
            <Field label="Annual Max ($)" required error={fieldErrors.annual_max}>
              <input type="number" min={0} value={form.annual_max} onChange={e => setForm({...form, annual_max: Number(e.target.value)})}
                className={inputClass('annual_max')} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[['Preventive %', 'preventive_coverage'], ['Basic %', 'basic_coverage'], ['Major %', 'major_coverage']].map(([label, field]) => (
              <Field key={field} label={label}>
                <input type="number" min={0} max={100} value={form[field as keyof typeof form] as number}
                  onChange={e => setForm({...form, [field]: Number(e.target.value)})}
                  className={inputClass(field)} />
              </Field>
            ))}
          </div>
          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg"><AlertCircle className="w-4 h-4 text-red-600 shrink-0" /><p className="text-sm text-red-700">{error}</p></div>}
          {success && <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg"><CheckCircle className="w-4 h-4 text-green-600 shrink-0" /><p className="text-sm text-green-700">Plan saved!</p></div>}
          <div className="flex gap-2">
            <button type="submit" disabled={submitting} className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium transition flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Saving...' : editId ? 'Update Plan' : 'Add Plan'}
            </button>
            {editId && <button type="button" onClick={() => { setEditId(null); setForm(defaultForm); setFieldErrors({}); }} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition">Cancel</button>}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-gray-500" /> Dental Plans ({plans.length})
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>
        ) : plans.length === 0 ? (
          <div className="text-center py-8 text-gray-500"><FileText className="w-10 h-10 mx-auto mb-2 text-gray-300" /><p>No plans added yet.</p></div>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {plans.map(p => (
              <div key={p.id} className="p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{p.plan_name}</p>
                    <p className="text-xs text-gray-500">{p.insurance_company?.name} · {p.plan_id}</p>
                    <div className="flex gap-3 mt-1 text-xs text-gray-600">
                      <span>Prev: {p.preventive_coverage}%</span>
                      <span>Basic: {p.basic_coverage}%</span>
                      <span>Major: {p.major_coverage}%</span>
                      <span>Max: ${p.annual_max.toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0 ml-2">
                    <button onClick={() => startEdit(p)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={() => handleDelete(p.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
