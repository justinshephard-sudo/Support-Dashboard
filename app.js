const SHEET_ID = '1eqPYnDmD194GREzSIlfceLWmQyaBRW18mptL_uVRKCc';
const ANNUAL_GID = '1501069044';
const QUARTERLY_GID = '1582468207';

const MONTH_TABS = [
  { name: 'January', gid: '749310542' },
  { name: 'February', gid: '629761774' },
  { name: 'March', gid: '427211915' },
  { name: 'April', gid: '1191771043' },
  { name: 'May', gid: '1345375097' },
  { name: 'June', gid: '180112901' },
  { name: 'July', gid: '2102059487' },
  { name: 'August', gid: '356947838' },
  { name: 'September', gid: '1159895850' },
  { name: 'October', gid: '444084634' },
  { name: 'November', gid: '2021455964' },
  { name: 'December', gid: '142641585' },
];

const QUARTER_NAMES = ['Q1', 'Q2', 'Q3', 'Q4'];
const QUARTER_MONTH_INDEXES = {
  Q1: [0, 1, 2],
  Q2: [3, 4, 5],
  Q3: [6, 7, 8],
  Q4: [9, 10, 11],
};

const EXCLUDED_NAMES = new Set(['justin', 'dakota', 'erika']);

const LEADERBOARD_COLUMNS = [
  { key: 'convAssigned', label: 'Conv Assigned' },
  { key: 'convReplied', label: 'Conv Replied' },
  { key: 'totalCalls', label: 'Total Calls' },
  { key: 'missedCalls', label: 'Missed Calls' },
  { key: 'phoneAnswerRate', label: 'Phone Answer %' },
  { key: 'csat', label: 'CSAT' },
  { key: 'csatPct', label: 'CSAT %' },
  { key: 'dsat', label: 'DSAT' },
  { key: 'dsatPct', label: 'DSAT %' },
  { key: 'reviewedPct', label: 'Reviewed %' },
  { key: 'cx', label: 'CX' },
  { key: 'newTickets', label: 'New Tickets' },
  { key: 'avg1stResponse', label: 'Avg 1st Response' },
  { key: 'avgRespTime', label: 'Avg Resp Time' },
  { key: 'closedConv', label: 'Closed Conv' },
  { key: 'closingTime', label: 'Closing Time' },
  { key: 'supportCalls', label: 'Support Calls' },
  { key: 'tbDemos', label: 'TB Demos' },
  { key: 'totalDemos', label: 'Total Demos' },
];

const MONTH_NAMES = MONTH_TABS.map((m) => m.name);

