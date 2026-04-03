/**
 * InsurancePicker
 * Shown on Step 2 of SingleCheck — lets user:
 *  1. Browse/search all carriers (name + payer ID shown inline)
 *  2. Click any row to select it
 *  3. Click the pencil icon on any row to edit the payer ID for that session
 *  4. Or type manually at the bottom
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Search, Pencil, Check, X, ChevronDown, ChevronUp,
  Building2, ShieldCheck
} from 'lucide-react';
import { supabase } from '../lib/supabase';

export interface CarrierOption {
  id:         string;   // DB uuid (or fake for built-in)
  name:       string;
  payer_id:   string;   // Availity carrier code
  source:     'db' | 'builtin';
}

/** 20 most common dental insurers + their standard Availity payer IDs */
const BUILTIN_CARRIERS: CarrierOption[] = [
  { id:'b-01', name:'Aetna',                            payer_id:'AETNA',    source:'builtin' },
  { id:'b-02', name:'Anthem / BlueCross BlueShield',    payer_id:'ANTHEM',   source:'builtin' },
  { id:'b-03', name:'Cigna',                            payer_id:'CIGNA',    source:'builtin' },
  { id:'b-04', name:'Delta Dental',                     payer_id:'DDPA',     source:'builtin' },
  { id:'b-05', name:'Guardian Life',                    payer_id:'GRDNA',    source:'builtin' },
  { id:'b-06', name:'Humana',                           payer_id:'HUMANA',   source:'builtin' },
  { id:'b-07', name:'Lincoln Financial (Liberty)',      payer_id:'LNCLN',    source:'builtin' },
  { id:'b-08', name:'MetLife',                          payer_id:'METLN',    source:'builtin' },
  { id:'b-09', name:'Principal Financial',              payer_id:'PRINC',    source:'builtin' },
  { id:'b-10', name:'Sun Life Financial',               payer_id:'SUNLF',    source:'builtin' },
  { id:'b-11', name:'UnitedHealthcare / UHC Dental',   payer_id:'UCARE',    source:'builtin' },
  { id:'b-12', name:'United Concordia',                 payer_id:'UNIDC',    source:'builtin' },
  { id:'b-13', name:'Ameritas',                         payer_id:'AMRTS',    source:'builtin' },
  { id:'b-14', name:'Assurant / DentaQuest',            payer_id:'DNTQT',    source:'builtin' },
  { id:'b-15', name:'BlueCross BlueShield Federal',     payer_id:'BCBSF',    source:'builtin' },
  { id:'b-16', name:'Careington',                       payer_id:'CRGTN',    source:'builtin' },
  { id:'b-17', name:'Connection Dental (GEHA)',         payer_id:'GEHA',     source:'builtin' },
  { id:'b-18', name:'Medicaid (State)',                 payer_id:'MCAID',    source:'builtin' },
  { id:'b-19', name:'Medicare',                         payer_id:'MCARE',    source:'builtin' },
  { id:'b-20', name:'TRICARE / MetLife',                payer_id:'TRIMT',    source:'builtin' },
];

interface Props {
  selectedId:    string;          // current payer_id
  selectedName:  string;
  onChange:      (payer_id: string, name: string) => void;
}

