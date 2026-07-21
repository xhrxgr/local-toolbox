/**
 * Excel / CSV 操作处理（SheetJS xlsx）
 * 上下文 ctx: { files, text, options, setProgress, getBaseName }
 */
import * as XLSX from 'xlsx';
import { getBaseName } from './utils.js';

/* ========== Excel → CSV ========== */
export async function excelToCsv(ctx) {
  const { files, options, setProgress } = ctx;
  const file = files[0];
  const sheetIdx = parseInt(options['excel-sheet']) || 0;
  setProgress('解析 Excel...', '', 30);
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  if (sheetIdx >= wb.SheetNames.length) throw new Error(`工作表索引 ${sheetIdx} 超出范围（共 ${wb.SheetNames.length} 个工作表）`);
  const ws = wb.Sheets[wb.SheetNames[sheetIdx]];
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
  setProgress('完成', '', 100);
  return { text: csv, filename: `${getBaseName(file.name)}.csv` };
}

/* ========== Excel → JSON ========== */
export async function excelToJson(ctx) {
  const { files, options, setProgress } = ctx;
  const file = files[0];
  const sheetIdx = parseInt(options['excel-sheet']) || 0;
  setProgress('解析 Excel...', '', 30);
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });
  if (sheetIdx >= wb.SheetNames.length) throw new Error(`工作表索引 ${sheetIdx} 超出范围（共 ${wb.SheetNames.length} 个工作表）`);
  const ws = wb.Sheets[wb.SheetNames[sheetIdx]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  setProgress('完成', '', 100);
  return { text: JSON.stringify(json, null, 2), filename: `${getBaseName(file.name)}.json` };
}

/* ========== CSV → JSON ========== */
export async function csvToJson(ctx) {
  const { text, setProgress } = ctx;
  setProgress('解析 CSV...', '', 30);
  const wb = XLSX.read(text, { type: 'string' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
  setProgress('完成', '', 100);
  return { text: JSON.stringify(json, null, 2), filename: 'converted.json' };
}

/* ========== JSON → CSV ========== */
export async function jsonToCsv(ctx) {
  const { text, setProgress } = ctx;
  setProgress('解析 JSON...', '', 30);
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new Error('JSON 解析失败：' + e.message);
  }
  if (!Array.isArray(data)) {
    data = [data];
  }
  if (data.length === 0) {
    return { text: '', filename: 'converted.csv' };
  }
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws, { FS: ',', RS: '\n' });
  setProgress('完成', '', 100);
  return { text: csv, filename: 'converted.csv' };
}

/* ========== CSV → Excel ========== */
export async function csvToExcel(ctx) {
  const { text, setProgress } = ctx;
  setProgress('生成 Excel...', '', 30);
  const wb = XLSX.read(text, { type: 'string' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const out = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(out, ws, 'Sheet1');
  const arrayBuffer = XLSX.write(out, { type: 'array', bookType: 'xlsx' });
  setProgress('完成', '', 100);
  return [{ blob: new Blob([arrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename: 'converted.xlsx' }];
}

export const HANDLERS = {
  'excel-to-csv':  excelToCsv,
  'excel-to-json': excelToJson,
  'csv-to-json':   csvToJson,
  'json-to-csv':   jsonToCsv,
  'csv-to-excel':  csvToExcel,
};
