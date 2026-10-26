const fs      = require('fs/promises');
const path    = require('path');
const express = require('express');
const { runDetection, DETECTION_MODES } = require('../services/detectionPipeline');
const { validate } = require('../middleware/validate');

const router = express.Router();

const MAX_INPUT_LENGTH = 50_000;

// eval/results/latest.json at the repo root; override in Docker with EVAL_RESULTS_PATH
const RESULTS_PATH = process.env.EVAL_RESULTS_PATH
  || path.resolve(__dirname, '../../../../eval/results/latest.json');

/**
 * POST /api/eval/scan
 *
 * Same detection pipeline as /api/scan, but nothing is written to the audit
 * log, so running the benchmark (hundreds of synthetic prompts per mode)
 * doesn't flood the dashboard.
 *
 * Body: { text, mode?: 'REGEX'|'AI'|'HYBRID', injectionCheck?: boolean }
 *   injectionCheck: false lets the benchmark time detection on its own
 */
router.post(
  '/scan',
  validate((req) => {
    const { text, mode, injectionCheck } = req.body;
    if (typeof text !== 'string' || text.trim().length === 0) return '"text" must be a non-empty string';
    if (text.length > MAX_INPUT_LENGTH) return `"text" exceeds maximum length of ${MAX_INPUT_LENGTH} characters`;
    if (mode !== undefined && !DETECTION_MODES.includes(mode)) {
      return `"mode" must be one of: ${DETECTION_MODES.join(', ')}`;
    }
    if (injectionCheck !== undefined && typeof injectionCheck !== 'boolean') return '"injectionCheck" must be a boolean';
  }),
  async (req, res, next) => {
    try {
      const { text, mode, injectionCheck } = req.body;
      const result = await runDetection(text, { mode, injectionCheck });
      return res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/eval/results
 *
 * The latest benchmark report written by eval/run_benchmark.py.
 */
router.get('/results', async (req, res, next) => {
  try {
    const raw = await fs.readFile(RESULTS_PATH, 'utf8');
    return res.status(200).json({ success: true, data: JSON.parse(raw) });
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({
        success : false,
        error   : 'No benchmark results yet. Run: python3 eval/run_benchmark.py',
      });
    }
    if (err instanceof SyntaxError) {
      return res.status(500).json({ success: false, error: `Benchmark results file is not valid JSON: ${err.message}` });
    }
    next(err);
  }
});

module.exports = router;
