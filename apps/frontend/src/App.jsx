import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout        from './components/Layout';

import ScanPage      from './pages/ScanPage';
import MaskPage      from './pages/MaskPage';
import RewritePage   from './pages/RewritePage';
import AuditPage     from './pages/AuditPage';
import RulesPage     from './pages/RulesPage';
import SettingsPage  from './pages/SettingsPage';
import RiskSummaryCard from './components/RiskSummaryCard';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/"         element={<div style={{ padding: '24px' }}><RiskSummaryCard defaultDays={7} /></div>}   />
          <Route path="/scan"     element={<ScanPage />}     />
          <Route path="/mask"     element={<MaskPage />}     />
          <Route path="/rewrite"  element={<RewritePage />}  />
          <Route path="/audit"    element={<AuditPage />}    />
          <Route path="/rules"    element={<RulesPage />}    />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*"         element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}