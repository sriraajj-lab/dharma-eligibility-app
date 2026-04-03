import { useState, useRef } from 'react';
import {
  Upload, Download, FileText, Loader2, CheckCircle,
  AlertCircle, Play, Info, RotateCcw, Table2
} from 'lucide-react';
import { callAvailityApi } from '../lib/supabase';

interface BatchRow {
  first_name: string; last_name: string; date_of_birth: string;
  member_id: string; group_number: string; carrier_id: string;
  carrier_name?: string; plan_name?: string;
  [key: string]: string | undefined;
}

interface ResultRow extends BatchRow {
  status: string; plan_name_result: string; effective_date: string;
  deductible_individual: string; deductible_family: string;
  deductible_remaining: string; annual_maximum: string;
  maximum_remaining: string; preventive_pct: string; basic_pct: string;
  major_pct: string; orthodontic_pct: string; network_status: string;
  error?: string;
}

const REQUIRED_COLS = ['first_name','last_name','date_of_birth','member_id','carrier_id'];

const TEMPLATE_CSV = `first_name,last_name,date_of_birth,member_id,group_number,carrier_id,carrier_name,plan_name
John,Smith,1980-03-15,MEM123456,GRP001,AETNA,Aetna,Aetna Dental PPO
Jane,Doe,1975-07-22,MEM789012,GRP002,BCBS,BlueCross BlueShield,BCBS Dental Basic
Robert,Johnson,1990-11-05,MEM456789,,CIGNA,Cigna,Cigna Dental 1000`;

