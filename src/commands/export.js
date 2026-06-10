const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');

function exportReport(options) {
  const format = options.format || 'json';
  const type = options.type || 'all';
  const output = options.output || '';

  let data = {};

  if (type === 'all' || type === 'account') data.account = store.load('account');
  if (type === 'all' || type === 'codepack') data.codepack = store.load('codepack');
  if (type === 'all' || type === 'batch') data.batch = store.load('batch');
  if (type === 'all' || type === 'flow') data.flow = store.load('flow');
  if (type === 'all' || type === 'verify') data.verify = store.load('verify');
  if (type === 'all' || type === 'report') data.report = store.load('report');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  if (format === 'json') {
    const fileName = output || `report-${timestamp}.json`;
    const filePath = path.resolve(fileName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    store.addLog('export', `导出JSON报告: ${filePath}`);
    console.log(chalk.green(`✓ 报告已导出: ${filePath}`));
    return;
  }

  if (format === 'csv') {
    const fileName = output || `report-${timestamp}.csv`;
    const filePath = path.resolve(fileName);
    let csvContent = '';

    Object.entries(data).forEach(([group, records]) => {
      if (!Array.isArray(records) || records.length === 0) return;
      csvContent += `\n=== ${group} ===\n`;
      const headers = Object.keys(records[0]).filter(k => k !== 'codes');
      csvContent += headers.join(',') + '\n';
      records.forEach(r => {
        csvContent += headers.map(h => {
          const v = r[h];
          if (v === null || v === undefined) return '';
          if (typeof v === 'object') return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
          return String(v).includes(',') ? `"${v}"` : v;
        }).join(',') + '\n';
      });
    });

    fs.writeFileSync(filePath, csvContent, 'utf-8');
    store.addLog('export', `导出CSV报告: ${filePath}`);
    console.log(chalk.green(`✓ 报告已导出: ${filePath}`));
    return;
  }

  if (format === 'txt') {
    const fileName = output || `report-${timestamp}.txt`;
    const filePath = path.resolve(fileName);
    let txtContent = `药品追溯数据报告\n生成时间: ${new Date().toISOString()}\n${'='.repeat(50)}\n\n`;

    Object.entries(data).forEach(([group, records]) => {
      if (!Array.isArray(records) || records.length === 0) return;
      txtContent += `\n【${group}】 共 ${records.length} 条\n`;
      txtContent += '-'.repeat(30) + '\n';
      records.forEach(r => {
        Object.entries(r).forEach(([k, v]) => {
          if (k === 'codes') return;
          txtContent += `  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}\n`;
        });
        txtContent += '\n';
      });
    });

    fs.writeFileSync(filePath, txtContent, 'utf-8');
    store.addLog('export', `导出TXT报告: ${filePath}`);
    console.log(chalk.green(`✓ 报告已导出: ${filePath}`));
    return;
  }

  console.log(chalk.red(`不支持的格式: ${format}`));
  console.log(chalk.gray('支持格式: json, csv, txt'));
}

module.exports = exportReport;
