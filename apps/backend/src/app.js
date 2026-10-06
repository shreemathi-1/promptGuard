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
const settingsRouter = require('./routes/settings');
const aiRouter       = require('./routes/ai');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.corsOrigins }));
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
app.use('/api/settings', settingsRouter);
app.use('/api/ai',       aiRouter);

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

// Only listen when run directly, so tests can import the app
if (require.main === module) {
  start();
}

module.exports = app;