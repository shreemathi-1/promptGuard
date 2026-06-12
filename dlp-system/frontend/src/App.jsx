import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout        from './components/Layout';
import HealthPage    from './pages/HealthPage';
import ScanPage      from './pages/ScanPage';
import MaskPage      from './pages/MaskPage';
import AuditPage     from './pages/AuditPage';
import RulesPage     from './pages/RulesPage';
import SettingsPage  from './pages/SettingsPage';             // ← ADD

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"         element={<HealthPage />}   />
          <Route path="/scan"     element={<ScanPage />}     />
          <Route path="/mask"     element={<MaskPage />}     />
          <Route path="/audit"    element={<AuditPage />}    />
          <Route path="/rules"    element={<RulesPage />}    />
          <Route path="/settings" element={<SettingsPage />} />  {/* ← ADD */}
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}