const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');
const { buildFlowDiff, buildMissingIssues } = require('./export');

function parseTxtReport(content) {
  const data = { meta: { filters: {}, summary: {} }, sections: {} };
  const lines = content.split(/\r?\n/);

  const genMatch = lines.find(l => l.startsWith('生成时间:'));
  if (genMatch) data.meta.generatedAt = genMatch.replace('生成时间:', '').trim();
  const filterMatch = lines.find(l => l.startsWith('筛选条件:'));
  if (filterMatch) {
    const str = filterMatch.replace('筛选条件:', '').trim();
    const batchNoM = str.match(/批号:\s*(\S+)/);
    const orgM = str.match(/机构:\s*(\S+)/);
    const dateM = str.match(/日期范围:\s*(\S+)\s*~\s*(\S+)/);
    if (batchNoM) data.meta.filters.batchNo = batchNoM[1];
    if (orgM) data.meta.filters.org = orgM[1];
    if (dateM) { data.meta.filters.fromDate = dateM[1]; data.meta.filters.toDate = dateM[2]; }
  }
  const summaryMatch = lines.find(l => l.startsWith('数据概要:'));
  if (summaryMatch) {
    data.meta.summary.raw = summaryMatch;
  }
  return data;
}

function parseCSVReport(content) {
  const lines = content.split(/\r?\n/);
  const meta = { filters: {}, summary: {}, generatedAt: '' };
  for (let i = 0; i < lines.length && i < 30; i++) {
    const l = lines[i];
    if (l.startsWith('generatedAt,')) meta.generatedAt = l.split(',')[1];
    else if (l.startsWith('filterBatchNo,')) meta.filters.batchNo = l.split(',')[1];
    else if (l.startsWith('filterOrg,')) meta.filters.org = l.split(',')[1];
    else if (l.startsWith('filterFromDate,')) meta.filters.fromDate = l.split(',')[1];
    else if (l.startsWith('filterToDate,')) meta.filters.toDate = l.split(',')[1];
  }
  const sectionNames = [];
  lines.forEach(l => {
    if (l.startsWith('# ')) sectionNames.push(l.replace(/^#\s*/, ''));
  });
  return { meta, sections: sectionNames };
}

function audit(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) {
    console.log(chalk.red(`错误: 报告文件不存在: ${fullPath}`));
    return;
  }

  const ext = path.extname(fullPath).toLowerCase().replace('.', '');
  const content = fs.readFileSync(fullPath, 'utf-8');

  console.log(chalk.cyan('═══════════════════════════════════════════════'));
  console.log(chalk.cyan('  报告审计 (report audit)'));
  console.log(chalk.cyan('═══════════════════════════════════════════════'));
  console.log(chalk.white(`  文件: ${fullPath}`));
  console.log(chalk.white(`  格式: ${ext.toUpperCase()}`));
  console.log('');

  let reportData = null;
  const issues = [];
  const warnings = [];
  const passed = [];

  if (ext === 'json') {
    try {
      reportData = JSON.parse(content);
    } catch (e) {
      issues.push({ level: 'fatal', msg: `JSON 解析失败: ${e.message}` });
    }
  } else if (ext === 'csv') {
    reportData = parseCSVReport(content);
  } else if (ext === 'txt') {
    reportData = parseTxtReport(content);
  } else {
    issues.push({ level: 'fatal', msg: `不支持的格式: ${ext}` });
  }

  if (!reportData) {
    issues.push({ level: 'fatal', msg: '无法解析报告文件' });
  } else {
    const meta = reportData.meta || {};
    const filters = meta.filters || {};
    const summary = meta.summary || {};
    const sections = reportData.sections || [];

    if (ext === 'json') {
      const requiredKeys = ['meta', 'account', 'codepacks', 'batches', 'flows', 'verify', 'recall', 'diff', 'missing', 'logs'];
      requiredKeys.forEach(k => {
        if (!(k in reportData)) {
          issues.push({ level: 'error', msg: `缺少章节: ${k}` });
        }
      });
      if (reportData.diff && typeof reportData.diff.matched !== 'undefined') {
        const ok = reportData.diff.shipTotal === reportData.diff.matched.length + reportData.diff.unmatched.length;
        if (ok) passed.push('流向差异匹配: 发货总数 = 匹配数 + 未匹配数');
        else issues.push({ level: 'error', msg: `流向差异不一致: shipTotal(${reportData.diff.shipTotal}) ≠ matched(${reportData.diff.matched.length}) + unmatched(${reportData.diff.unmatched.length})` });
      }
      if (summary.batches !== undefined && Array.isArray(reportData.batches)) {
        if (summary.batches === reportData.batches.length) passed.push('批次数量: 概要 = 实际列表');
        else issues.push({ level: 'error', msg: `批次数量不一致: summary.batches(${summary.batches}) ≠ batches.length(${reportData.batches.length})` });
      }
      if (summary.flows !== undefined && Array.isArray(reportData.flows)) {
        if (summary.flows === reportData.flows.length) passed.push('流向数量: 概要 = 实际列表');
        else issues.push({ level: 'error', msg: `流向数量不一致: summary.flows(${summary.flows}) ≠ flows.length(${reportData.flows.length})` });
      }
      if (summary.missingItems !== undefined && Array.isArray(reportData.missing)) {
        if (summary.missingItems === reportData.missing.length) passed.push('缺失项数量: 概要 = 实际列表');
        else issues.push({ level: 'error', msg: `缺失项数量不一致: summary.missingItems(${summary.missingItems}) ≠ missing.length(${reportData.missing.length})` });
      }
      if (summary.matchedFlows !== undefined && reportData.diff) {
        if (summary.matchedFlows === reportData.diff.matched.length) passed.push('匹配流向数量: 概要 = 实际差异表');
        else issues.push({ level: 'error', msg: `匹配流向不一致: summary.matchedFlows(${summary.matchedFlows}) ≠ diff.matched.length(${reportData.diff.matched.length})` });
      }
      if (summary.unmatchedFlows !== undefined && reportData.diff) {
        if (summary.unmatchedFlows === reportData.diff.unmatched.length) passed.push('未匹配流向数量: 概要 = 实际差异表');
        else issues.push({ level: 'error', msg: `未匹配流向不一致: summary.unmatchedFlows(${summary.unmatchedFlows}) ≠ diff.unmatched.length(${reportData.diff.unmatched.length})` });
      }
    } else if (ext === 'csv') {
      const requiredSections = [
        '批次 (batches)', '流向 (flows)', '上下游差异 unmatched',
        '上下游差异 matched', '数量差异 qtyMismatch',
        '抽样验码 verify', '召回清单 recall', '缺失项 missing',
      ];
      requiredSections.forEach(s => {
        if (!sections.includes(s)) issues.push({ level: 'warn', msg: `可能缺少章节: ${s}（基于 # 标题检测）` });
      });
    } else if (ext === 'txt') {
      ['一、缺失项检查', '二、批次列表', '三、上下游流向比对', '四、抽样验码记录', '五、召回清单', '六、操作日志摘要'].forEach(s => {
        if (!content.includes(s)) issues.push({ level: 'warn', msg: `缺少章节: ${s}` });
      });
    }

    if (ext === 'json') {
      const cur = store.load('batch');
      const curFlows = store.load('flow');
      const f = filters;
      let expectedBatches = cur;
      let expectedFlows = curFlows;
      if (f.batchNo) { expectedBatches = expectedBatches.filter(b => b.batchNo === f.batchNo); expectedFlows = expectedFlows.filter(fl => fl.batchNo === f.batchNo); }
      if (f.org) expectedFlows = expectedFlows.filter(fl => (fl.from && fl.from.includes(f.org)) || (fl.to && fl.to.includes(f.org)));

      const actualBatchCount = Array.isArray(reportData.batches) ? reportData.batches.length : -1;
      const actualFlowCount = Array.isArray(reportData.flows) ? reportData.flows.length : -1;

      if (actualBatchCount >= 0) {
        if (actualBatchCount === expectedBatches.length) passed.push('批次数量与当前系统数据一致');
        else warnings.push({ msg: `批次数量与当前系统数据不同: 报告 ${actualBatchCount} / 当前系统 ${expectedBatches.length}（可能是历史报告，属于正常）` });
      }
      if (actualFlowCount >= 0) {
        if (actualFlowCount === expectedFlows.length) passed.push('流向数量与当前系统数据一致');
        else warnings.push({ msg: `流向数量与当前系统数据不同: 报告 ${actualFlowCount} / 当前系统 ${expectedFlows.length}（可能是历史报告，属于正常）` });
      }
    }

    if (meta.consistency && meta.consistency.flowShipsEqDiff === false) {
      issues.push({ level: 'error', msg: '报告自带一致性标记 flowShipsEqDiff 为 false' });
    }
    if (meta.generatedAt) passed.push(`报告生成时间: ${meta.generatedAt}`);
  }

  const fatalCount = issues.filter(i => i.level === 'fatal').length;
  const errCount = issues.filter(i => i.level === 'error').length;
  const warnCount = issues.filter(i => i.level === 'warn').length + warnings.length;

  console.log(chalk.white('  一、章节完整性检查'));
  if (issues.length === 0 && warnings.length === 0) {
    console.log(chalk.green('    ✓ 所有必要章节齐全'));
  } else {
    issues.forEach(i => console.log(chalk[i.level === 'fatal' || i.level === 'error' ? 'red' : 'yellow'](`    ✗ [${i.level}] ${i.msg}`)));
    warnings.forEach(w => console.log(chalk.yellow(`    ⚠ ${w.msg}`)));
  }

  console.log(chalk.white('\n  二、数据一致性检查'));
  if (passed.length === 0) console.log(chalk.gray('    (本格式无一致性检查项)'));
  else passed.forEach(p => console.log(chalk.green(`    ✓ ${p}`)));

  console.log(chalk.white('\n  三、筛选条件'));
  const f = reportData && reportData.meta && reportData.meta.filters ? reportData.meta.filters : {};
  const hasFilter = f.batchNo || f.org || f.fromDate || f.toDate;
  if (!hasFilter) console.log(chalk.gray('    全量报告 (无筛选)'));
  else {
    if (f.batchNo) console.log(`    批号: ${f.batchNo}`);
    if (f.org) console.log(`    机构: ${f.org}`);
    if (f.fromDate || f.toDate) console.log(`    日期: ${f.fromDate || '...'} ~ ${f.toDate || '...'}`);
  }

  console.log(chalk.white('\n  四、审计结论'));
  if (fatalCount > 0) {
    console.log(chalk.red('    ✗ 不通过：存在致命错误，无法归档'));
    console.log(chalk.gray('    → 请检查报告文件是否完整或重新导出'));
  } else if (errCount > 0) {
    console.log(chalk.red(`    ✗ 不通过：存在 ${errCount} 处数据不一致，建议重导`));
    console.log(chalk.gray('    → 执行 durg-trace export ... 重新导出最新报告'));
  } else if (warnCount > 0) {
    console.log(chalk.yellow(`    ⚠ 有条件通过：存在 ${warnCount} 处警告，建议人工复核后归档`));
    console.log(chalk.gray('    → 若为历史报告则数据差异属正常，可归档'));
  } else {
    console.log(chalk.green('    ✓ 通过：报告完整且数据一致，可直接归档'));
  }

  console.log('');
  console.log(chalk.gray(`  审计时间: ${new Date().toISOString()}`));

  return {
    fatal: fatalCount,
    error: errCount,
    warn: warnCount,
    passed: passed.length,
    issues,
    warnings,
    canArchive: fatalCount === 0 && errCount === 0,
  };
}

function auditReport(file) {
  audit(file);
}

module.exports = auditReport;
module.exports.audit = audit;
