import React, { useState } from 'react';
import { Building2, FileText, Users, ShieldCheck, ClipboardList, LogOut, Activity } from 'lucide-react';
import { useAuth } from './hooks/useAuth';
import { AuthModal } from './components/AuthModal';
import { Header } from './components/Header';
import { Companies } from './components/Companies';
import { Plans } from './components/Plans';
import { Patients } from './components/Patients';
import { Eligibility } from './components/Eligibility';
import { Preauth } from './components/Preauth';

const TABS = [
  { id: 'companies', label: 'Companies', icon: Building2, description: 'Insurance companies & carrier IDs' },
  { id: 'plans',     label: 'Plans',     icon: FileText,   description: 'Dental plan configurations' },
  { id: 'patients',  label: 'Patients',  icon: Users,      description: 'Patient records & insurance' },
  { id: 'eligibility',label:'Eligibility',icon: ShieldCheck,description: 'Live Availity eligibility checks' },
  { id: 'preauth',   label: 'Preauth',   icon: ClipboardList,description: 'Submit & track preauthorizations' },
] as const;

type TabId = typeof TABS[number]['id'];

function App() {
  const { user, loading } = useAuth();
  const [showAuth, setShowAuth] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>('companies');
  const { signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Activity className="w-10 h-10 text-blue-600 animate-pulse mx-auto mb-3" />
          <p className="text-gray-600">Loading Dharma Health...</p>
        </div>
      </div>
    );
  }

  const activeTabConfig = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header user={user} onLoginClick={() => setShowAuth(true)} onLogout={signOut} />

      {!user ? (
        <div className="max-w-2xl mx-auto mt-20 p-8 text-center">
          <div className="bg-white rounded-2xl border border-gray-200 p-10 shadow-sm">
            <Activity className="w-16 h-16 text-blue-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-900 mb-2">Dharma Eligibility & Preauthorization</h2>
            <p className="text-gray-500 mb-6">Sign in to manage insurance verification, eligibility checks, and preauthorization submissions through Availity.</p>
            <button onClick={() => setShowAuth(true)} className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition">
              Sign In to Continue
            </button>
          </div>
        </div>
      ) : (
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          {/* Tab Nav */}
          <div className="flex gap-1 bg-white border border-gray-200 rounded-xl p-1 mb-6 shadow-sm overflow-x-auto">
            {TABS.map(tab => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap flex-1 justify-center
                    ${active ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'}`}>
                  <Icon className="w-4 h-4" />
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden">{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* Tab Header */}
          <div className="mb-4">
            <h2 className="text-xl font-bold text-gray-900">{activeTabConfig.label}</h2>
            <p className="text-sm text-gray-500">{activeTabConfig.description}</p>
          </div>

          {/* Tab Content */}
          {activeTab === 'companies'   && <Companies />}
          {activeTab === 'plans'       && <Plans />}
          {activeTab === 'patients'    && <Patients />}
          {activeTab === 'eligibility' && <Eligibility />}
          {activeTab === 'preauth'     && <Preauth />}
        </div>
      )}

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  );
}

export default App;
