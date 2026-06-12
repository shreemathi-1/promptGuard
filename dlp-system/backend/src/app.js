const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const env     = require('./config/env');
const { testConnection } = require('./config/db');
const healthRouter   = require('./routes/health');
const scanRouter     = require('./routes/scan');
const maskRouter     = require('./routes/mask');
const auditRouter    = require('./routes/audit');
const rulesRouter    = require('./routes/rules');
const riskRouter     = require('./routes/risk');
const exportRouter   = require('./routes/export');
const settingsRouter = require('./routes/settings');     // ← ADD

const app = express();

app.use(helmet());
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(morgan('dev'));
app.use(express.json());

// Routes
app.use('/api/health',   healthRouter);
app.use('/api/scan',     scanRouter);
app.use('/api/mask',     maskRouter);
app.use('/api/audit',    auditRouter);
app.use('/api/rules',    rulesRouter);
app.use('/api/risk',     riskRouter);
app.use('/api/export',   exportRouter);
app.use('/api/settings', settingsRouter);               // ← ADD

app.get('/', (req, res) => {
  res.json({ success: true, data: { message: 'DLP API is running' } });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

async function start() {
  await testConnection();
  app.listen(env.port, () => {
    console.log(`[DLP] Backend running on http://localhost:${env.port}`);
  });
}

start();

module.exports = app;