const express = require('express');
const router = express.Router();
const { getDailyReport, getWeeklyReport, todayKey } = require('../services/analytics');

const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-in-env';

function requireAdmin(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (!ADMIN_KEY || key !== ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

router.get('/today', requireAdmin, async (req, res) => {
  try {
    const report = await getDailyReport(todayKey());
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/day/:date', requireAdmin, async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.params.date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const report = await getDailyReport(req.params.date);
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/week', requireAdmin, async (req, res) => {
  try {
    const reports = await getWeeklyReport();
    const totals = reports.reduce(
      (acc, r) => ({
        total: acc.total + r.summary.total,
        success: acc.success + r.summary.success,
        failure: acc.failure + r.summary.failure,
      }),
      { total: 0, success: 0, failure: 0 }
    );

    res.json({
      period: '7 days',
      totals: {
        ...totals,
        successRate:
          totals.total > 0
            ? `${((totals.success / totals.total) * 100).toFixed(1)}%`
            : '0%',
      },
      daily: reports,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
