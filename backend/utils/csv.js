const escapeCsvValue = (value) => {
  if (value == null) {
    return '';
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
};

const toCsv = (headers, rows) => {
  const lines = [
    headers.map((header) => escapeCsvValue(header.label || header.key)).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header.key])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
};

const parseCsvLine = (line) => {
  const values = [];
  let current = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (quoted && char === '"' && next === '"') {
      current += '"';
      i += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
};

const fromCsv = (csv) => {
  const lines = String(csv || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return headers.reduce((row, header, index) => {
      row[header] = values[index] == null ? '' : values[index];
      return row;
    }, {});
  });
};

module.exports = {
  toCsv,
  fromCsv,
};
