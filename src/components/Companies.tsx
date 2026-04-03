import { useState, useEffect } from 'react';
import { Plus, Building2, Trash2, Edit2, CheckCircle, AlertCircle, ChevronDown, ChevronUp, Loader2, Download } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { InsuranceCompany } from '../types';

const PRESET_COMPANIES = [
  { name: 'Aetna',                       availity_carrier_id: 'AETNA' },
  { name: 'Delta Dental',                availity_carrier_id: 'DDPA' },
  { name: 'Cigna',                       availity_carrier_id: 'CIGNA' },
  { name: 'United Healthcare',           availity_carrier_id: 'UHC' },
  { name: 'BlueCross BlueShield',        availity_carrier_id: 'BCBS' },
  { name: 'Humana',                      availity_carrier_id: 'HUMANA' },
  { name: 'Guardian',                    availity_carrier_id: 'GARD' },
  { name: 'MetLife',                     availity_carrier_id: 'METLF' },
  { name: 'Ameritas',                    availity_carrier_id: 'AMTSL' },
  { name: 'Sun Life Financial',          availity_carrier_id: 'SUNLF' },
  { name: 'Principal Financial Group',   availity_carrier_id: 'PRINC' },
  { name: 'Lincoln Financial',           availity_carrier_id: 'LNCLN' },
  { name: 'United Concordia',            availity_carrier_id: 'UCDEN' },
  { name: 'Anthem',                      availity_carrier_id: 'ANTM' },
  { name: 'Assurant',                    availity_carrier_id: 'ASSUR' },
  { name: 'Renaissance Dental',          availity_carrier_id: 'RENAI' },
  { name: 'Careington',                  availity_carrier_id: 'CARING' },
  { name: 'Spirit Dental',               availity_carrier_id: 'SPRT' },
  { name: 'Physicians Mutual',           availity_carrier_id: 'PHYMUT' },
  { name: 'Connection Dental',           availity_carrier_id: 'CNXDNT' },
];

export function Companies() {
  const [companies, setCompanies]     = useState<InsuranceCompany[]>([]);
  const [loading, setLoading]         = useState(true);
  const [seeding, setSeeding]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [success, setSuccess]         = useState('');
  const [error, setError]             = useState('');
  const [showForm, setShowForm]       = useState(false);
  const [editId, setEditId]           = useState<string | null>(null);
  const [form, setForm]               = useState({ name: '', availity_carrier_id: '' });

  useEffect(() => { fetchCompanies(); }, []);

  const fetchCompanies = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('insurance_companies')
      .select('*')
      .order('name');
    if (!error) setCompanies(data ?? []);
    setLoading(false);
  };

  const flash = (msg: string, type: 'ok' | 'err') => {
    if (type === 'ok') { setSuccess(msg); setError(''); setTimeout(() => setSuccess(''), 4000); }
    else               { setError(msg);   setSuccess(''); }
  };

  const seedPresets = async () => {
    setSeeding(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { flash('You must be logged in.', 'err'); setSeeding(false); return; }

    const existing = companies.map(c => c.name.toLowerCase());
    const toAdd = PRESET_COMPANIES.filter(p => !existing.includes(p.name.toLowerCase()));
    if (!toAdd.length) { flash('All standard companies are already in your list!', 'ok'); setSeeding(false); return; }

    const rows = toAdd.map(p => ({ ...p, is_active: true, created_by: user.id }));
    const { error } = await supabase.from('insurance_companies').insert(rows);
    if (error) flash(error.message, 'err');
    else { flash(`✅ Added ${toAdd.length} insurance companies!`, 'ok'); fetchCompanies(); }
    setSeeding(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.availity_carrier_id.trim()) { flash('Both fields are required.', 'err'); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { flash('You must be logged in.', 'err'); setSaving(false); return; }

    if (editId) {
      const { error } = await supabase.from('insurance_companies').update({
        name: form.name.trim(),
        availity_carrier_id: form.availity_carrier_id.trim().toUpperCase(),
      }).eq('id', editId);
      if (error) flash(error.message, 'err');
      else { flash('Company updated!', 'ok'); resetForm(); fetchCompanies(); }
    } else {
      const { error } = await supabase.from('insurance_companies').insert({
        name: form.name.trim(),
        availity_carrier_id: form.availity_carrier_id.trim().toUpperCase(),
        is_active: true,
        created_by: user.id,
      });
      if (error) flash(error.message, 'err');
      else { flash('Company added!', 'ok'); resetForm(); fetchCompanies(); }
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this company?')) return;
    const { error } = await supabase.from('insurance_companies').delete().eq('id', id);
    if (error) flash(error.message, 'err');
    else { flash('Deleted.', 'ok'); fetchCompanies(); }
  };

  const startEdit = (c: InsuranceCompany) => {
    setEditId(c.id);
    setForm({ name: c.name, availity_carrier_id: c.availity_carrier_id });
    setShowForm(true);
  };

  const resetForm = () => {
    setEditId(null);
    setForm({ name: '', availity_carrier_id: '' });
    setShowForm(false);
  };

  return (
    <div className="space-y-4">
      {/* Alerts */}
      {success && <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm"><CheckCircle className="w-4 h-4 shrink-0"/>{success}</div>}
      {error   && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm"><AlertCircle className="w-4 h-4 shrink-0"/>{error}</div>}

      {/* Action bar */}
      <div className="flex flex-wrap gap-2">
        <button onClick={seedPresets} disabled={seeding}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition disabled:opacity-60">
          {seeding ? <Loader2 className="w-4 h-4 animate-spin"/> : <Download className="w-4 h-4"/>}
          {seeding ? 'Adding…' : 'Load All Standard Companies'}
        </button>
        <button onClick={() => { resetForm(); setShowForm(s => !s); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition">
          <Plus className="w-4 h-4"/>
          Add Custom Company
          {showForm && !editId ? <ChevronUp className="w-4 h-4"/> : <ChevronDown className="w-4 h-4"/>}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl p-5 space-y-4 shadow-sm">
          <h3 className="font-semibold text-gray-900">{editId ? 'Edit Company' : 'Add Custom Company'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Aetna" required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Availity Carrier ID</label>
              <input value={form.availity_carrier_id}
                onChange={e => setForm(f => ({ ...f, availity_carrier_id: e.target.value.toUpperCase() }))}
                placeholder="e.g., AETNA" required
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"/>
              <p className="text-xs text-gray-400 mt-1">The code Availity uses to identify this carrier</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : null}
              {saving ? 'Saving…' : editId ? 'Save Changes' : 'Add Company'}
            </button>
            <button type="button" onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition">Cancel</button>
          </div>
        </form>
      )}

      {/* Companies List */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-600"/>
            Insurance Companies
            <span className="ml-1 px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded-full font-medium">{companies.length}</span>
          </h3>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-blue-600"/></div>
        ) : companies.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30"/>
            <p className="font-medium text-gray-500">No companies yet</p>
            <p className="text-sm mt-1">Click "Load All Standard Companies" to add 20 major insurers instantly</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {companies.map(c => (
              <div key={c.id} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 transition">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-blue-600"/>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{c.name}</p>
                    <p className="text-xs text-gray-400 font-mono">Availity ID: <span className="text-blue-600 font-semibold">{c.availity_carrier_id}</span></p>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${c.is_active ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {c.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={() => startEdit(c)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition"><Edit2 className="w-3.5 h-3.5"/></button>
                  <button onClick={() => handleDelete(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"><Trash2 className="w-3.5 h-3.5"/></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