function csvUrl(gid) {
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // skip
    } else {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

async function fetchSheet(gid) {
  const res = await fetch(csvUrl(gid));
  if (!res.ok) throw new Error(`Failed to load sheet data (gid=${gid}): HTTP ${res.status}`);
  const text = await res.text();
  return parseCSV(text).filter((r) => r.some((cell) => cell.trim() !== ''));
}

function readMemberRow(row) {
  const name = (row[0] || '').trim();
  if (!name || EXCLUDED_NAMES.has(name.toLowerCase())) return null;
  const member = { name };
  LEADERBOARD_COLUMNS.forEach((col, idx) => {
    member[col.key] = (row[idx + 1] || '').trim();
  });
  return member;
}

function memberHasData(m) {
  const n = parseFloat((m.convAssigned || '').replace(/,/g, ''));
  return !Number.isNaN(n) && n > 0;
}

function parseMonthSheet(rows) {
  const members = [];
  let totalRowIdx = -1;

  for (let i = 1; i < rows.length; i++) {
    const rawName = (rows[i][0] || '').trim();
    if (!rawName) continue;
    if (rawName.toLowerCase() === 'total') { totalRowIdx = i; break; }
    const member = readMemberRow(rows[i]);
    if (member) members.push(member);
  }

  const groups = { 0: new Map(), 6: new Map(), 11: new Map() };
  if (totalRowIdx !== -1) {
    for (let i = totalRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      for (const start of [0, 6, 11]) {
        const label = (row[start] || '').trim();
        if (!label) continue;
        groups[start].set(label.toLowerCase(), {
          current: (row[start + 1] || '').trim(),
          prior: (row[start + 2] || '').trim(),
          pct: (row[start + 3] || '').trim(),
        });
      }
    }
  }

  const hasData = members.some(memberHasData);
  return { members, groups, hasData };
}

function parseQuarterlySheet(rows) {
  const quarters = {};

  const readBlock = (startIdx) => {
    const members = [];
    for (let i = startIdx; i < startIdx + 8 && i < rows.length; i++) {
      const member = readMemberRow(rows[i]);
      if (member) members.push(member);
    }
    return { members, hasData: members.some(memberHasData) };
  };

  quarters.Q1 = readBlock(1);
  for (let i = 0; i < rows.length; i++) {
    const label = (rows[i][0] || '').trim().toUpperCase();
    if (label === 'Q2' || label === 'Q3' || label === 'Q4') {
      quarters[label] = readBlock(i + 2);
    }
  }
  return quarters;
}

function lookup(map, candidates) {
  for (const c of candidates) {
    const hit = map.get(c.toLowerCase());
    if (hit && hit.current !== '') return hit.current;
  }
  return null;
}

const TILE_DEFS = [
  { label: 'New Conversations', icon: '💬', slot: 1, get: (p) => lookup(p.groups[0], ['New Conversations']) },
  { label: 'Phone Answer Rate', icon: '📞', slot: 2, get: (p) => lookup(p.groups[6], ['Answer Rate']) },
  { label: 'Office Hours Attendees', icon: '🎓', slot: 3, get: (p) => lookup(p.groups[11], ['Total Attendees', 'Total Atendees']) },
  { label: 'AI Resolution Rate', icon: '🤖', slot: 5, get: (p) => lookup(p.groups[0], ['AI Resolution Rate', 'AI Confirmed Resolution Rate']) },
  { label: 'Article Views', icon: '📄', slot: 8, get: (p) => lookup(p.groups[11], ['Total Artcile Views', 'Total Article Views', 'Total Help Article Search']) },
];

function extractTiles(parsed) {
  return TILE_DEFS.map((def) => ({
    label: def.label,
    icon: def.icon,
    slot: def.slot,
    value: def.get(parsed),
  }));
}

function parseAnnualSheet(rows) {
  const series = new Map();
  for (let i = 1; i < rows.length; i++) {
    const label = (rows[i][0] || '').trim();
    if (!label) continue;
    const values = MONTH_NAMES.map((_, idx) => (rows[i][idx + 1] || '').trim());
    series.set(label.toLowerCase(), values);
  }
  return series;
}

function toNumber(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/[%,]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function fmtNum(n) {
  return n == null ? null : Math.round(n).toLocaleString();
}

function fmtPct(n) {
  return n == null ? null : `${(Math.round(n * 10) / 10)}%`;
}

const QUARTER_TILE_DEFS = [
  { label: 'New Conversations', icon: '💬', slot: 1, source: 'annual', series: 'New Conversations', agg: 'sum', fmt: fmtNum },
  { label: 'Phone Answer Rate', icon: '📞', slot: 2, source: 'annual', series: 'Answer Rate', agg: 'avg', fmt: fmtPct },
  // "Total Atendees" in the Annual tab has a pre-existing formatting bug in most months
  // (values render as bogus percentages); each month tab's own cell is clean, so sum those instead.
  { label: 'Office Hours Attendees', icon: '🎓', slot: 3, source: 'monthlyTile', series: 'Office Hours Attendees', agg: 'sum', fmt: fmtNum },
  { label: 'AI Resolution Rate', icon: '🤖', slot: 5, source: 'annual', series: 'AI Resolution Rate', agg: 'avg', fmt: fmtPct },
  { label: 'Article Views', icon: '📄', slot: 8, source: 'annual', series: 'Total Help Article Search', agg: 'sum', fmt: fmtNum },
];

function extractQuarterTiles(annualSeries, monthlyTileValues, monthIndexes) {
  return QUARTER_TILE_DEFS.map((def) => {
    const values = monthIndexes
      .map((idx) => {
        if (def.source === 'monthlyTile') {
          const tile = (monthlyTileValues[idx] || []).find((t) => t.label === def.series);
          return tile ? toNumber(tile.value) : null;
        }
        return toNumber((annualSeries.get(def.series.toLowerCase()) || [])[idx]);
      })
      .filter((v) => v != null);
    let agg = null;
    if (values.length) {
      agg = def.agg === 'sum' ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length;
    }
    return { label: def.label, icon: def.icon, slot: def.slot, value: def.fmt(agg) };
  });
}

function trimTrailingEmpty(labels, arrays) {
  let lastIdx = -1;
  arrays.forEach((arr) => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i] != null) { lastIdx = Math.max(lastIdx, i); break; }
    }
  });
  if (lastIdx === -1) return { labels: [], arrays: arrays.map(() => []) };
  return {
    labels: labels.slice(0, lastIdx + 1),
    arrays: arrays.map((arr) => arr.slice(0, lastIdx + 1)),
  };
}

