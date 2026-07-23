// ============================================================================
// HELPERS — export/import, misc UI utilities.
// ============================================================================
function downloadJSON(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function pickJSONFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try { resolve(JSON.parse(await file.text())); }
      catch (e) { resolve({ __error: String(e) }); }
    };
    // Dismissing the dialog without picking fires oncancel (Chrome/FF 91+);
    // without this the promise never settles and imports silently hang.
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// Date order is a user setting (settings.dateFormat), not locale-dependent.
const DATE_FORMATS = {
  'dd/mm/yyyy': (d, p) => `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
  'mm/dd/yyyy': (d, p) => `${p(d.getMonth() + 1)}/${p(d.getDate())}/${d.getFullYear()}`,
  'yyyy-mm-dd': (d, p) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`,
};
const fmtDate = (ts, fmt = 'dd/mm/yyyy') => {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${(DATE_FORMATS[fmt] ?? DATE_FORMATS['dd/mm/yyyy'])(d, p)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

