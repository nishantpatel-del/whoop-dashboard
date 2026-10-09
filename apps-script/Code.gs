const RECOVERY_FILE_ID = '1MUUVhlepd27ANc4ZYg5ecx2bfb6S9kLE';
const SLEEP_FILE_ID    = '1dUrWISEXN2rs3Bvtl2z6YVXENSpL-ioo';
const CYCLES_FILE_ID   = '1LJXb--dY7VZbosQ5lGlXdCfehKmY91tK';
const WORKOUTS_FILE_ID = '1GUBdlVVBV4n_iRyfkg_LFspQX6_VVkPz';
const TZ = 'Asia/Dubai';

function doGet(e) {
  const data = buildDashboardData();
  const json = JSON.stringify(data);

  if (e && e.parameter && e.parameter.callback) {
    const callback = String(e.parameter.callback).replace(/[^\w.$]/g, '');
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

function testDashboardData() {
  console.log(JSON.stringify(buildDashboardData(), null, 2));
}

function buildDashboardData() {
  const recoveryRows = readCsv_(RECOVERY_FILE_ID)
    .map(r => ({
      date: localDate_(r.created_at),
      recovery: num_(r['score.recovery_score']),
      hrv: num_(r['score.hrv_rmssd_milli']),
      rhr: num_(r['score.resting_heart_rate'])
    }))
    .filter(r => r.date && finite_(r.recovery) && finite_(r.hrv) && finite_(r.rhr))
    .sort(byDate_);

  if (!recoveryRows.length) throw new Error('No valid recovery rows found.');

  const sleepRows = readCsv_(SLEEP_FILE_ID)
    .filter(r => String(r.nap).toLowerCase() !== 'true')
    .map(r => {
      const light = num_(r['score.stage_summary.total_light_sleep_time_milli']);
      const rem = num_(r['score.stage_summary.total_rem_sleep_time_milli']);
      const sws = num_(r['score.stage_summary.total_slow_wave_sleep_time_milli']);
      return {
        date: localDate_(r.created_at),
        sleepHours: (light + rem + sws) / 3600000,
        sleepDebtHours: num_(r['score.sleep_needed.need_from_sleep_debt_milli']) / 3600000,
        performance: num_(r['score.sleep_performance_percentage']),
        consistency: num_(r['score.sleep_consistency_percentage'])
      };
    })
    .filter(r => r.date && finite_(r.sleepHours))
    .sort(byDate_);

  const cycleRows = readCsv_(CYCLES_FILE_ID)
    .map(r => ({
      date: localDate_(r.created_at),
      strain: num_(r['score.strain']),
      steps: num_(r.step_count)
    }))
    .filter(r => r.date)
    .sort(byDate_);

  const workoutRows = readCsv_(WORKOUTS_FILE_ID)
    .map(r => ({
      date: localDate_(r.created_at),
      sport: String(r.sport_name || '').trim().toLowerCase()
    }))
    .filter(r => r.date)
    .sort(byDate_);

  const latestDate = recoveryRows[recoveryRows.length - 1].date;

  const last7Recovery = dateWindow_(recoveryRows, latestDate, 7);
  const prior28Recovery = priorWindow_(recoveryRows, latestDate, 7, 28);
  const last7Sleep = dateWindow_(sleepRows, latestDate, 7);
  const prior28Sleep = priorWindow_(sleepRows, latestDate, 7, 28);
  const last7Cycles = dateWindow_(cycleRows, latestDate, 7);
  const prior28Cycles = priorWindow_(cycleRows, latestDate, 7, 28);

  const recovery7 = avg_(last7Recovery.map(x => x.recovery));
  const recovery28 = avg_(prior28Recovery.map(x => x.recovery));
  const hrv7 = avg_(last7Recovery.map(x => x.hrv));
  const hrv28 = avg_(prior28Recovery.map(x => x.hrv));
  const rhr7 = avg_(last7Recovery.map(x => x.rhr));
  const rhr28 = avg_(prior28Recovery.map(x => x.rhr));
  const sleep7 = avg_(last7Sleep.map(x => x.sleepHours));
  const sleep28 = avg_(prior28Sleep.map(x => x.sleepHours));
  const debt7 = avg_(last7Sleep.map(x => x.sleepDebtHours).filter(finite_));
  const steps7 = avg_(last7Cycles.map(x => x.steps).filter(finite_));
  const steps28 = avg_(prior28Cycles.map(x => x.steps).filter(finite_));

  const recoveryDelta = recovery7 - recovery28;
  const hrvDeltaPct = pctDelta_(hrv7, hrv28);
  const rhrDelta = rhr7 - rhr28;
  const sleepDeltaMinutes = (sleep7 - sleep28) * 60;
  const stepsDeltaPct = pctDelta_(steps7, steps28);

  let status = 'STABLE';
  if (recoveryDelta >= 5 && hrvDeltaPct >= 3 && rhrDelta <= 0) status = 'IMPROVING';
  else if (recoveryDelta <= -5 && hrvDeltaPct <= -3 && rhrDelta >= 0) status = 'DECLINING';

  const daily = buildDailyDataset_(recoveryRows, sleepRows, cycleRows, workoutRows);
  const trajectory = buildTrajectory_(recoveryRows, latestDate);

  const sleepDose = [
    bucket_(daily, '<6.5h', d => finite_(d.sleepHours) && d.sleepHours < 6.5),
    bucket_(daily, '6.5–7h', d => finite_(d.sleepHours) && d.sleepHours >= 6.5 && d.sleepHours < 7),
    bucket_(daily, '7–7.5h', d => finite_(d.sleepHours) && d.sleepHours >= 7 && d.sleepHours < 7.5),
    bucket_(daily, '7.5–8h', d => finite_(d.sleepHours) && d.sleepHours >= 7.5 && d.sleepHours < 8),
    bucket_(daily, '≥8h', d => finite_(d.sleepHours) && d.sleepHours >= 8)
  ].filter(x => x.n > 0);

  const movement = [
    bucket_(daily, '<4k', d => finite_(d.stepsPrev) && d.stepsPrev < 4000),
    bucket_(daily, '4–6k', d => finite_(d.stepsPrev) && d.stepsPrev >= 4000 && d.stepsPrev < 6000),
    bucket_(daily, '6–8k', d => finite_(d.stepsPrev) && d.stepsPrev >= 6000 && d.stepsPrev < 8000),
    bucket_(daily, '8–10k', d => finite_(d.stepsPrev) && d.stepsPrev >= 8000 && d.stepsPrev < 10000),
    bucket_(daily, '≥10k', d => finite_(d.stepsPrev) && d.stepsPrev >= 10000)
  ].filter(x => x.n > 0);

  const drivers = [
    driverBinary_(daily, 'Cycling prior day', d => d.cyclingPrev === true, 'WATCH'),
    driverBinary_(daily, 'Sleep debt <1h', d => finite_(d.sleepDebtHours) && d.sleepDebtHours < 1, 'STRONG'),
    driverBinary_(daily, 'Actual sleep ≥7h', d => finite_(d.sleepHours) && d.sleepHours >= 7, 'STRONG'),
    driverBinary_(daily, 'Sleep performance ≥85%', d => finite_(d.sleepPerformance) && d.sleepPerformance >= 85, 'POSSIBLE'),
    driverContrast_(daily, '6–8k vs <4k steps',
      d => finite_(d.stepsPrev) && d.stepsPrev >= 6000 && d.stepsPrev < 8000,
      d => finite_(d.stepsPrev) && d.stepsPrev < 4000,
      'POSSIBLE'),
    driverBinary_(daily, 'Sleep consistency ≥80%', d => finite_(d.sleepConsistency) && d.sleepConsistency >= 80, 'NONE'),
    driverBinary_(daily, 'Weightlifting prior day', d => d.liftingPrev === true, 'STRONG'),
    driverBinary_(daily, 'Prior-day strain ≥16', d => finite_(d.strainPrev) && d.strainPrev >= 16, 'STRONG')
  ].filter(x => x.n > 0 || (x.nA && x.nB));

  const conclusions = buildConclusions_({
    recoveryDelta,
    hrvDeltaPct,
    rhrDelta,
    status,
    sleepDebtDriver: findDriver_(drivers, 'Sleep debt <1h'),
    sleep7Driver: findDriver_(drivers, 'Actual sleep ≥7h'),
    liftingDriver: findDriver_(drivers, 'Weightlifting prior day'),
    strainDriver: findDriver_(drivers, 'Prior-day strain ≥16'),
    stepDriver: findDriver_(drivers, '6–8k vs <4k steps')
  });

  return {
    updated: formatDate_(latestDate),
    recovery: round_(recovery7, 1),
    recovery_delta: round_(recoveryDelta, 1),
    hrv: round_(hrv7, 1),
    hrv_delta_pct: round_(hrvDeltaPct, 1),
    rhr: round_(rhr7, 1),
    rhr_delta: round_(rhrDelta, 1),
    sleep_hours: round_(sleep7, 2),
    sleep_display: formatHours_(sleep7),
    sleep_delta_minutes: round_(sleepDeltaMinutes, 0),
    sleep_debt_hours: round_(debt7, 2),
    sleep_debt_display: formatHours_(debt7),
    steps: Math.round(steps7 || 0),
    steps_delta_pct: round_(stepsDeltaPct, 1),
    status,
    trajectory,
    sleep_dose: sleepDose,
    movement,
    drivers,
    conclusions,
    signal_state_90d: build90DaySignalState_(daily),
    metadata: {
      recovery_days: recoveryRows.length,
      sleep_days: sleepRows.length,
      cycle_days: cycleRows.length,
      workouts: workoutRows.length,
      generated_at: new Date().toISOString()
    }
  };
}

function buildDailyDataset_(recoveryRows, sleepRows, cycleRows, workoutRows) {
  const sleepByDate = indexByDate_(sleepRows);
  const cyclesByDate = indexByDate_(cycleRows);
  const workoutsByDate = groupByDate_(workoutRows);

  return recoveryRows.map(r => {
    const key = dateKey_(r.date);
    const prevKey = dateKey_(addDays_(r.date, -1));
    const s = sleepByDate[key] || {};
    const prevCycle = cyclesByDate[prevKey] || {};
    const prevWorkouts = workoutsByDate[prevKey] || [];

    return {
      date: r.date,
      recovery: r.recovery,
      hrv: r.hrv,
      rhr: r.rhr,
      sleepHours: s.sleepHours,
      sleepDebtHours: s.sleepDebtHours,
      sleepPerformance: s.performance,
      sleepConsistency: s.consistency,
      stepsPrev: prevCycle.steps,
      strainPrev: prevCycle.strain,
      liftingPrev: prevWorkouts.some(w => isLifting_(w.sport)),
      cyclingPrev: prevWorkouts.some(w => isCycling_(w.sport)),
      walkingPrev: prevWorkouts.some(w => isWalking_(w.sport))
    };
  });
}

function buildTrajectory_(recoveryRows, latestDate) {
  const weeks = [];
  const currentWeekEnd = endOfWeek_(latestDate);

  for (let i = 11; i >= 0; i--) {
    const weekEnd = addDays_(currentWeekEnd, -7 * i);
    const weekStart = addDays_(weekEnd, -6);
    const week = recoveryRows.filter(r => r.date >= weekStart && r.date <= weekEnd);
    if (!week.length) continue;

    const baselineEnd = addDays_(weekStart, -1);
    const baselineStart = addDays_(baselineEnd, -27);
    const baseline = recoveryRows.filter(r => r.date >= baselineStart && r.date <= baselineEnd);
    if (baseline.length < 7) continue;

    const weekHrv = avg_(week.map(x => x.hrv));
    const weekRhr = avg_(week.map(x => x.rhr));
    const weekRec = avg_(week.map(x => x.recovery));
    const baseHrv = avg_(baseline.map(x => x.hrv));
    const baseRhr = avg_(baseline.map(x => x.rhr));
    const baseRec = avg_(baseline.map(x => x.recovery));

    weeks.push({
      label: Utilities.formatDate(weekEnd, TZ, 'd MMM'),
      date: formatDate_(weekEnd),
      hrv: round_(pctDelta_(weekHrv, baseHrv), 1),
      rhr: round_(-pctDelta_(weekRhr, baseRhr), 1),
      recovery: round_(pctDelta_(weekRec, baseRec), 1),
      n: week.length
    });
  }

  return weeks;
}

function bucket_(daily, label, predicate) {
  const rows = daily.filter(d => finite_(d.recovery) && predicate(d));
  return { label, recovery: round_(avg_(rows.map(d => d.recovery)), 1), n: rows.length };
}

function driverBinary_(daily, name, predicate, strength) {
  const yes = daily.filter(d => finite_(d.recovery) && predicate(d));
  const no = daily.filter(d => finite_(d.recovery) && !predicate(d));
  return {
    name,
    effect: round_(avg_(yes.map(d => d.recovery)) - avg_(no.map(d => d.recovery)), 1),
    n: yes.length,
    comparator_n: no.length,
    strength
  };
}

function driverContrast_(daily, name, predicateA, predicateB, strength) {
  const a = daily.filter(d => finite_(d.recovery) && predicateA(d));
  const b = daily.filter(d => finite_(d.recovery) && predicateB(d));
  return {
    name,
    effect: round_(avg_(a.map(d => d.recovery)) - avg_(b.map(d => d.recovery)), 1),
    nA: a.length,
    nB: b.length,
    strength
  };
}

function buildConclusions_(x) {
  let changed;
  const physiologyConfirms = x.hrvDeltaPct > 2 && x.rhrDelta < -0.5;
  const physiologyWeak = x.hrvDeltaPct < -2 || x.rhrDelta > 0.5;

  if (x.recoveryDelta > 2 && !physiologyConfirms) {
    changed = {
      title: 'Recovery improved, but physiology is still broadly stable.',
      body: 'Recovery rose versus the preceding 28 days, while HRV/RHR do not yet confirm a clear underlying upswing.'
    };
  } else if (x.status === 'IMPROVING') {
    changed = {
      title: 'Recovery and physiology are improving together.',
      body: 'Recovery, HRV and RHR are moving in a direction consistent with a genuine positive shift.'
    };
  } else if (x.status === 'DECLINING' || physiologyWeak) {
    changed = {
      title: 'Recent physiology has softened.',
      body: 'Recovery and/or autonomic markers are weaker than the preceding baseline and deserve a lower-load recovery emphasis.'
    };
  } else {
    changed = {
      title: 'Overall state remains stable.',
      body: 'Recent recovery, HRV and RHR are fluctuating around the established personal baseline rather than establishing a new trend.'
    };
  }

  const learnedParts = [
    driverPhrase_(x.sleepDebtDriver),
    driverPhrase_(x.sleep7Driver),
    driverPhrase_(x.liftingDriver),
    driverPhrase_(x.strainDriver),
    driverPhrase_(x.stepDriver)
  ].filter(Boolean);

  return [
    { key: 'changed', title: changed.title, body: changed.body },
    {
      key: 'learned',
      title: 'Sleep debt and actual sleep remain the clearest actionable levers.',
      body: learnedParts.join(' ')
    },
    {
      key: 'test',
      title: 'Lift → ≥7h sleep + <1h sleep debt.',
      body: 'Compare next-morning recovery, HRV and RHR with lifting days where either sleep condition is missed. If the lifting penalty persists, test lower lifting strain or wider recovery spacing.'
    }
  ];
}

function driverPhrase_(d) {
  if (!d || !finite_(d.effect)) return '';
  const sign = d.effect >= 0 ? '+' : '';
  return d.name + ' is associated with ' + sign + d.effect.toFixed(1) + ' recovery points.';
}

function build90DaySignalState_(daily) {
  if (daily.length < 60) return [];

  const latest = daily[daily.length - 1].date;
  const recentStart = addDays_(latest, -44);
  const priorEnd = addDays_(recentStart, -1);
  const priorStart = addDays_(priorEnd, -44);
  const recent = daily.filter(d => d.date >= recentStart && d.date <= latest);
  const prior = daily.filter(d => d.date >= priorStart && d.date <= priorEnd);

  const defs = [
    ['Sleep debt <1h', d => finite_(d.sleepDebtHours) && d.sleepDebtHours < 1],
    ['Actual sleep ≥7h', d => finite_(d.sleepHours) && d.sleepHours >= 7],
    ['Weightlifting prior day', d => d.liftingPrev === true],
    ['Prior-day strain ≥16', d => finite_(d.strainPrev) && d.strainPrev >= 16]
  ];

  return defs.map(([name, pred]) => {
    const recentEffect = driverBinary_(recent, name, pred, '').effect;
    const priorEffect = driverBinary_(prior, name, pred, '').effect;
    let state = 'stable';

    if (!finite_(priorEffect) && finite_(recentEffect)) state = 'emerging';
    else if (finite_(recentEffect) && finite_(priorEffect) && Math.abs(recentEffect) >= Math.abs(priorEffect) + 3) state = 'strengthening';
    else if (finite_(recentEffect) && finite_(priorEffect) && Math.abs(recentEffect) <= Math.max(0, Math.abs(priorEffect) - 3)) state = 'weakening';

    return { name, recent_effect: recentEffect, prior_effect: priorEffect, state };
  });
}

function readCsv_(fileId) {
  const text = DriveApp.getFileById(fileId).getBlob().getDataAsString();
  const rows = Utilities.parseCsv(text);
  if (!rows.length) return [];
  const headers = rows.shift().map(h => String(h).trim());

  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function localDate_(value) {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  const y = Number(Utilities.formatDate(d, TZ, 'yyyy'));
  const m = Number(Utilities.formatDate(d, TZ, 'MM'));
  const day = Number(Utilities.formatDate(d, TZ, 'dd'));
  return new Date(y, m - 1, day, 12, 0, 0);
}

function formatDate_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function dateKey_(d) {
  return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
}

function addDays_(d, days) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + days);
  return x;
}

function endOfWeek_(d) {
  const x = new Date(d.getTime());
  return addDays_(x, -x.getDay());
}

function dateWindow_(rows, endDate, days) {
  const start = addDays_(endDate, -(days - 1));
  return rows.filter(r => r.date >= start && r.date <= endDate);
}

function priorWindow_(rows, endDate, recentDays, previousDays) {
  const end = addDays_(endDate, -recentDays);
  const start = addDays_(end, -(previousDays - 1));
  return rows.filter(r => r.date >= start && r.date <= end);
}

function indexByDate_(rows) {
  const out = {};
  rows.forEach(r => out[dateKey_(r.date)] = r);
  return out;
}

function groupByDate_(rows) {
  const out = {};
  rows.forEach(r => {
    const k = dateKey_(r.date);
    if (!out[k]) out[k] = [];
    out[k].push(r);
  });
  return out;
}

function isLifting_(sport) {
  return /weight|strength|lifting|functional fitness|gym/.test(sport || '');
}

function isCycling_(sport) {
  return /cycling|bike|biking|spin/.test(sport || '');
}

function isWalking_(sport) {
  return /walk|walking|hike/.test(sport || '');
}

function findDriver_(drivers, name) {
  return drivers.find(d => d.name === name) || null;
}

function byDate_(a, b) { return a.date - b.date; }

function num_(v) {
  if (v === '' || v == null) return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function finite_(v) { return Number.isFinite(v); }

function avg_(values) {
  const valid = values.filter(finite_);
  if (!valid.length) return NaN;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

function pctDelta_(value, baseline) {
  if (!finite_(value) || !finite_(baseline) || baseline === 0) return NaN;
  return ((value - baseline) / baseline) * 100;
}

function round_(value, decimals) {
  if (!finite_(value)) return null;
  const p = Math.pow(10, decimals);
  return Math.round(value * p) / p;
}

function formatHours_(hours) {
  if (!finite_(hours)) return '—';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h + 'h ' + String(m).padStart(2, '0') + 'm';
}