function parseTimeToSeconds(str) {
  if (str == null || String(str).trim() === '' || str === '-') return null;
  const s = String(str).trim();
  if (!/^\d{1,3}:\d{2}(:\d{2})?$/.test(s)) return null;
  const parts = s.split(':').map(Number);
  return parts.reduce((acc, v) => acc * 60 + v, 0);
}

function sortValue(str) {
  if (str == null || String(str).trim() === '' || str === '-') return null;
  const s = String(str).trim();
  const asTime = parseTimeToSeconds(s);
  if (asTime != null) return asTime;
  const cleaned = s.replace(/[%,]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? s.toLowerCase() : n;
}

function showError(message) {
  const el = document.getElementById('error-banner');
  el.textContent = message;
  el.hidden = false;
}

function renderTiles(containerId, tiles) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  tiles.forEach(({ label, icon, slot, value }) => {
    const div = document.createElement('div');
    div.className = 'tile';
    div.style.setProperty('--tile-accent', `var(--slot-${slot})`);
    div.innerHTML = `<span class="icon">${icon}</span><div class="label">${label}</div><div class="value">${value != null ? value : '–'}</div>`;
    el.appendChild(div);
  });
}

function moodFace(csatPct) {
  const n = toNumber(csatPct);
  if (n == null) return '';
  if (n >= 97) return '🤩';
  if (n >= 92) return '😄';
  if (n >= 85) return '🙂';
  if (n >= 75) return '😐';
  return '😟';
}

function computeIncentiveWinner(members, def) {
  let winner = null;
  let bestVal = def.better === 'lower' ? Infinity : -Infinity;
  members.forEach((m) => {
    const v = def.metric(m);
    if (v == null) return;
    if ((def.better === 'lower' && v < bestVal) || (def.better === 'higher' && v > bestVal)) {
      bestVal = v;
      winner = m;
    }
  });
  return winner ? { name: winner.name, statText: def.format(winner), tiedWith: [] } : null;
}

// Best Answer Rate: ties on the rate itself are broken by total call volume
// (more calls at the same rate is the stronger result), but everyone who tied
// on the rate still gets surfaced in the card, not just the tiebreak winner.
function computeAnswerRateWinner(members) {
  const withRate = members
    .map((m) => ({ m, rate: toNumber(m.phoneAnswerRate) }))
    .filter((x) => x.rate != null);
  if (!withRate.length) return null;

  const maxRate = Math.max(...withRate.map((x) => x.rate));
  const tiedGroup = withRate.filter((x) => x.rate === maxRate).map((x) => x.m);

  let winner = tiedGroup[0];
  if (tiedGroup.length > 1) {
    winner = tiedGroup.reduce((best, m) => {
      const calls = toNumber(m.totalCalls) ?? -Infinity;
      const bestCalls = toNumber(best.totalCalls) ?? -Infinity;
      return calls > bestCalls ? m : best;
    }, tiedGroup[0]);
  }

  const tiedWith = tiedGroup.filter((m) => m.name !== winner.name).map((m) => m.name);
  return {
    name: winner.name,
    statText: `${winner.phoneAnswerRate} answer rate${winner.totalCalls ? ` · ${winner.totalCalls} calls` : ''}`,
    tiedWith,
    tiedStatLabel: winner.phoneAnswerRate,
  };
}

const INCENTIVE_DEFS = [
  {
    key: 'speed',
    compute: (members) => computeIncentiveWinner(members, {
      metric: (m) => parseTimeToSeconds(m.avgRespTime),
      better: 'lower',
      format: (m) => `${m.avgRespTime} avg response`,
    }),
  },
  { key: 'answer', compute: computeAnswerRateWinner },
  {
    key: 'csat',
    compute: (members) => computeIncentiveWinner(members, {
      metric: (m) => toNumber(m.csat),
      better: 'higher',
      format: (m) => `${m.csat} CSAT ratings`,
    }),
  },
];

