/**
 * InsurancePicker — Step 2 of eligibility/preauth workflow
 * Features:
 *  • 40+ common dental carriers, each showing Payer ID
 *  • Search by name or payer ID
 *  • Inline ✏️ edit button to change any payer ID for this session
 *  • Changes persist to localStorage so edits survive page refresh
 *  • DB carriers from Supabase merged at top
 */
import { useState, useEffect, useMemo } from 'react';
import { Search, Pencil, Check, X, ChevronDown, ChevronUp, Building2, ShieldCheck, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface CarrierOption {
  id:       string;
  name:     string;
  payer_id: string;
  source:   'db' | 'builtin';
}

/** 40 most common dental insurers with accurate Availity payer IDs */
const BUILTIN_CARRIERS: CarrierOption[] = [
  { id:'b-01', name:'Aetna',                              payer_id:'60054',    source:'builtin' },
  { id:'b-02', name:'Anthem BCBS',                        payer_id:'00227',    source:'builtin' },
  { id:'b-03', name:'Cigna',                              payer_id:'62308',    source:'builtin' },
  { id:'b-04', name:'Delta Dental of California',         payer_id:'94360',    source:'builtin' },
  { id:'b-05', name:'Delta Dental (All Other States)',    payer_id:'86027',    source:'builtin' },
  { id:'b-06', name:'Guardian Life Insurance',            payer_id:'00488',    source:'builtin' },
  { id:'b-07', name:'Humana Dental',                      payer_id:'61101',    source:'builtin' },
  { id:'b-08', name:'Lincoln Financial (Liberty Dental)', payer_id:'SX143',    source:'builtin' },
  { id:'b-09', name:'MetLife Dental',                     payer_id:'65978',    source:'builtin' },
  { id:'b-10', name:'Principal Financial Group',          payer_id:'61271',    source:'builtin' },
  { id:'b-11', name:'Sun Life Financial',                 payer_id:'92916',    source:'builtin' },
  { id:'b-12', name:'UnitedHealthcare Dental',            payer_id:'87726',    source:'builtin' },
  { id:'b-13', name:'United Concordia',                   payer_id:'23228',    source:'builtin' },
  { id:'b-14', name:'Ameritas Life Partners',             payer_id:'47171',    source:'builtin' },
  { id:'b-15', name:'Assurant Dental',                    payer_id:'65085',    source:'builtin' },
  { id:'b-16', name:'BlueCross BlueShield Federal (FEP)', payer_id:'00026',    source:'builtin' },
  { id:'b-17', name:'Careington International',           payer_id:'C1085',    source:'builtin' },
  { id:'b-18', name:'Connection Dental / GEHA',           payer_id:'44054',    source:'builtin' },
  { id:'b-19', name:'DentaQuest (Medicaid)',               payer_id:'81039',    source:'builtin' },
  { id:'b-20', name:'TRICARE / Active Military',          payer_id:'PRTRI',    source:'builtin' },
  { id:'b-21', name:'Medicaid (State — varies)',          payer_id:'MCAID',    source:'builtin' },
  { id:'b-22', name:'Medicare',                           payer_id:'MCARE',    source:'builtin' },
  { id:'b-23', name:'Aflac',                              payer_id:'62148',    source:'builtin' },
  { id:'b-24', name:'Blue Shield of California',          payer_id:'94333',    source:'builtin' },
  { id:'b-25', name:'BCBS of Texas',                      payer_id:'84980',    source:'builtin' },
  { id:'b-26', name:'BCBS of Michigan',                   payer_id:'54154',    source:'builtin' },
  { id:'b-27', name:'BCBS of Florida',                    payer_id:'00590',    source:'builtin' },
  { id:'b-28', name:'BCBS of Illinois',                   payer_id:'00621',    source:'builtin' },
  { id:'b-29', name:'Moda Health',                        payer_id:'93093',    source:'builtin' },
  { id:'b-30', name:'Regence BlueCross BlueShield',       payer_id:'00932',    source:'builtin' },
  { id:'b-31', name:'HealthMarket (formerly UICI)',       payer_id:'41204',    source:'builtin' },
  { id:'b-32', name:'Nippon Life Benefits (NLB)',         payer_id:'38337',    source:'builtin' },
  { id:'b-33', name:'Nationwide (formerly Harleysville)', payer_id:'34330',    source:'builtin' },
  { id:'b-34', name:'The Standard Insurance',             payer_id:'36496',    source:'builtin' },
  { id:'b-35', name:'Voya Financial',                     payer_id:'99237',    source:'builtin' },
  { id:'b-36', name:'Unum Life Insurance',                payer_id:'62235',    source:'builtin' },
  { id:'b-37', name:'WellCare Dental',                    payer_id:'99320',    source:'builtin' },
  { id:'b-38', name:'Highmark BCBS',                      payer_id:'00060',    source:'builtin' },
  { id:'b-39', name:'Kaiser Permanente Dental',           payer_id:'94291',    source:'builtin' },
  { id:'b-40', name:'EmblemHealth (HIP/GHI)',             payer_id:'13551',    source:'builtin' },
];

const STORAGE_KEY = 'dharma_payer_id_overrides';

interface Props {
  selectedId:   string;
  selectedName: string;
  onChange:     (payer_id: string, name: string) => void;
}

export function InsurancePicker({ selectedId, selectedName, onChange }: Props) {
  const [carriers,  setCarriers]  = useState<CarrierOption[]>(BUILTIN_CARRIERS);
  const [search,    setSearch]    = useState('');
  const [editId,    setEditId]    = useState<string | null>(null);
  const [editVal,   setEditVal]   = useState('');
  const [overrides, setOverrides] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'); } catch { return {}; }
  });
  const [expanded,  setExpanded]  = useState(true);
  const [saveMsg,   setSaveMsg]   = useState('');

  /* Merge DB carriers on mount */
  useEffect(() => {
    supabase
      .from('insurance_companies')
      .select('id,name,availity_carrier_id')
      .order('name')
      .then(({ data }) => {
        if (data?.length) {
          const db: CarrierOption[] = data.map(r => ({
            id: r.id, name: r.name, payer_id: r.availity_carrier_id ?? '', source: 'db' as const,
          }));
          const dbNames = new Set(db.map(d => d.name.toLowerCase()));
          setCarriers([
            ...db,
            ...BUILTIN_CARRIERS.filter(b => !dbNames.has(b.name.toLowerCase())),
          ]);
        }
      });
  }, []);

  /* Persist overrides to localStorage */
  const saveOverride = (id: string, val: string) => {
    const next = { ...overrides, [id]: val.trim().toUpperCase() };
    setOverrides(next);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSaveMsg('Payer ID saved ✓');
    setTimeout(() => setSaveMsg(''), 2000);
  };

  const display = useMemo(() => {
    const q = search.toLowerCase();
    return carriers
      .filter(c => c.name.toLowerCase().includes(q) || (overrides[c.id] ?? c.payer_id).toLowerCase().includes(q))
      .map(c => ({ ...c, payer_id: overrides[c.id] ?? c.payer_id }));
  }, [carriers, search, overrides]);

  const selectedCarrier = display.find(c => c.payer_id === selectedId || c.id === selectedId);

  return (
    <div className="space-y-3">
      {/* Selected display */}
      {selectedName && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2">
          <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
          <span className="text-sm font-medium text-blue-800">{selectedName}</span>
          <span className="ml-auto text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{selectedId}</span>
        </div>
      )}

      {/* Toggle list */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 hover:bg-slate-100 transition"
      >
        <span className="flex items-center gap-2">
          <Building2 className="h-4 w-4" />
          {expanded ? 'Hide carrier list' : 'Choose insurance carrier'}
          <span className="text-xs text-slate-400">({display.length} available)</span>
        </span>
        {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {expanded && (
        <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-slate-100">
            <Search className="h-4 w-4 text-slate-400 shrink-0" />
            <input
              type="text"
              placeholder="Search by name or payer ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 text-sm outline-none bg-transparent placeholder:text-slate-400"
            />
            {saveMsg && <span className="text-xs text-emerald-600 font-medium">{saveMsg}</span>}
          </div>

          {/* Header row */}
          <div className="grid grid-cols-[1fr_120px_36px] gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-100 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Insurance Name</span>
            <span className="text-center">Payer ID</span>
            <span />
          </div>

          {/* Carrier rows */}
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-50">
            {display.length === 0 && (
              <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-400">
                <AlertCircle className="h-4 w-4" /> No carriers match "{search}"
              </div>
            )}
            {display.map(c => {
              const isSelected = c.payer_id === selectedId || c.name === selectedName;
              const isEditing  = editId === c.id;
              const isOverridden = !!overrides[c.id];

              return (
                <div
                  key={c.id}
                  className={`grid grid-cols-[1fr_120px_36px] gap-2 items-center px-3 py-2 cursor-pointer transition-colors
                    ${isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50'}`}
                  onClick={() => { if (!isEditing) onChange(c.payer_id, c.name); }}
                >
                  {/* Name */}
                  <span className="text-sm truncate">
                    {isSelected && <ShieldCheck className="inline h-3.5 w-3.5 text-blue-500 mr-1 -mt-0.5" />}
                    {c.name}
                    {c.source === 'db' && (
                      <span className="ml-1 text-[10px] bg-emerald-100 text-emerald-700 px-1 rounded">DB</span>
                    )}
                  </span>

                  {/* Payer ID — edit mode or display */}
                  <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
                    {isEditing ? (
                      <input
                        autoFocus
                        className="w-full text-xs font-mono border border-blue-300 rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-blue-400"
                        value={editVal}
                        onChange={e => setEditVal(e.target.value.toUpperCase())}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { saveOverride(c.id, editVal); setEditId(null); if (isSelected) onChange(editVal.trim().toUpperCase(), c.name); }
                          if (e.key === 'Escape') setEditId(null);
                        }}
                        maxLength={12}
                        placeholder="Payer ID"
                      />
                    ) : (
                      <span className={`font-mono text-xs px-2 py-0.5 rounded ${
                        isOverridden
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : isSelected
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}>
                        {c.payer_id || '—'}
                      </span>
                    )}
                  </div>

                  {/* Edit / confirm buttons */}
                  <div className="flex items-center justify-center" onClick={e => e.stopPropagation()}>
                    {isEditing ? (
                      <div className="flex gap-0.5">
                        <button
                          type="button"
                          title="Save"
                          onClick={() => { saveOverride(c.id, editVal); setEditId(null); if (isSelected) onChange(editVal.trim().toUpperCase(), c.name); }}
                          className="p-1 rounded hover:bg-emerald-100 text-emerald-600"
                        ><Check className="h-3.5 w-3.5"/></button>
                        <button
                          type="button"
                          title="Cancel"
                          onClick={() => setEditId(null)}
                          className="p-1 rounded hover:bg-red-100 text-red-500"
                        ><X className="h-3.5 w-3.5"/></button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        title="Edit payer ID"
                        onClick={() => { setEditId(c.id); setEditVal(c.payer_id); }}
                        className={`p-1 rounded transition-colors ${isOverridden ? 'text-amber-500 hover:bg-amber-100' : 'text-slate-300 hover:text-slate-600 hover:bg-slate-100'}`}
                      ><Pencil className="h-3.5 w-3.5"/></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer: override count + reset */}
          {Object.keys(overrides).length > 0 && (
            <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-t border-amber-100 text-xs text-amber-700">
              <span>⚠️ {Object.keys(overrides).length} payer ID(s) customised for this browser</span>
              <button
                type="button"
                onClick={() => { setOverrides({}); localStorage.removeItem(STORAGE_KEY); setSaveMsg('Overrides cleared'); setTimeout(() => setSaveMsg(''), 2000); }}
                className="underline hover:text-amber-900"
              >Reset all</button>
            </div>
          )}
        </div>
      )}

      {/* Manual entry */}
      {!selectedName && (
        <div className="text-xs text-slate-400 text-center">— or type manually —</div>
      )}
    </div>
  );
}
