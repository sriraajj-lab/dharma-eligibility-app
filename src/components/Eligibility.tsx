import React, { useState, useEffect } from 'react';
import { ShieldCheck, AlertCircle, Loader2, CheckCircle, XCircle, Info } from 'lucide-react';
import { supabase, callAvailityApi } from '../lib/supabase';
import { Patient } from '../types';

interface EligibilityData {
  coverageActive?: boolean;
  deductible?: number;
  deductibleMet?: number;
  outOfPocketMax?: number;
  outOfPocketMet?: number;
  preventiveCoverage?: number;
  basicCoverage?: number;
  majorCoverage?: number;
  inNetwork?: boolean;
  effectiveDate?: string;
  terminationDate?: string;
  planName?: string;
  groupNumber?: string;
  subscriberName?: string;
  raw?: unknown;
}

export function Eligibility() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPatients, setLoadingPatients] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<EligibilityData | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    supabase.from('patients')
      .select('*, insurance_company:insurance_companies(id, name, availity_carrier_id)')
      .order('last_name, first_name')
      .then(({ data }) => { setPatients((data || []) as Patient[]); setLoadingPatients(false); });
  }, []);

  const checkEligibility = async () => {
    if (!selectedPatientId) return;
    const patient = patients.find(p => p.id === selectedPatientId);
    if (!patient) return;
    const company = patient.insurance_company;
    if (!company) { setError('Patient has no insurance company linked.'); return; }

    setError(null); setResult(null); setLoading(true);
    try {
      const raw = await callAvailityApi('check-eligibility', {
        memberId: patient.member_id,
        groupNumber: patient.group_number,
        dateOfBirth: patient.date_of_birth,
        lastName: patient.last_name,
        firstName: patient.first_name,
        carrierCode: company.availity_carrier_id,  // Fixed: use actual carrier code, not UUID
      });
      // Normalize the response into a structured format
      const normalized: EligibilityData = {
        coverageActive: raw.coverageActive ?? raw.active ?? raw.status === 'active',
        deductible: raw.deductible ?? raw.deductibleAmount,
        deductibleMet: raw.deductibleMet ?? raw.deductibleMetAmount,
        outOfPocketMax: raw.outOfPocketMax ?? raw.outOfPocketMaxAmount,
        outOfPocketMet: raw.outOfPocketMet ?? raw.outOfPocketMetAmount,
        preventiveCoverage: raw.preventiveCoverage ?? raw.preventive,
        basicCoverage: raw.basicCoverage ?? raw.basic,
        majorCoverage: raw.majorCoverage ?? raw.major,
        inNetwork: raw.inNetwork ?? raw.networkStatus === 'in',
        effectiveDate: raw.effectiveDate ?? raw.coverageEffectiveDate,
        terminationDate: raw.terminationDate ?? raw.coverageTerminationDate,
        planName: raw.planName ?? raw.plan?.name,
        groupNumber: raw.groupNumber,
        subscriberName: raw.subscriberName ?? raw.subscriber?.name,
        raw,
      };
      setResult(normalized);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Eligibility check failed. Please try again.');
    } finally { setLoading(false); }
  };

  const selectedPatient = patients.find(p => p.id === selectedPatientId);

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-green-600" /> Check Patient Eligibility
        </h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Select Patient <span className="text-red-500">*</span></label>
            {loadingPatients ? (
              <p className="text-sm text-gray-500 italic py-2 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading patients...</p>
            ) : (
              <select value={selectedPatientId} onChange={e => { setSelectedPatientId(e.target.value); setResult(null); setError(null); }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-green-500">
                <option value="">Choose a patient...</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>{p.first_name} {p.last_name} — {p.member_id}</option>
                ))}
              </select>
            )}
            {patients.length === 0 && !loadingPatients && (
              <p className="text-sm text-amber-600 mt-1 flex items-center gap-1"><Info className="w-4 h-4" />No patients registered. Add patients first.</p>
            )}
          </div>

          {selectedPatient && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <p className="font-medium text-blue-900">{selectedPatient.first_name} {selectedPatient.last_name}</p>
              <p className="text-blue-700">Member ID: {selectedPatient.member_id} · DOB: {selectedPatient.date_of_birth}</p>
              <p className="text-blue-600 text-xs mt-0.5">
                {(selectedPatient.insurance_company as any)?.name} · Carrier: {(selectedPatient.insurance_company as any)?.availity_carrier_id}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <button onClick={checkEligibility} disabled={loading || !selectedPatientId}
            className="w-full bg-green-600 text-white py-2.5 rounded-lg hover:bg-green-700 disabled:bg-gray-300 font-medium transition flex items-center justify-center gap-2">
            {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Checking with Availity...</> : <><ShieldCheck className="w-4 h-4" />Check Eligibility with Availity</>}
          </button>
        </div>
      </div>

      {result && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Eligibility Results</h3>
            <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium ${result.coverageActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
              {result.coverageActive ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {result.coverageActive ? 'Coverage Active' : 'Not Active'}
            </div>
          </div>

          {/* Coverage Summary Cards */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Preventive', value: result.preventiveCoverage, suffix: '%', color: 'green' },
              { label: 'Basic', value: result.basicCoverage, suffix: '%', color: 'blue' },
              { label: 'Major', value: result.majorCoverage, suffix: '%', color: 'purple' },
            ].map(({ label, value, suffix, color }) => (
              <div key={label} className={`p-3 bg-${color}-50 border border-${color}-200 rounded-lg text-center`}>
                <p className={`text-2xl font-bold text-${color}-700`}>{value != null ? `${value}${suffix}` : '—'}</p>
                <p className={`text-xs text-${color}-600 mt-0.5`}>{label}</p>
              </div>
            ))}
          </div>

          {/* Financial Details */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Deductible', value: result.deductible, met: result.deductibleMet },
              { label: 'Out-of-Pocket Max', value: result.outOfPocketMax, met: result.outOfPocketMet },
            ].map(({ label, value, met }) => (
              <div key={label} className="p-3 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                {value != null ? (
                  <>
                    <p className="text-lg font-semibold text-gray-900">${value.toLocaleString()}</p>
                    {met != null && <p className="text-xs text-gray-500">${met.toLocaleString()} met</p>}
                  </>
                ) : <p className="text-sm text-gray-400">Not available</p>}
              </div>
            ))}
          </div>

          {/* Other Details */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {result.planName && <div className="p-2 bg-gray-50 rounded"><span className="text-gray-500 text-xs">Plan:</span><p className="font-medium text-gray-800">{result.planName}</p></div>}
            {result.inNetwork != null && <div className="p-2 bg-gray-50 rounded"><span className="text-gray-500 text-xs">Network:</span><p className={`font-medium ${result.inNetwork ? 'text-green-700' : 'text-amber-700'}`}>{result.inNetwork ? 'In-Network' : 'Out-of-Network'}</p></div>}
            {result.effectiveDate && <div className="p-2 bg-gray-50 rounded"><span className="text-gray-500 text-xs">Effective:</span><p className="font-medium text-gray-800">{result.effectiveDate}</p></div>}
            {result.terminationDate && <div className="p-2 bg-gray-50 rounded"><span className="text-gray-500 text-xs">Term Date:</span><p className="font-medium text-gray-800">{result.terminationDate}</p></div>}
          </div>

          {/* Raw JSON toggle */}
          <div>
            <button onClick={() => setShowRaw(!showRaw)} className="text-sm text-blue-600 hover:underline">
              {showRaw ? 'Hide' : 'Show'} raw API response
            </button>
            {showRaw && (
              <pre className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs text-gray-700 overflow-auto max-h-48">
                {JSON.stringify(result.raw, null, 2)}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
