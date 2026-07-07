const SHEET_ID = '1rShk4vaQZtchZf7GKjCmA3Q_xamtLm3Sb9eUaBEKagg';
const ANNUAL_GID = '1501069044';

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

function parseMonthSheet(rows) {
  const members = [];
  let totalRowIdx = -1;

  for (let i = 1; i < rows.length; i++) {
    const name = (rows[i][0] || '').trim();
    if (!name) continue;
    if (name.toLowerCase() === 'total') { totalRowIdx = i; break; }
    const member = { name };
    LEADERBOARD_COLUMNS.forEach((col, idx) => {
      member[col.key] = (rows[i][idx + 1] || '').trim();
    });
    members.push(member);
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

  const hasData = members.some((m) => m.convAssigned !== '');
  return { members, groups, hasData };
}

function lookup(map, candidates) {
  for (const c of candidates) {
    const hit = map.get(c.toLowerCase());
    if (hit && hit.current !== '') return hit.current;
  }
  return null;
}

function extractTiles(parsed) {
  return {
    'New Conversations': lookup(parsed.groups[0], ['New Conversations']),
    'Phone Answer Rate': lookup(parsed.groups[6], ['Answer Rate']),
    'Office Hours Attendees': lookup(parsed.groups[11], ['Total Attendees', 'Total Atendees']),
    'AI Resolution Rate': lookup(parsed.groups[0], ['AI Resolution Rate', 'AI Confirmed Resolution Rate']),
    'Article Views': lookup(parsed.groups[11], ['Total Artcile Views', 'Total Article Views', 'Total Help Article Search']),
  };
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

function sortValue(str) {
  if (str == null || String(str).trim() === '' || str === '-') return null;
  const s = String(str).trim();
  if (/^\d{1,3}:\d{2}(:\d{2})?$/.test(s)) {
    const parts = s.split(':').map(Number);
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  const cleaned = s.replace(/[%,]/g, '');
  const n = parseFloat(cleaned);
  return Number.isNaN(n) ? s.toLowerCase() : n;
}

function showError(message) {
  const el = document.getElementById('error-banner');
  el.textContent = message;
  el.hidden = false;
}

function renderTiles(tiles) {
  const el = document.getElementById('tiles');
  el.innerHTML = '';
  Object.entries(tiles).forEach(([label, value]) => {
    const div = document.createElement('div');
    div.className = 'tile';
    div.innerHTML = `<div class="label">${label}</div><div class="value">${value != null ? value : '–'}</div>`;
    el.appendChild(div);
  });
}

let sortState = { key: null, dir: 1 };

function renderLeaderboard(members) {
  const thead = document.querySelector('#leaderboard thead');
  const tbody = document.querySelector('#leaderboard tbody');

  const columns = [{ key: 'name', label: 'Name' }, ...LEADERBOARD_COLUMNS];

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
    th.addEventListener('click', () => {
      if (sortState.key === col.key) sortState.dir *= -1;
      else { sortState.key = col.key; sortState.dir = 1; }
      renderLeaderboard(members);
    });
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

  tbody.innerHTML = '';
  rows.forEach((m) => {
    const tr = document.createElement('tr');
    columns.forEach((col) => {
      const td = document.createElement('td');
      const v = m[col.key];
      td.textContent = v && v !== '' ? v : '–';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function renderMonth(entry) {
  renderTiles(extractTiles(entry.parsed));
  renderLeaderboard(entry.parsed.members);
}

function populateMonthSelect(entries, selectedGid) {
  const select = document.getElementById('month-select');
  select.innerHTML = '';
  entries.forEach((entry) => {
    const opt = document.createElement('option');
    opt.value = entry.gid;
    opt.textContent = entry.name;
    if (entry.gid === selectedGid) opt.selected = true;
    select.appendChild(opt);
  });
}

const charts = {};

function drawLineChart(canvasId, labels, datasets) {
  const ctx = document.getElementById(canvasId);
  if (charts[canvasId]) charts[canvasId].destroy();
  charts[canvasId] = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      spanGaps: true,
      plugins: { legend: { display: datasets.length > 1 } },
      scales: { y: { beginAtZero: false } },
    },
  });
}

function renderTrends(series) {
  const seriesFor = (label) => MONTH_NAMES.map((_, i) => toNumber((series.get(label.toLowerCase()) || [])[i]));

  const newConv = seriesFor('New Conversations');
  const assigned = seriesFor('Conversations Assigned');
  const answerRate = seriesFor('Answer Rate');
  const csatPct = seriesFor('CSAT%');
  const aiResolution = seriesFor('AI Resolution Rate');
  const avgPerTeammate = seriesFor('Avg Assigned Convers Per Team Member');

  const trimmed = trimTrailingEmpty(MONTH_NAMES, [newConv, assigned, answerRate, csatPct, aiResolution, avgPerTeammate]);
  const [tNewConv, tAssigned, tAnswerRate, tCsatPct, tAiResolution, tAvgPerTeammate] = trimmed.arrays;

  document.querySelector('#chart-conversations').style.display = '';
  drawLineChart('chart-conversations', trimmed.labels, [
    { label: 'New Conversations', data: tNewConv, borderColor: '#2f6feb', tension: 0.3 },
    { label: 'Conversations Assigned', data: tAssigned, borderColor: '#9a6fe0', tension: 0.3 },
  ]);
  drawLineChart('chart-answer-rate', trimmed.labels, [
    { label: 'Answer Rate %', data: tAnswerRate, borderColor: '#1a8754', tension: 0.3 },
  ]);
  drawLineChart('chart-csat', trimmed.labels, [
    { label: 'CSAT %', data: tCsatPct, borderColor: '#e0a02f', tension: 0.3 },
  ]);
  drawLineChart('chart-ai-resolution', trimmed.labels, [
    { label: 'AI Resolution Rate %', data: tAiResolution, borderColor: '#d1373f', tension: 0.3 },
  ]);
  drawLineChart('chart-avg-per-teammate', trimmed.labels, [
    { label: 'Avg Conversations / Teammate', data: tAvgPerTeammate, borderColor: '#2f9ceb', tension: 0.3 },
  ]);
}

async function main() {
  try {
    const monthResults = await Promise.all(
      MONTH_TABS.map(async (m) => {
        const rows = await fetchSheet(m.gid);
        return { ...m, parsed: parseMonthSheet(rows) };
      })
    );

    const monthsWithData = monthResults.filter((m) => m.parsed.hasData);
    const optionList = monthsWithData.length ? monthsWithData : monthResults;
    const defaultEntry = optionList[optionList.length - 1];

    populateMonthSelect(optionList, defaultEntry.gid);
    renderMonth(defaultEntry);

    document.getElementById('month-select').addEventListener('change', (e) => {
      const selected = monthResults.find((m) => m.gid === e.target.value);
      if (selected) renderMonth(selected);
    });

    const annualRows = await fetchSheet(ANNUAL_GID);
    renderTrends(parseAnnualSheet(annualRows));

    document.getElementById('last-updated').textContent = `Data loaded ${new Date().toLocaleString()}`;
  } catch (err) {
    console.error(err);
    showError(`Couldn't load dashboard data: ${err.message}`);
  }
}

main();
