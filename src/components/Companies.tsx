import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit2, CheckCircle, AlertCircle, Loader2, Building2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { InsuranceCompany } from '../types';
import { useAuth } from '../hooks/useAuth';

export function Companies() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<InsuranceCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', availity_carrier_id: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => { fetchCompanies(); }, []);

  const fetchCompanies = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('insurance_companies')
      .select('*')
      .eq('is_active', true)
      .order('name');
    if (error) setError(error.message);
    else setCompanies(data || []);
    setLoading(false);
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = 'Company name is required';
    if (!form.availity_carrier_id.trim()) errs.availity_carrier_id = 'Availity Carrier ID is required';
    else if (!/^[A-Z0-9_-]+$/i.test(form.availity_carrier_id)) errs.availity_carrier_id = 'Use only letters, numbers, underscores, hyphens';
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setError(null); setSuccess(false); setSubmitting(true);
    try {
      if (editId) {
        const { error } = await supabase.from('insurance_companies')
          .update({ name: form.name, availity_carrier_id: form.availity_carrier_id.toUpperCase() })
          .eq('id', editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('insurance_companies')
          .insert([{ name: form.name, availity_carrier_id: form.availity_carrier_id.toUpperCase(), is_active: true, created_by: user!.id }]);
        if (error) throw error;
      }
      setSuccess(true);
      setForm({ name: '', availity_carrier_id: '' });
      setEditId(null);
      fetchCompanies();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save company');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deactivate this company? Associated plans will also be hidden.')) return;
    const { error } = await supabase.from('insurance_companies').update({ is_active: false }).eq('id', id);
    if (error) setError(error.message);
    else fetchCompanies();
  };

  const startEdit = (c: InsuranceCompany) => {
    setEditId(c.id);
    setForm({ name: c.name, availity_carrier_id: c.availity_carrier_id });
    setFieldErrors({});
    setError(null);
  };

  const cancelEdit = () => { setEditId(null); setForm({ name: '', availity_carrier_id: '' }); setFieldErrors({}); };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Plus className="w-5 h-5 text-blue-600" />
          {editId ? 'Edit Insurance Company' : 'Add Insurance Company'}
        </h3>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} onChange={e => setForm({...form, name: e.target.value})}
              className={`w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 ${fieldErrors.name ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
              placeholder="e.g., Aetna, BlueCross, UnitedHealthcare" />
            {fieldErrors.name && <p className="text-xs text-red-600 mt-1">{fieldErrors.name}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Availity Carrier ID <span className="text-red-500">*</span></label>
            <input type="text" value={form.availity_carrier_id} onChange={e => setForm({...form, availity_carrier_id: e.target.value.toUpperCase()})}
              className={`w-full px-3 py-2 border rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono ${fieldErrors.availity_carrier_id ? 'border-red-400 bg-red-50' : 'border-gray-300'}`}
              placeholder="e.g., AETNA, BCBS, UHC" />
            {fieldErrors.availity_carrier_id && <p className="text-xs text-red-600 mt-1">{fieldErrors.availity_carrier_id}</p>}
            <p className="text-xs text-gray-500 mt-1">This exact code is used when calling the Availity API.</p>
          </div>
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle className="w-4 h-4 text-green-600 shrink-0" />
              <p className="text-sm text-green-700">{editId ? 'Company updated!' : 'Company added successfully!'}</p>
            </div>
          )}
          <div className="flex gap-2">
            <button type="submit" disabled={submitting}
              className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 font-medium transition flex items-center justify-center gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Saving...' : editId ? 'Update Company' : 'Add Company'}
            </button>
            {editId && (
              <button type="button" onClick={cancelEdit}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Building2 className="w-5 h-5 text-gray-500" />
          Insurance Companies ({companies.length})
        </h3>
        {loading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
          </div>
        ) : companies.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Building2 className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p>No companies added yet.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {companies.map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg hover:bg-gray-50">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{c.name}</p>
                  <p className="text-xs text-gray-500 font-mono mt-0.5">Carrier ID: {c.availity_carrier_id}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <button onClick={() => startEdit(c)} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button onClick={() => handleDelete(c.id)} className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
