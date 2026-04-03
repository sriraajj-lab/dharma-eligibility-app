import { useState } from 'react';
import { ShieldCheck, Upload, Building2, Activity } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { AuthModal } from './components/AuthModal';
import { Header } from './components/Header';
import { SingleCheck } from './components/SingleCheck';
import { BatchCheck } from './components/BatchCheck';
import { Companies } from './components/Companies';

const TABS = [
  { id: 'single', label: 'Check Eligibility', icon: ShieldCheck, desc: 'Single patient — enter info, check, download' },
  { id: 'batch',  label: 'Batch Upload',      icon: Upload,      desc: 'Upload CSV for multiple patients at once' },
  { id: 'companies', label: 'Manage Carriers', icon: Building2,  desc: 'Insurance companies & Availity carrier IDs' },
] as const;

type TabId = typeof TABS[number]['id'];

export default function App() {
  const { user, loading, signOut } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('single');

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Activity className="w-10 h-10 text-blue-600 animate-pulse" />
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} onLoginClick={() => setShowAuth(true)} onLogout={signOut} />

      {!user ? (
        <div className="max-w-xl mx-auto mt-24 p-8 text-center">
          <div className="bg-white rounded-2xl border border-gray-200 p-10 shadow-sm">
            <ShieldCheck className="w-14 h-14 text-blue-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Dharma Dental Eligibility</h2>
            <p className="text-gray-500 mb-6">Enter patient and insurance details, instantly verify dental coverage via Availity, and download the result — no data stored.</p>
            <button onClick={() => setShowAuth(true)}
              className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition">
              Sign In to Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          {/* Tabs */}
          <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-6 shadow-sm">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition flex-1 justify-center
                    ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {activeTab === 'single'    && <SingleCheck />}
          {activeTab === 'batch'     && <BatchCheck />}
          {activeTab === 'companies' && <Companies />}
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}
