import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, CheckCircle, AlertCircle, Loader2, Users, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Patient, InsuranceCompany, DentalPlan } from '../types';
import { useAuth } from '../hooks/useAuth';

const defaultForm = {
  first_name: '', last_name: '', date_of_birth: '', member_id: '',
  group_number: '', insurance_company_id: '', dental_plan_id: '',
  ssn_last4: '', email: '', phone: '',
};

export function Patients() {
  const { user } = useAuth();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [plans, setPlans] = useState<DentalPlan[]>([]);
  const [filteredPlans, setFilteredPlans] = useState<DentalPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  useEffect(() => { fetchRefs(); fetchPatients(); }, []);

  useEffect(() => {
    setFilteredPlans(form.insurance_company_id ? plans.filter(p => p.insurance_company_id === form.insurance_company_id) : []);
    if (form.dental_plan_id) {
      const planStillValid = plans.find(p => p.id === form.dental_plan_id && p.insurance_company_id === form.insurance_company_id);
      if (!planStillValid) setForm(f => ({ ...f, dental_plan_id: '' }));
    }
  }, [form.insurance_company_id, plans]);

  const fetchRefs = async () => {
    setLoadingRefs(true);
    const [{ data: cs }, { data: ps }] = await Promise.all([
      supabase.from('insurance_companies').select('*').eq('is_active', true).order('name'),
      supabase.from('dental_plans').select('*').eq('is_active', true).order('plan_name'),
    ]);
    setCompanies(cs || []);
    setPlans(ps || []);
    setLoadingRefs(false);
  };

  const fetchPatients = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('patients')
      .select('*, insurance_company:insurance_companies(name), dental_plan:dental_plans(plan_name)')
      .order('last_name, first_name');
    if (error) setError(error.message);
    else setPatients((data || []) as Patient[]);
    setLoading(false);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.first_name.trim()) errs.first_name = 'Required';
    if (!form.last_name.trim()) errs.last_name = 'Required';
    if (!form.date_of_birth) errs.date_of_birth = 'Date of birth is required';
    if (!form.member_id.trim()) errs.member_id = 'Member ID is required';
    if (!form.insurance_company_id) errs.insurance_company_id = 'Select an insurance company';
    if (form.ssn_last4 && !/^\d{4}$/.test(form.ssn_last4)) errs.ssn_last4 = 'Must be exactly 4 digits';
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) errs.email = 'Invalid email address';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setError(null); setSuccess(false); setSubmitting(true);
    try {
      const payload = {
        first_name: form.first_name, last_name: form.last_name,
        date_of_birth: form.date_of_birth, member_id: form.member_id,
        group_number: form.group_number || null,
        insurance_company_id: form.insurance_company_id,
        dental_plan_id: form.dental_plan_id || null,
        ssn_last4: form.ssn_last4 || null,
        email: form.email || null, phone: form.phone || null,
        created_by: user!.id,
      };
      if (editId) {
        const { error } = await supabase.from('patients').update(payload).eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('patients').insert([payload]);
        if (error) throw error;
      }
      setSuccess(true); setForm(defaultForm); setEditId(null); fetchPatients();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save patient');
    } finally { setSubmitting(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this patient record?')) return;
    await supabase.from('patients').delete().eq('id', id);
    fetchPatients();
  };

  const startEdit = (p: Patient) => {
    setEditId(p.id);
    setForm({ first_name: p.first_name, last_name: p.last_name, date_of_birth: p.date_of_birth,
      member_id: p.member_id, group_number: p.group_number || '', insurance_company_id: p.insurance_company_id,
      dental_plan_id: p.dental_plan_id || '', ssn_last4: p.ssn_last4 || '',
      email: p.email || '', phone: p.phone || '' });
    setFieldErrors({}); setError(null);
  };

  const ic = (field: string) =>
    `w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm ${fieldErrors[field] ? 'border-red-400 bg-red-50' : 'border-gray-300'}`;

  const F = ({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: React.ReactNode }) => (
    <div>
      <label className="block text-xs font-medium text-gray-700 mb-1">{label}{required && <span className="text-red-500"> *</span>}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-0.5">{error}</p>}
    </div>
  );

  const filtered = patients.filter(p =>
    `${p.first_name} ${p.last_name} ${p.member_id}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" />
          {editId ? 'Edit Patient' : 'Add Patient'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-3" noValidate>
          <div className="grid grid-cols-2 gap-3">
            <F label="First Name" required error={fieldErrors.first_name}>
              <input type="text" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} className={ic('first_name')} placeholder="Jane" />
            </F>
            <F label="Last Name" required error={fieldErrors.last_name}>
              <input type="text" value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} className={ic('last_name')} placeholder="Doe" />
            </F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Date of Birth" required error={fieldErrors.date_of_birth}>
              <input type="date" value={form.date_of_birth} onChange={e => setForm({...form, date_of_birth: e.target.value})} className={ic('date_of_birth')} />
            </F>
            <F label="Member ID" required error={fieldErrors.member_id}>
              <input type="text" value={form.member_id} onChange={e => setForm({...form, member_id: e.target.value})} className={ic('member_id')} placeholder="MBR123456" />
            </F>
          </div>
          <F label="Group Number" error={fieldErrors.group_number}>
            <input type="text" value={form.group_number} onChange={e => setForm({...form, group_number: e.target.value})} className={ic('group_number')} placeholder="GRP001 (optional)" />
          </F>
          <F label="Insurance Company" required error={fieldErrors.insurance_company_id}>
            {loadingRefs ? <p className="text-sm text-gray-500 italic py-1.5">Loading companies...</p> : (
              <select value={form.insurance_company_id} onChange={e => setForm({...form, insurance_company_id: e.target.value, dental_plan_id: ''})} className={ic('insurance_company_id')}>
                <option value="">Select company...</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </F>
          {form.insurance_company_id && (
            <F label="Dental Plan (optional)" error={fieldErrors.dental_plan_id}>
              <select value={form.dental_plan_id} onChange={e => setForm({...form, dental_plan_id: e.target.value})} className={ic('dental_plan_id')}>
                <option value="">No specific plan</option>
                {filteredPlans.map(p => <option key={p.id} value={p.id}>{p.plan_name} ({p.plan_id})</option>)}
              </select>
              {filteredPlans.length === 0 && <p className="text-xs text-amber-600 mt-0.5">No plans found for this company. Add plans first.</p>}
            </F>
          )}
          <div className="grid grid-cols-2 gap-3">
            <F label="SSN Last 4" error={fieldErrors.ssn_last4}>
              <input type="text" maxLength={4} value={form.ssn_last4} onChange={e => setForm({...form, ssn_last4: e.target.value.replace(/\D/g, '')})} className={ic('ssn_last4')} placeholder="1234" />
            </F>
            <F label="Phone" error={fieldErrors.phone}>
              <input type="tel" value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className={ic('phone')} placeholder="123-456-7890" />
            </F>
          </div>
          <F label="Email" error={fieldErrors.email}>
            <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className={ic('email')} placeholder="patient@example.com (optional)" />
          </F>
          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg"><AlertCircle className="w-4 h-4 text-red-600 shrink-0" /><p className="text-sm text-red-700">{error}</p></div>}
          {success && <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg"><CheckCircle className="w-4 h-4 text-green-600 shrink-0" /><p className="text-sm text-green-700">Patient saved!</p></div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={submitting} className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium transition flex items-center justify-center gap-2 text-sm">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Saving...' : editId ? 'Update Patient' : 'Add Patient'}
            </button>
            {editId && <button type="button" onClick={() => { setEditId(null); setForm(defaultForm); setFieldErrors({}); }} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition text-sm">Cancel</button>}
          </div>
        </form>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Users className="w-5 h-5 text-gray-500" /> Patients ({filtered.length})
          </h3>
        </div>
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or member ID..." className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-8 text-gray-500"><Users className="w-10 h-10 mx-auto mb-2 text-gray-300" /><p>{search ? 'No patients match your search.' : 'No patients added yet.'}</p></div>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {filtered.map(p => (
              <div key={p.id} className="flex items-start justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 text-sm">{p.first_name} {p.last_name}</p>
                  <p className="text-xs text-gray-500">Member: {p.member_id} · DOB: {p.date_of_birth}</p>
                  <p className="text-xs text-gray-400 truncate">{p.insurance_company?.name}{p.dental_plan ? ` · ${p.dental_plan.plan_name}` : ''}</p>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button onClick={() => startEdit(p)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition"><Edit2 className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleDelete(p.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