export function InsurancePicker({ selectedId, selectedName, onChange }: Props) {
  const [carriers, setCarriers]     = useState<CarrierOption[]>(BUILTIN_CARRIERS);
  const [search,   setSearch]       = useState('');
  const [editId,   setEditId]       = useState<string | null>(null);
  const [editVal,  setEditVal]       = useState('');
  const [overrides, setOverrides]   = useState<Record<string, string>>({}); // id → custom payer_id
  const [expanded, setExpanded]     = useState(true);

  /* Merge DB carriers */
  useEffect(() => {
    supabase.from('insurance_companies').select('id,name,availity_carrier_id').order('name')
      .then(({ data }) => {
        if (data?.length) {
          const db: CarrierOption[] = data.map(r => ({
            id: r.id, name: r.name, payer_id: r.availity_carrier_id, source: 'db' as const,
          }));
          // Merge: DB takes priority over built-in if same name
          const dbNames = new Set(db.map(d => d.name.toLowerCase()));
          setCarriers([...db, ...BUILTIN_CARRIERS.filter(b => !dbNames.has(b.name.toLowerCase()))]);
        }
      });
  }, []);

  const display = useMemo(() => {
    const q = search.toLowerCase();
    return carriers.filter(c =>
      c.name.toLowerCase().includes(q) || c.payer_id.toLowerCase().includes(q)
    ).map(c => ({ ...c, payer_id: overrides[c.id] ?? c.payer_id }));
  }, [carriers, search, overrides]);

  const startEdit = (c: CarrierOption, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditId(c.id);
    setEditVal(overrides[c.id] ?? c.payer_id);
  };

  const saveEdit = (c: CarrierOption, e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = editVal.toUpperCase().trim();
    setOverrides(prev => ({ ...prev, [c.id]: newVal }));
    // If this carrier is currently selected, update the parent too
    if (selectedId === (overrides[c.id] ?? c.payer_id) || selectedName === c.name) {
      onChange(newVal, c.name);
    }
    setEditId(null);
  };

  const cancelEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditId(null);
  };

  const selectRow = (c: CarrierOption & { payer_id: string }) => {
    onChange(c.payer_id, c.name);
    setExpanded(false);
  };

  const isSelected = (c: CarrierOption) =>
    selectedName === c.name || selectedId === (overrides[c.id] ?? c.payer_id);

  return (
    <div>
      {/* Selected banner */}
      {selectedId && !expanded && (
        <div
          className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-xl cursor-pointer hover:bg-blue-100 transition"
          onClick={() => setExpanded(true)}>
          <div className="flex items-center gap-3">
            <ShieldCheck className="w-5 h-5 text-blue-600"/>
            <div>
              <p className="font-semibold text-blue-900 text-sm">{selectedName}</p>
              <p className="text-xs text-blue-500 font-mono">Payer ID: {selectedId}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-xs text-blue-600 font-medium">
            <Pencil className="w-3.5 h-3.5"/> Change <ChevronDown className="w-3.5 h-3.5"/>
          </div>
        </div>
      )}

      {/* Expanded picker */}
      {expanded && (
        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">

          {/* Search bar */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-200 bg-gray-50">
            <Search className="w-4 h-4 text-gray-400 shrink-0"/>
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by insurer name or payer ID…"
              className="flex-1 bg-transparent text-sm outline-none text-gray-800 placeholder-gray-400"/>
            {search && (
              <button onClick={() => setSearch('')} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4"/>
              </button>
            )}
            {selectedId && (
              <button
                onClick={() => setExpanded(false)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 ml-2 border-l border-gray-200 pl-2">
                <ChevronUp className="w-3.5 h-3.5"/> Collapse
              </button>
            )}
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_auto_auto] gap-0 text-xs font-semibold text-gray-400 uppercase tracking-wide px-4 py-1.5 bg-gray-50 border-b border-gray-100">
            <span>Insurance Company</span>
            <span className="text-right w-28 mr-3">Payer ID</span>
            <span className="w-8"/>
          </div>

          {/* Carrier rows */}
          <div className="max-h-72 overflow-y-auto divide-y divide-gray-50">
            {display.length === 0 && (
              <p className="text-center text-gray-400 text-sm py-6">No carriers found — try a different search</p>
            )}
            {display.map(c => (
              <div
                key={c.id}
                onClick={() => editId !== c.id && selectRow(c)}
                className={`grid grid-cols-[1fr_auto_auto] gap-0 items-center px-4 py-2.5 cursor-pointer transition select-none
                  ${isSelected(c) ? 'bg-blue-50 border-l-2 border-l-blue-500' : 'hover:bg-gray-50 border-l-2 border-l-transparent'}`}>

                {/* Name */}
                <div className="flex items-center gap-2 min-w-0">
                  {isSelected(c)
                    ? <ShieldCheck className="w-4 h-4 text-blue-500 shrink-0"/>
                    : <Building2   className="w-4 h-4 text-gray-300 shrink-0"/>}
                  <span className={`text-sm truncate ${isSelected(c) ? 'font-semibold text-blue-900' : 'text-gray-700'}`}>
                    {c.name}
                  </span>
                  {c.source === 'db' && (
                    <span className="text-[10px] bg-green-100 text-green-600 px-1 rounded font-medium shrink-0">saved</span>
                  )}
                </div>

                {/* Payer ID — editable */}
                <div className="w-36 flex items-center justify-end mr-2" onClick={e => e.stopPropagation()}>
                  {editId === c.id ? (
                    <input
                      autoFocus
                      value={editVal}
                      onChange={e => setEditVal(e.target.value.toUpperCase())}
                      onKeyDown={e => { if (e.key === 'Enter') saveEdit(c, e as unknown as React.MouseEvent); if (e.key === 'Escape') cancelEdit(e as unknown as React.MouseEvent); }}
                      className="w-full px-2 py-1 border-2 border-blue-400 rounded text-xs font-mono text-gray-900 outline-none bg-white"
                      maxLength={20}
                    />
                  ) : (
                    <span className={`text-xs font-mono px-2 py-0.5 rounded ${isSelected(c) ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {c.payer_id}
                    </span>
                  )}
                </div>

                {/* Edit / Save / Cancel */}
                <div className="w-16 flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                  {editId === c.id ? (
                    <>
                      <button onClick={e => saveEdit(c, e)} className="p-1 rounded hover:bg-green-100 text-green-600" title="Save">
                        <Check className="w-3.5 h-3.5"/>
                      </button>
                      <button onClick={cancelEdit} className="p-1 rounded hover:bg-red-100 text-red-500" title="Cancel">
                        <X className="w-3.5 h-3.5"/>
                      </button>
                    </>
                  ) : (
                    <button onClick={e => startEdit(c, e)} className="p-1 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-600" title="Change payer ID">
                      <Pencil className="w-3.5 h-3.5"/>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Footer hint */}
          <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 text-xs text-gray-400">
            💡 Click any row to select · Click <Pencil className="w-3 h-3 inline"/> to change the Payer ID for this session
          </div>
        </div>
      )}
    </div>
  );
}