function renderIncentives(members) {
  INCENTIVE_DEFS.forEach((def) => {
    const result = def.compute(members);
    const card = document.querySelector(`[data-incentive="${def.key}"]`);
    if (!card) return;
    const nameEl = card.querySelector('.incentive-winner');
    const statEl = card.querySelector('.incentive-stat');
    const tiedEl = card.querySelector('.incentive-tied');
    if (nameEl) nameEl.textContent = result ? result.name : 'No winner yet';
    if (statEl) statEl.textContent = result ? result.statText : '–';
    if (tiedEl) {
      const hasTie = result && result.tiedWith && result.tiedWith.length > 0;
      tiedEl.textContent = hasTie
        ? `🤝 Also tied at ${result.tiedStatLabel}: ${result.tiedWith.join(', ')}`
        : '';
      tiedEl.hidden = !hasTie;
    }
    card.classList.toggle('is-empty', !result);
  });
}

function createLeaderboardRenderer(tableId) {
  const sortState = { key: null, dir: 1 };

  return function renderLeaderboard(members) {
    const thead = document.querySelector(`#${tableId} thead`);
    const tbody = document.querySelector(`#${tableId} tbody`);
    const columns = [{ key: 'name', label: 'Name' }, { key: 'mood', label: '' }, ...LEADERBOARD_COLUMNS];

    thead.innerHTML = '';
    const headRow = document.createElement('tr');
    columns.forEach((col) => {
      const th = document.createElement('th');
      th.textContent = col.label;
      th.dataset.key = col.key;
      if (sortState.key === col.key) {
        th.classList.add('sorted');
        if (sortState.dir === -1) th.classList.add('asc');
      }
      if (col.key !== 'mood') {
        th.addEventListener('click', () => {
          if (sortState.key === col.key) sortState.dir *= -1;
          else { sortState.key = col.key; sortState.dir = 1; }
          renderLeaderboard(members);
        });
      } else {
        th.style.cursor = 'default';
      }
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);

    let rows = [...members];
    if (sortState.key) {
      rows.sort((a, b) => {
        const av = sortValue(a[sortState.key]);
        const bv = sortValue(b[sortState.key]);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === 'string' || typeof bv === 'string') {
          return String(av).localeCompare(String(bv)) * sortState.dir;
        }
        return (av - bv) * sortState.dir;
      });
    }

    let fastestName = null;
    let fastestTime = Infinity;
    members.forEach((m) => {
      const secs = parseTimeToSeconds(m.avgRespTime);
      if (secs != null && secs < fastestTime) { fastestTime = secs; fastestName = m.name; }
    });

    tbody.innerHTML = '';
    rows.forEach((m) => {
      const tr = document.createElement('tr');
      columns.forEach((col) => {
        const td = document.createElement('td');
        if (col.key === 'name') {
          td.textContent = m.name;
          if (m.name === fastestName) {
            const crown = document.createElement('span');
            crown.className = 'crown';
            crown.textContent = '👑';
            crown.title = `${m.name} has the fastest average response time this period!`;
            td.appendChild(crown);
          }
        } else if (col.key === 'mood') {
          td.textContent = moodFace(m.csatPct);
          td.className = 'mood-cell';
        } else {
          const v = m[col.key];
          td.textContent = v && v !== '' ? v : '–';
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  };
}

const renderMonthlyLeaderboard = createLeaderboardRenderer('leaderboard');
const renderQuarterlyLeaderboard = createLeaderboardRenderer('quarterly-leaderboard');

function renderMonth(entry) {
  renderTiles('tiles', extractTiles(entry.parsed));
  renderMonthlyLeaderboard(entry.parsed.members);
  renderIncentives(entry.parsed.members);
  updateMascot(entry.parsed.members, entry.name);
}

function populateSelect(selectId, entries, selectedValue, valueKey, labelKey) {
  const select = document.getElementById(selectId);
  select.innerHTML = '';
  entries.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry[valueKey];
    opt.textContent = entry[labelKey];
    if (entry[valueKey] === selectedValue) opt.selected = true;
    select.appendChild(opt);
  });
}

const charts = {};
const chartBuddyEmoji = { up: ['🚀', '🎉', '🔥'], flat: ['😌', '👍'], down: ['😅', '💪'] };

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function withAlpha(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function updateChartBuddy(canvasId, data) {
  const buddy = document.querySelector(`[data-buddy-for="${canvasId}"]`);
  if (!buddy) return;
  const valid = data.filter((v) => v != null);
  if (valid.length < 2) { buddy.textContent = '🧐'; return; }
  const delta = valid[valid.length - 1] - valid[0];
  const magnitude = Math.abs(delta) / (Math.abs(valid[0]) || 1);
  let bucket = 'flat';
  if (magnitude > 0.03) bucket = delta > 0 ? 'up' : 'down';
  const choices = chartBuddyEmoji[bucket];
  buddy.textContent = choices[Math.floor(Math.random() * choices.length)];
  buddy.dataset.mood = bucket;
}

function drawLineChart(canvasId, labels, datasets, yOpts = {}) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  const gridColor = cssVar('--border');
  const tickColor = cssVar('--faint');
  // Anchoring the y-axis at 0 (and at 100 for percentage metrics), rather than
  // letting Chart.js auto-fit tightly to the data's min/max, keeps normal
  // month-to-month wobble from reading as a dramatic swing.
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((d) => ({
        borderWidth: 2.5,
        pointRadius: 3,
        pointHoverRadius: 6,
        pointBackgroundColor: d.borderColor,
        pointBorderColor: cssVar('--surface'),
        pointBorderWidth: 2,
        backgroundColor: withAlpha(d.borderColor, 0.12),
        fill: datasets.length === 1,
        tension: 0.3,
        ...d,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      spanGaps: true,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: datasets.length > 1,
          labels: { color: tickColor, boxWidth: 10, boxHeight: 10, usePointStyle: true },
        },
      },
      scales: {
        x: { grid: { color: gridColor }, ticks: { color: tickColor } },
        y: {
          beginAtZero: true,
          min: yOpts.min ?? 0,
          max: yOpts.max,
          grid: { color: gridColor },
          ticks: { color: tickColor },
        },
      },
    },
  });
  updateChartBuddy(canvasId, datasets[0].data);
}

function renderTrends(series, monthlyTileValues) {
  const seriesFor = (label) => MONTH_NAMES.map((_, i) => toNumber((series.get(label.toLowerCase()) || [])[i]));

  const newConv = seriesFor('New Conversations');
  const assigned = seriesFor('Conversations Assigned');
  const answerRate = seriesFor('Answer Rate');
  const csatPct = seriesFor('CSAT%');
  const aiResolution = seriesFor('AI Resolution Rate');
  const avgPerTeammate = seriesFor('Avg Assigned Convers Per Team Member');
  // Sourced from each month's own tab (not the Annual tab's "Total Atendees" row,
  // which has a pre-existing formatting bug for most months — see quarterly tiles).
  const officeAttendees = monthlyTileValues.map((tiles) => {
    const tile = tiles.find((t) => t.label === 'Office Hours Attendees');
    return tile ? toNumber(tile.value) : null;
  });

  const trimmed = trimTrailingEmpty(MONTH_NAMES, [newConv, assigned, answerRate, csatPct, aiResolution, avgPerTeammate, officeAttendees]);
  const [tNewConv, tAssigned, tAnswerRate, tCsatPct, tAiResolution, tAvgPerTeammate, tOfficeAttendees] = trimmed.arrays;

  drawLineChart('chart-conversations', trimmed.labels, [
    { label: 'New Conversations', data: tNewConv, borderColor: cssVar('--slot-1') },
    { label: 'Conversations Assigned', data: tAssigned, borderColor: cssVar('--slot-2') },
  ]);
  drawLineChart('chart-answer-rate', trimmed.labels, [
    { label: 'Answer Rate %', data: tAnswerRate, borderColor: cssVar('--slot-2') },
  ], { max: 100 });
  drawLineChart('chart-csat', trimmed.labels, [
    { label: 'CSAT %', data: tCsatPct, borderColor: cssVar('--slot-3') },
  ], { max: 100 });
  drawLineChart('chart-ai-resolution', trimmed.labels, [
    { label: 'AI Resolution Rate %', data: tAiResolution, borderColor: cssVar('--slot-5') },
  ], { max: 100 });
  drawLineChart('chart-avg-per-teammate', trimmed.labels, [
    { label: 'Avg Conversations / Teammate', data: tAvgPerTeammate, borderColor: cssVar('--slot-8') },
  ]);
  drawLineChart('chart-office-attendees', trimmed.labels, [
    { label: 'Office Hours Attendees', data: tOfficeAttendees, borderColor: cssVar('--slot-4') },
  ]);
}

const MASCOT_FACES = { great: '🦄', good: '🦉', meh: '🐢', rough: '🐌' };

function updateMascot(members, periodName) {
  const bubble = document.getElementById('mascot-bubble');
  const mascot = document.getElementById('mascot');
  if (!bubble || !mascot) return;

  let topName = null;
  let topCsat = -Infinity;
  const csatValues = [];
  members.forEach((m) => {
    const n = toNumber(m.csatPct);
    if (n != null) {
      csatValues.push(n);
      if (n > topCsat) { topCsat = n; topName = m.name; }
    }
  });

  if (!csatValues.length) {
    mascot.textContent = MASCOT_FACES.meh;
    bubble.textContent = `Waiting on the ${periodName} numbers to roll in... 👀`;
    return;
  }

  const avgCsat = csatValues.reduce((a, b) => a + b, 0) / csatValues.length;
  let face = MASCOT_FACES.good;
  let line = `${periodName} is looking solid! ${topName} is leading CSAT at ${topCsat}% 👑`;
  if (avgCsat >= 95) {
    face = MASCOT_FACES.great;
    line = `Whoa! ${periodName} CSAT is on fire 🔥 ${topName} is crushing it at ${topCsat}%!`;
  } else if (avgCsat < 85) {
    face = MASCOT_FACES.rough;
    line = `${periodName}'s a bit bumpy, but ${topName} is holding the line at ${topCsat}% CSAT 💪`;
  }
  mascot.textContent = face;
  bubble.textContent = line;
  mascot.classList.remove('bounce-once');
  requestAnimationFrame(() => mascot.classList.add('bounce-once'));
}

function launchConfetti() {
  const layer = document.getElementById('confetti-layer');
  if (!layer) return;
  const pieces = ['🎉', '✨', '🎊', '⭐', '💫'];
  for (let i = 0; i < 24; i++) {
    const span = document.createElement('span');
    span.className = 'confetti-piece';
    span.textContent = pieces[Math.floor(Math.random() * pieces.length)];
    span.style.left = `${Math.random() * 100}%`;
    span.style.animationDelay = `${Math.random() * 0.6}s`;
    span.style.animationDuration = `${2.2 + Math.random() * 1.2}s`;
    span.style.fontSize = `${14 + Math.random() * 14}px`;
    layer.appendChild(span);
    setTimeout(() => span.remove(), 4000);
  }
}

function renderQuarter(quarterKey, quarters, annualSeries, monthlyTileValues) {
  const q = quarters[quarterKey];
  if (!q) return;
  renderTiles('quarter-tiles', extractQuarterTiles(annualSeries, monthlyTileValues, QUARTER_MONTH_INDEXES[quarterKey]));
  renderQuarterlyLeaderboard(q.members);
}

async function main() {
  try {
    const monthResults = await Promise.all(
      MONTH_TABS.map(async (m) => {
        const rows = await fetchSheet(m.gid);
        return { ...m, parsed: parseMonthSheet(rows) };
      })
    );

    const monthlyTileValues = monthResults.map((m) => extractTiles(m.parsed));

    const monthsWithData = monthResults.filter((m) => m.parsed.hasData);
    const optionList = monthsWithData.length ? monthsWithData : monthResults;
    const defaultEntry = optionList[optionList.length - 1];

    populateSelect('month-select', optionList, defaultEntry.gid, 'gid', 'name');
    renderMonth(defaultEntry);

    document.getElementById('month-select').addEventListener('change', (e) => {
      const selected = monthResults.find((m) => m.gid === e.target.value);
      if (selected) renderMonth(selected);
    });

    const [annualRows, quarterlyRows] = await Promise.all([
      fetchSheet(ANNUAL_GID),
      fetchSheet(QUARTERLY_GID),
    ]);
    const annualSeries = parseAnnualSheet(annualRows);
    renderTrends(annualSeries, monthlyTileValues);

    const quarters = parseQuarterlySheet(quarterlyRows);
    const quarterOptions = QUARTER_NAMES
      .filter((q) => quarters[q] && quarters[q].hasData)
      .map((q) => ({ key: q, label: q }));
    const finalQuarterOptions = quarterOptions.length ? quarterOptions : [{ key: 'Q1', label: 'Q1' }];
    const defaultQuarter = finalQuarterOptions[finalQuarterOptions.length - 1].key;

    populateSelect('quarter-select', finalQuarterOptions, defaultQuarter, 'key', 'label');
    renderQuarter(defaultQuarter, quarters, annualSeries, monthlyTileValues);

    document.getElementById('quarter-select').addEventListener('change', (e) => {
      renderQuarter(e.target.value, quarters, annualSeries, monthlyTileValues);
    });

    document.getElementById('last-updated').textContent = `Data loaded ${new Date().toLocaleString()}`;
    launchConfetti();
  } catch (err) {
    console.error(err);
    showError(`Couldn't load dashboard data: ${err.message}`);
  }
}

main();
