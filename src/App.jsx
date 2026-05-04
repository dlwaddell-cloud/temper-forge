// File: src/App.jsx

import React, { useState, useEffect, createContext, useContext, useMemo } from 'react';
import { LayoutDashboard, FileText, Settings, LogOut, Plus, BarChart3, Users, Save } from 'lucide-react';

const API = '/api';
const AuthCtx = createContext(null);
const BrandingCtx = createContext(null);

// --- API Helper ---
async function apiCall(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'API Error');
  return data;
}

// --- Providers ---
function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));

  const login = async (email, password) => {
    const res = await apiCall('/auth/login', { method: 'POST', body: { email, password } });
    setToken(res.token); setUser(res.user);
    localStorage.setItem('token', res.token);
    localStorage.setItem('user', JSON.stringify(res.user));
  };
  const logout = () => { setToken(null); setUser(null); localStorage.clear(); };

  return <AuthCtx.Provider value={{ token, user, login, logout }}>{children}</AuthCtx.Provider>;
}

function BrandingProvider({ children }) {
  const [settings, setSettings] = useState({ 'brand.primaryColor': '#4f46e5', 'brand.appName': 'PlanBase' });
  const reload = async () => {
    const s = await apiCall('/settings');
    if (Object.keys(s).length) setSettings(prev => ({ ...prev, ...s }));
  };
  useEffect(() => { reload(); }, []);
  useEffect(() => {
    document.documentElement.style.setProperty('--brand-primary', settings['brand.primaryColor'] || '#4f46e5');
    document.title = settings['brand.appName'] || 'PlanBase';
  }, [settings]);

  return <BrandingCtx.Provider value={{ settings, reload }}>{children}</BrandingCtx.Provider>;
}

// --- UI Components ---
const Button = ({ children, variant = 'primary', className = '', ...props }) => {
  const base = 'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition';
  const v = variant === 'primary' ? 'bg-[var(--brand-primary)] text-white hover:opacity-90' : 'bg-white border text-slate-700 hover:bg-slate-50';
  return <button className={`${base} ${v} ${className}`} {...props}>{children}</button>;
};

// --- Views ---
function LoginView() {
  const { login } = useContext(AuthCtx);
  const { settings } = useContext(BrandingCtx);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    try { await login(email, password); } catch (err) { setError(err.message); }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white p-8 rounded-xl shadow-sm border border-slate-200">
        <h1 className="text-2xl font-bold text-center mb-6 text-[var(--brand-primary)]">{settings['brand.appName'] || 'PlanBase'}</h1>
        {error && <div className="mb-4 text-sm text-red-600 bg-red-50 p-2 rounded">{error}</div>}
        <div className="mb-4">
          <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border rounded-lg p-2" required />
        </div>
        <div className="mb-6">
          <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full border rounded-lg p-2" required />
        </div>
        <Button className="w-full justify-center">Sign In</Button>
      </form>
    </div>
  );
}