const get = (obj: Record<string,unknown>, ...keys: string[]): string => {
  for (const k of keys) {
    const v = obj[k] ?? (obj.data as Record<string,unknown>)?.[k] ?? (obj.eligibility as Record<string,unknown>)?.[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
};

export function BatchCheck() {
  const [rows, setRows]           = useState<BatchRow[]>([]);
  const [results, setResults]     = useState<ResultRow[]>([]);
  const [running, setRunning]     = useState(false);
  const [progress, setProgress]   = useState(0);
  const [errors, setErrors]       = useState<string[]>([]);
  const [parseError, setParseError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  /* ── CSV Parser ── */
  const parseCSV = (text: string): { headers: string[]; rows: Record<string,string>[] } => {
    const lines = text.trim().split(/\r?\n/);
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,''));
    const rows = lines.slice(1).filter(l => l.trim()).map(line => {
      // handle quoted fields
      const values: string[] = [];
      let cur = ''; let inQ = false;
      for (const ch of line) {
        if (ch === '"') { inQ = !inQ; }
        else if (ch === ',' && !inQ) { values.push(cur.trim()); cur = ''; }
        else cur += ch;
      }
      values.push(cur.trim());
      return Object.fromEntries(headers.map((h, i) => [h, (values[i] ?? '').replace(/^"|"$/g,'')]));
    });
    return { headers, rows };
  };

  const handleFile = (file: File) => {
    setParseError(''); setRows([]); setResults([]); setErrors([]);
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const text = e.target?.result as string;
        const { headers, rows: parsed } = parseCSV(text);
        const missing = REQUIRED_COLS.filter(c => !headers.includes(c));
        if (missing.length) { setParseError(`Missing required columns: ${missing.join(', ')}`); return; }
        setRows(parsed as BatchRow[]);
      } catch (err) {
        setParseError('Could not parse file. Please use the template CSV format.');
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  /* ── Run batch ── */
  const runBatch = async () => {
    setRunning(true); setErrors([]); setResults([]);
    const out: ResultRow[] = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      setProgress(Math.round(((i+1) / rows.length) * 100));
      try {
        const data = await callAvailityApi('check_eligibility', {
          memberId:    row.member_id,
          groupNumber: row.group_number ?? '',
          firstName:   row.first_name,
          lastName:    row.last_name,
          dateOfBirth: row.date_of_birth,
          carrierCode: row.carrier_id,
          planName:    row.plan_name ?? '',
        }) as Record<string,unknown>;

        const cvg = (data.coverages ?? data.coverage ?? {}) as Record<string,unknown>;
        const pct = (key: string) => {
          const direct = get(data, `${key}Coverage`, `${key}_pct`, `${key}CoveragePercent`);
          if (direct) return direct;
          const c = cvg[key] as Record<string,unknown>;
          return c ? String(c.percent ?? c.coveragePercent ?? '') : '';
        };
        const ded = (data.deductible ?? {}) as Record<string,unknown>;
        const mx  = (data.maximumBenefit ?? {}) as Record<string,unknown>;

        out.push({
          ...row,
          status:               get(data,'status','coverageStatus','eligibilityStatus'),
          plan_name_result:     get(data,'planName','plan_name','groupName'),
          effective_date:       get(data,'planBeginDate','effectiveDate','coverageBeginDate'),
          deductible_individual: get(data,'deductibleIndividual') || String(ded.individual ?? ded.amount ?? ''),
          deductible_family:    get(data,'deductibleFamily')     || String(ded.family ?? ''),
          deductible_remaining: get(data,'deductibleRemaining')  || String(ded.remaining ?? ''),
          annual_maximum:       get(data,'annualMaximum','annual_max','maximumBenefit') || String(mx.individual ?? mx.amount ?? ''),
          maximum_remaining:    get(data,'annualMaximumRemaining') || String(mx.remaining ?? ''),
          preventive_pct:       pct('preventive'),
          basic_pct:            pct('basic'),
          major_pct:            pct('major'),
          orthodontic_pct:      pct('orthodontic'),
          network_status:       get(data,'networkStatus','network','inNetworkIndicator'),
        });
      } catch (e: unknown) {
        out.push({ ...row, status:'ERROR', plan_name_result:'',effective_date:'',deductible_individual:'',deductible_family:'',deductible_remaining:'',annual_maximum:'',maximum_remaining:'',preventive_pct:'',basic_pct:'',major_pct:'',orthodontic_pct:'',network_status:'', error: e instanceof Error ? e.message : 'Failed' });
        setErrors(prev => [...prev, `Row ${i+2} (${row.first_name} ${row.last_name}): ${e instanceof Error ? e.message : 'Failed'}`]);
      }
    }
    setResults(out);
    setRunning(false);
  };

  /* ── Download results CSV ── */
  const downloadResults = () => {
    if (!results.length) return;
    const cols: (keyof ResultRow)[] = ['first_name','last_name','date_of_birth','member_id','group_number','carrier_id','carrier_name','plan_name','status','plan_name_result','effective_date','deductible_individual','deductible_family','deductible_remaining','annual_maximum','maximum_remaining','preventive_pct','basic_pct','major_pct','orthodontic_pct','network_status','error'];
    const header = cols.join(',');
    const body   = results.map(r => cols.map(c => `"${String(r[c]??'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([`${header}\n${body}`], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `batch_eligibility_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  /* ── Download template ── */
  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_CSV], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dharma_eligibility_template.csv';
    a.click();
  };

  const reset = () => { setRows([]); setResults([]); setErrors([]); setParseError(''); setProgress(0); };

  return (
    <div className="space-y-5">

      {/* Instructions */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 shrink-0 mt-0.5"/>
        <div className="text-sm text-blue-800">
          <p className="font-semibold mb-1">How Batch Eligibility Works</p>
          <ol className="list-decimal list-inside space-y-0.5 text-blue-700">
            <li>Download the CSV template and fill in your patients</li>
            <li>Upload the completed CSV file</li>
            <li>Click "Run Batch Check" — we'll check each patient via Availity</li>
            <li>Download the results CSV with all dental coverage details</li>
          </ol>
        </div>
      </div>

      {/* Template download */}
      <div className="flex gap-2">
        <button onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 transition">
          <FileText className="w-4 h-4"/> Download CSV Template
        </button>
        {(rows.length > 0 || results.length > 0) && (
          <button onClick={reset}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition">
            <RotateCcw className="w-4 h-4"/> Start Over
          </button>
        )}
      </div>

      {/* Upload area */}
      {!rows.length && !results.length && (
        <div
          onDrop={handleDrop}
          onDragOver={e => e.preventDefault()}
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center hover:border-blue-400 hover:bg-blue-50 transition cursor-pointer"
          onClick={() => fileRef.current?.click()}>
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3"/>
          <p className="font-semibold text-gray-700">Drop your CSV here or click to browse</p>
          <p className="text-sm text-gray-400 mt-1">Accepts .csv files — use the template above for the correct format</p>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}/>
          {parseError && (
            <div className="mt-4 flex items-center gap-2 justify-center text-red-600 text-sm">
              <AlertCircle className="w-4 h-4"/>{parseError}
            </div>
          )}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && !results.length && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <Table2 className="w-4 h-4 text-blue-600"/> {rows.length} patients loaded — Preview
            </h3>
            <button onClick={runBatch} disabled={running}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition">
              {running ? <Loader2 className="w-4 h-4 animate-spin"/> : <Play className="w-4 h-4"/>}
              {running ? `Checking… ${progress}%` : 'Run Batch Check'}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>{['First Name','Last Name','DOB','Member ID','Group #','Carrier ID'].map(h => (
                  <th key={h} className="px-4 py-2 text-left font-semibold text-gray-500">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.slice(0,10).map((r,i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-2">{r.first_name}</td>
                    <td className="px-4 py-2">{r.last_name}</td>
                    <td className="px-4 py-2">{r.date_of_birth}</td>
                    <td className="px-4 py-2 font-mono">{r.member_id}</td>
                    <td className="px-4 py-2 font-mono">{r.group_number || '—'}</td>
                    <td className="px-4 py-2 font-mono text-blue-600">{r.carrier_id}</td>
                  </tr>
                ))}
                {rows.length > 10 && (
                  <tr><td colSpan={6} className="px-4 py-2 text-gray-400 text-center">… and {rows.length-10} more rows</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {running && (
            <div className="p-4 border-t border-gray-100">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Processing patients via Availity…</span><span>{progress}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full transition-all" style={{width:`${progress}%`}}/>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <p className="font-semibold text-red-700 text-sm mb-2 flex items-center gap-1"><AlertCircle className="w-4 h-4"/>{errors.length} check(s) failed:</p>
          <ul className="text-xs text-red-600 space-y-0.5">{errors.map((e,i) => <li key={i}>• {e}</li>)}</ul>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-600"/>
              Results — {results.filter(r=>!r.error).length}/{results.length} successful
            </h3>
            <button onClick={downloadResults}
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition">
              <Download className="w-4 h-4"/> Download Results CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>{['Name','Member ID','Carrier','Status','Deductible','Annual Max','Preventive','Basic','Major','Ortho','Network'].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {results.map((r,i) => (
                  <tr key={i} className={`hover:bg-gray-50 ${r.error ? 'bg-red-50' : ''}`}>
                    <td className="px-3 py-2 font-medium">{r.first_name} {r.last_name}</td>
                    <td className="px-3 py-2 font-mono">{r.member_id}</td>
                    <td className="px-3 py-2">{r.carrier_name || r.carrier_id}</td>
                    <td className="px-3 py-2">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${r.error ? 'bg-red-100 text-red-700' : r.status?.toLowerCase().includes('active') ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.error ? 'Error' : (r.status || '—')}
                      </span>
                    </td>
                    <td className="px-3 py-2">{r.deductible_individual ? `$${r.deductible_individual}` : '—'}</td>
                    <td className="px-3 py-2">{r.annual_maximum ? `$${r.annual_maximum}` : '—'}</td>
                    <td className="px-3 py-2">{r.preventive_pct ? `${r.preventive_pct}%` : '—'}</td>
                    <td className="px-3 py-2">{r.basic_pct      ? `${r.basic_pct}%` : '—'}</td>
                    <td className="px-3 py-2">{r.major_pct      ? `${r.major_pct}%` : '—'}</td>
                    <td className="px-3 py-2">{r.orthodontic_pct? `${r.orthodontic_pct}%` : '—'}</td>
                    <td className="px-3 py-2">{r.network_status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
