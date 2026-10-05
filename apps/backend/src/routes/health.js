const express = require('express');
const { pool } = require('../config/db');
const mlClient = require('../services/mlClient');

const router = express.Router();

router.get('/', async (req, res) => {
  const status = {
    api: 'ok',
    database: 'unreachable',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
  };

  try {
    const result = await pool.query('SELECT NOW() AS db_time');
    status.database = 'ok';
    status.db_time = result.rows[0].db_time;
  } catch (err) {
    status.database = 'unreachable';
    status.db_error = err.message;
  }

  // ML is optional: when it is down, scans fall back to regex, so it doesn't affect isHealthy
  if (!mlClient.isEnabled()) {
    status.ml = 'disabled';
  } else {
    try {
      const ml = await mlClient.health();
      status.ml = ml.status;
      status.ml_models = { detector: ml.detector.model, injection: ml.injection.model };
    } catch (err) {
      status.ml = 'unavailable';
      status.ml_error = err.message;
    }
  }

  const isHealthy = status.api === 'ok' && status.database === 'ok';

  return res.status(isHealthy ? 200 : 503).json({
    success: isHealthy,
    data: status,
  });
});

module.exports = router;