function TeacherDashboard() {
  const { token } = useContext(AuthCtx);
  const [plans, setPlans] = useState([]);
  const [editing, setEditing] = useState(null);

  const load = async () => setPlans(await apiCall('/plans', { token }));
  useEffect(() => { load(); }, []);

  if (editing) return <PlanEditor plan={editing} onBack={() => { setEditing(null); load(); }} />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">My Lesson Plans</h2>
        <Button onClick={() => setEditing({})}><Plus className="h-4 w-4"/> New Plan</Button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 border-b">
            <tr><th className="p-4">Week Of</th><th className="p-4">Title</th><th className="p-4">Status</th></tr>
          </thead>
          <tbody>
            {plans.map(p => (
              <tr key={p.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => setEditing(p)}>
                <td className="p-4 font-medium">{p.weekOf}</td>
                <td className="p-4 text-slate-600">{p.title}</td>
                <td className="p-4"><span className={`px-2 py-1 rounded-full text-xs font-semibold ${p.status === 'SUBMITTED' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-700'}`}>{p.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        {plans.length === 0 && <div className="p-8 text-center text-slate-500">No lesson plans found.</div>}
      </div>
    </div>
  );
}

function PlanEditor({ plan, onBack }) {
  const { token } = useContext(AuthCtx);
  const [form, setForm] = useState(plan.id ? plan : { title: '', weekOf: '', objective: '', standards: '', activities: '', assessment: '', status: 'DRAFT' });

  const save = async (statusOverride = null) => {
    const payload = { ...form, status: statusOverride || form.status };
    try {
      if (plan.id) await apiCall(`/plans/${plan.id}`, { method: 'PUT', token, body: payload });
      else await apiCall('/plans', { method: 'POST', token, body: payload });
      onBack();
    } catch (err) { alert(err.message); }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <button onClick={onBack} className="text-sm text-slate-600 hover:underline">← Back</button>
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
        <h2 className="text-xl font-bold">{plan.id ? 'Edit Plan' : 'New Lesson Plan'}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div><label className="block text-sm font-medium mb-1">Title</label><input className="w-full border p-2 rounded" value={form.title} onChange={e=>setForm({...form, title: e.target.value})} /></div>
          <div><label className="block text-sm font-medium mb-1">Week Of</label><input type="date" className="w-full border p-2 rounded" value={form.weekOf} onChange={e=>setForm({...form, weekOf: e.target.value})} /></div>
        </div>
        <div><label className="block text-sm font-medium mb-1">Objective</label><textarea className="w-full border p-2 rounded" rows="2" value={form.objective} onChange={e=>setForm({...form, objective: e.target.value})} /></div>
        <div><label className="block text-sm font-medium mb-1">Standards (comma separated)</label><input className="w-full border p-2 rounded" value={form.standards} onChange={e=>setForm({...form, standards: e.target.value})} /></div>
        <div><label className="block text-sm font-medium mb-1">Activities / Procedures</label><textarea className="w-full border p-2 rounded" rows="4" value={form.activities} onChange={e=>setForm({...form, activities: e.target.value})} /></div>
        <div><label className="block text-sm font-medium mb-1">Assessment</label><textarea className="w-full border p-2 rounded" rows="2" value={form.assessment} onChange={e=>setForm({...form, assessment: e.target.value})} /></div>
        
        <div className="flex gap-2 pt-4">
          <Button variant="secondary" onClick={() => save('DRAFT')}><Save className="h-4 w-4"/> Save Draft</Button>
          <Button onClick={() => save('SUBMITTED')}>Submit to Principal</Button>
        </div>
      </div>
    </div>
  );
}

function PrincipalDashboard() {
  const { token } = useContext(AuthCtx);
  const [data, setData] = useState(null);

  useEffect(() => {
    apiCall('/analytics', { token }).then(setData).catch(console.error);
  }, []);

  if (!data) return <div className="p-8 text-center text-slate-500">Loading metrics...</div>;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">School Overview</h2>
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col items-center justify-center">
          <p className="text-slate-500 text-sm">Total Plans Logged</p>
          <p className="text-4xl font-bold text-[var(--brand-primary)]">{data.totalPlans}</p>
        </div>
        <div className="bg-white p-6 rounded-xl border shadow-sm flex flex-col items-center justify-center">
          <p className="text-slate-500 text-sm">Currently Submitted</p>
          <p className="text-4xl font-bold text-green-600">{data.submittedCount}</p>
        </div>
      </div>
      <div className="bg-white p-6 rounded-xl border shadow-sm">
        <h3 className="font-bold mb-4">Top Taught Standards</h3>
        {data.topStandards.length === 0 ? <p className="text-sm text-slate-500">No standards logged yet.</p> : (
          <ul className="space-y-3">
            {data.topStandards.map((std, i) => (
              <li key={i} className="flex justify-between items-center bg-slate-50 p-3 rounded">
                <span className="font-medium text-slate-700">{std.name}</span>
                <span className="text-sm bg-slate-200 px-2 py-1 rounded-full">{std.count} mentions</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function AdminBranding() {
  const { token } = useContext(AuthCtx);
  const { settings, reload } = useContext(BrandingCtx);
  const [appName, setAppName] = useState(settings['brand.appName'] || 'PlanBase');
  const [color, setColor] = useState(settings['brand.primaryColor'] || '#4f46e5');

  const save = async () => {
    await apiCall('/settings', { method: 'PUT', token, body: { key: 'brand.appName', value: appName } });
    await apiCall('/settings', { method: 'PUT', token, body: { key: 'brand.primaryColor', value: color } });
    reload();
    alert('Settings saved.');
  };

  return (
    <div className="bg-white p-6 rounded-xl border shadow-sm max-w-lg space-y-4">
      <h2 className="text-xl font-bold">App Branding</h2>
      <div><label className="block text-sm mb-1">Application Name</label><input className="w-full border p-2 rounded" value={appName} onChange={e=>setAppName(e.target.value)} /></div>
      <div>
        <label className="block text-sm mb-1">Primary Color</label>
        <div className="flex gap-2">
          <input type="color" value={color} onChange={e=>setColor(e.target.value)} className="h-10 w-20 cursor-pointer border" />
          <input className="flex-1 border p-2 rounded font-mono" value={color} onChange={e=>setColor(e.target.value)} />
        </div>
      </div>
      <Button onClick={save}>Save Branding</Button>
    </div>
  );
}

// --- Main Shell ---
function Shell() {
  const { user, logout } = useContext(AuthCtx);
  const { settings } = useContext(BrandingCtx);
  const [view, setView] = useState('dashboard');

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b px-6 py-3 flex justify-between items-center">
        <div className="font-bold text-xl text-[var(--brand-primary)]">{settings['brand.appName'] || 'PlanBase'}</div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-600">{user.name} ({user.role})</span>
          <button onClick={logout} className="text-slate-500 hover:text-red-600"><LogOut className="h-5 w-5" /></button>
        </div>
      </header>
      <div className="flex flex-1 max-w-6xl w-full mx-auto p-6 gap-6">
        <aside className="w-48 space-y-2">
          {user.role === 'TEACHER' && <button onClick={() => setView('dashboard')} className={`w-full flex gap-2 p-2 rounded ${view === 'dashboard' ? 'bg-slate-200 font-bold' : 'hover:bg-slate-100'}`}><FileText className="h-5 w-5"/> My Plans</button>}
          {['PRINCIPAL', 'ADMIN'].includes(user.role) && <button onClick={() => setView('dashboard')} className={`w-full flex gap-2 p-2 rounded ${view === 'dashboard' ? 'bg-slate-200 font-bold' : 'hover:bg-slate-100'}`}><BarChart3 className="h-5 w-5"/> Dashboard</button>}
          {user.role === 'ADMIN' && <button onClick={() => setView('branding')} className={`w-full flex gap-2 p-2 rounded ${view === 'branding' ? 'bg-slate-200 font-bold' : 'hover:bg-slate-100'}`}><Settings className="h-5 w-5"/> Branding</button>}
        </aside>
        <main className="flex-1">
          {view === 'dashboard' && user.role === 'TEACHER' && <TeacherDashboard />}
          {view === 'dashboard' && ['PRINCIPAL', 'ADMIN'].includes(user.role) && <PrincipalDashboard />}
          {view === 'branding' && user.role === 'ADMIN' && <AdminBranding />}
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrandingProvider>
        <AuthCtx.Consumer>
          {({ user }) => user ? <Shell /> : <LoginView />}
        </AuthCtx.Consumer>
      </BrandingProvider>
    </AuthProvider>
  );
}
