const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');
const { buildFlowDiff, buildMissingIssues } = require('./export');

function extractSummaryFromTXT(content) {
  const lines = content.split(/\r?\n/);
  const sum = {};
  const meta = { filters: {} };

  const gen = lines.find(l => l.startsWith('生成时间:'));
  if (gen) meta.generatedAt = gen.replace('生成时间:', '').trim();
  const arc = lines.find(l => l.startsWith('归档编号:'));
  if (arc) meta.archiveId = arc.replace('归档编号:', '').trim();
  const fp = lines.find(l => l.startsWith('报告指纹:'));
  if (fp) meta.fingerprint = fp.replace('报告指纹:', '').trim();

  const fLine = lines.find(l => l.startsWith('筛选条件:'));
  if (fLine) {
    const s = fLine.replace('筛选条件:', '').trim();
    const bm = s.match(/批号:\s*(\S+)/);
    const om = s.match(/机构:\s*(\S+)/);
    const dm = s.match(/日期范围:\s*(\S+)\s*~\s*(\S+)/);
    if (bm) meta.filters.batchNo = bm[1];
    if (om) meta.filters.org = om[1];
    if (dm) { meta.filters.fromDate = dm[1]; meta.filters.toDate = dm[2]; }
  }

  const sLine = lines.find(l => l.startsWith('数据概要:'));
  if (sLine) {
    const pairs = {
      '账号': 'accounts',
      '码包': 'codepacks',
      '批次': 'batches',
      '流向': 'flows',
      '验码': 'verifies',
      '召回': 'recalls',
    };
    for (const [cn, en] of Object.entries(pairs)) {
      const rx = new RegExp(`${cn}\\s+(\\d+)`);
      const m = sLine.match(rx);
      if (m) sum[en] = parseInt(m[1], 10);
    }
    const shipRecv = sLine.match(/发(\d+)\/收(\d+)/);
    if (shipRecv) { sum.ships = parseInt(shipRecv[1], 10); sum.receives = parseInt(shipRecv[2], 10); }
  }

  const mLine = lines.find(l => l.startsWith('缺失项:') || l.includes('缺失项:') && l.includes('差异:'));
  if (mLine) {
    const mm = mLine.match(/缺失项:\s*(\d+)/);
    if (mm) sum.missingItems = parseInt(mm[1], 10);
    const matchM = mLine.match(/匹配\s*(\d+)/);
    const unmatM = mLine.match(/未匹配\s*(\d+)/);
    const qtyM = mLine.match(/数量差\s*(\d+)/);
    if (matchM) sum.matchedFlows = parseInt(matchM[1], 10);
    if (unmatM) sum.unmatchedFlows = parseInt(unmatM[1], 10);
    if (qtyM) sum.qtyMismatches = parseInt(qtyM[1], 10);
  }

  const counts = {};
  const sectionTitles = [
    { key: 'missing', title: '一、缺失项检查' },
    { key: 'batches', title: '二、批次列表' },
    { key: 'diff_matched', title: '【已匹配】', inDiff: true },
    { key: 'diff_unmatched', title: '【未匹配】', inDiff: true },
    { key: 'diff_qty', title: '【数量差异】', inDiff: true },
    { key: 'verify', title: '四、抽样验码记录' },
    { key: 'recall', title: '五、召回清单' },
  ];
  const boundaryIdx = [];
  lines.forEach((l, i) => { if (l.trim().startsWith('═'.repeat(10))) boundaryIdx.push(i); });

  function findSectionRange(title) {
    const titleIdx = lines.findIndex(l => l.includes(title));
    if (titleIdx < 0) return null;
    const boundsAfter = boundaryIdx.filter(b => b > titleIdx);
    const start = boundsAfter.length > 0 ? boundsAfter[0] + 1 : titleIdx + 1;
    const end = boundsAfter.length > 1 ? boundsAfter[1] : lines.length;
    return { start, end };
  }

  for (const sec of sectionTitles) {
    counts[sec.key] = 0;
    let range;
    if (sec.inDiff) {
      const diffRange = findSectionRange('三、上下游流向比对');
      if (!diffRange) continue;
      const matchStart = lines.slice(diffRange.start, diffRange.end).findIndex(l => l.includes(sec.title));
      if (matchStart < 0) continue;
      const absStart = diffRange.start + matchStart + 1;
      let absEnd = diffRange.end;
      for (let j = absStart; j < diffRange.end; j++) {
        const ll = lines[j];
        if (/^  【[^】]+】/.test(ll) && !ll.includes(sec.title)) { absEnd = j; break; }
      }
      range = { start: absStart, end: absEnd };
    } else {
      range = findSectionRange(sec.title);
      if (!range) continue;
    }
    for (let i = range.start; i < range.end; i++) {
      const line = lines[i];
      if (line.trim() === '') continue;
      if (/^\s*概要期望:/.test(line)) continue;
      if (/^\s*实际:/.test(line)) continue;
      if (/^\s*发货记录:/.test(line)) continue;
      if (/^\s*已匹配\s+\d+/.test(line)) continue;
      if (/^\s*未匹配\s+\d+/.test(line)) continue;
      if (/^\s*\(空\)/.test(line)) continue;
      if (/^\s*\(无\)/.test(line)) continue;
      if (/^\s*✓\s*所有/.test(line)) continue;
      if (line.trim().startsWith('═'.repeat(5))) continue;
      counts[sec.key]++;
    }
  }
  const flowsTotal = (counts.diff_matched || 0) + (counts.diff_unmatched || 0);
  counts.flows = flowsTotal + (counts.diff_matched || 0);
  const diffShip = content.match(/发货记录:\s*(\d+)/);
  const diffRecv = content.match(/收货记录:\s*(\d+)/);
  if (diffShip) counts.ships = parseInt(diffShip[1], 10);
  if (diffRecv) counts.receives = parseInt(diffRecv[1], 10);
  if (!counts.ships) counts.ships = flowsTotal;
  if (!counts.receives) counts.receives = counts.diff_matched || 0;
  if (flowsTotal && !counts.flows) counts.flows = counts.ships + counts.receives;

  return { meta, summary: sum, actualCounts: counts };
}

function parseCSVReport(content) {
  const lines = content.split(/\r?\n/);
  const meta = { filters: {} };
  const summary = {};
  const actualCounts = {};

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('generatedAt,')) meta.generatedAt = l.split(',')[1];
    else if (l.startsWith('archiveId,')) meta.archiveId = l.split(',')[1];
    else if (l.startsWith('fingerprint,')) meta.fingerprint = l.split(',')[1];
    else if (l.startsWith('filterBatchNo,')) meta.filters.batchNo = l.split(',')[1];
    else if (l.startsWith('filterOrg,')) meta.filters.org = l.split(',')[1];
    else if (l.startsWith('filterFromDate,')) meta.filters.fromDate = l.split(',')[1];
    else if (l.startsWith('filterToDate,')) meta.filters.toDate = l.split(',')[1];
    else if (/^[a-zA-Z_]+,\d+$/.test(l) && l.startsWith('指标') === false) {
      const [k, v] = l.split(',');
      summary[k] = parseInt(v, 10);
    }
  }

  const sections = [
    { key: 'batches', title: '# 批次 (batches)' },
    { key: 'flows', title: '# 流向 (flows)' },
    { key: 'diff_unmatched', title: '# 上下游差异 unmatched' },
    { key: 'diff_matched', title: '# 上下游差异 matched' },
    { key: 'diff_qty', title: '# 数量差异 qtyMismatch' },
    { key: 'verify', title: '# 抽样验码 verify' },
    { key: 'recall', title: '# 召回清单 recall' },
    { key: 'missing', title: '# 缺失项 missing' },
  ];

  sections.forEach(sec => {
    let idx = lines.findIndex(l => l === sec.title);
    if (idx < 0) return;
    let headerIdx = -1;
    let headerSkipped = false;
    let actualCnt = 0;
    let expectedCnt = null;
    for (let i = idx + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('# ')) break;
      if (line.startsWith('expectedCount,')) {
        expectedCnt = parseInt(line.split(',')[1], 10);
        continue;
      }
      if (line.startsWith('actualCount,')) continue;
      if (line === '') continue;
      if (!headerSkipped) {
        headerSkipped = true;
        continue;
      }
      actualCnt++;
    }
    actualCounts[sec.key] = actualCnt;
    if (expectedCnt !== null) actualCounts[sec.key + '_expected'] = expectedCnt;
  });

  return { meta, summary, actualCounts };
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

  let parsed = null;
  const issues = [];
  const warnings = [];
  const passed = [];

  if (ext === 'json') {
    try {
      const data = JSON.parse(content);
      parsed = {
        meta: data.meta || {},
        summary: (data.meta && data.meta.summary) || {},
        actualCounts: {
          batches: Array.isArray(data.batches) ? data.batches.length : -1,
          flows: Array.isArray(data.flows) ? data.flows.length : -1,
          missing: Array.isArray(data.missing) ? data.missing.length : -1,
          verify: Array.isArray(data.verify) ? data.verify.length : -1,
          recall: Array.isArray(data.recall) ? data.recall.length : -1,
          diff_matched: (data.diff && Array.isArray(data.diff.matched)) ? data.diff.matched.length : -1,
          diff_unmatched: (data.diff && Array.isArray(data.diff.unmatched)) ? data.diff.unmatched.length : -1,
          diff_qty: (data.diff && Array.isArray(data.diff.qtyMismatch)) ? data.diff.qtyMismatch.length : -1,
          ships: (data.diff && data.diff.shipTotal) ? data.diff.shipTotal : -1,
          receives: (data.diff && data.diff.recvTotal) ? data.diff.recvTotal : -1,
        },
        rawData: data,
      };
      const reqKeys = ['meta', 'account', 'codepacks', 'batches', 'flows', 'verify', 'recall', 'diff', 'missing', 'logs'];
      reqKeys.forEach(k => {
        if (!(k in data)) issues.push({ level: 'error', msg: `缺少章节: ${k}` });
      });
      if (parsed.meta.archiveId) passed.push(`归档编号: ${parsed.meta.archiveId}`);
      if (parsed.meta.fingerprint) passed.push(`报告指纹: ${parsed.meta.fingerprint}`);
    } catch (e) {
      issues.push({ level: 'fatal', msg: `JSON 解析失败: ${e.message}` });
    }
  } else if (ext === 'csv') {
    parsed = parseCSVReport(content);
    const reqSecs = ['# 批次 (batches)', '# 流向 (flows)', '# 上下游差异 unmatched', '# 上下游差异 matched', '# 数量差异 qtyMismatch', '# 抽样验码 verify', '# 召回清单 recall', '# 缺失项 missing'];
    reqSecs.forEach(s => {
      if (!content.includes(s)) issues.push({ level: 'warn', msg: `缺少章节标题: ${s}` });
    });
    if (parsed.meta.archiveId) passed.push(`归档编号: ${parsed.meta.archiveId}`);
    if (parsed.meta.fingerprint) passed.push(`报告指纹: ${parsed.meta.fingerprint}`);
  } else if (ext === 'txt') {
    parsed = extractSummaryFromTXT(content);
    const reqTitles = ['一、缺失项检查', '二、批次列表', '三、上下游流向比对', '四、抽样验码记录', '五、召回清单', '六、操作日志摘要'];
    reqTitles.forEach(s => {
      if (!content.includes(s)) issues.push({ level: 'warn', msg: `缺少章节: ${s}` });
    });
    if (parsed.meta.archiveId) passed.push(`归档编号: ${parsed.meta.archiveId}`);
    if (parsed.meta.fingerprint) passed.push(`报告指纹: ${parsed.meta.fingerprint}`);
  } else {
    issues.push({ level: 'fatal', msg: `不支持的格式: ${ext}` });
  }

  if (parsed && parsed.summary && parsed.actualCounts) {
    const s = parsed.summary;
    const a = parsed.actualCounts;
    const checks = [
      { name: '批次数量: 概要 vs 章节', sumKey: 'batches', actKey: 'batches' },
      { name: '流向数量: 概要 vs 章节', sumKey: 'flows', actKey: 'flows' },
      { name: '缺失项数量: 概要 vs 章节', sumKey: 'missingItems', actKey: 'missing' },
      { name: '验码数量: 概要 vs 章节', sumKey: 'verifies', actKey: 'verify' },
      { name: '召回数量: 概要 vs 章节', sumKey: 'recalls', actKey: 'recall' },
      { name: '匹配流向: 概要 vs 章节', sumKey: 'matchedFlows', actKey: 'diff_matched' },
      { name: '未匹配流向: 概要 vs 章节', sumKey: 'unmatchedFlows', actKey: 'diff_unmatched' },
      { name: '数量差异: 概要 vs 章节', sumKey: 'qtyMismatches', actKey: 'diff_qty' },
    ];
    checks.forEach(c => {
      const sv = s[c.sumKey];
      const av = a[c.actKey];
      if (sv === undefined || av === undefined || av < 0) {
        warnings.push({ msg: `${c.name}: 数据缺失，无法核对 (概要=${sv}, 实际=${av})` });
      } else if (sv === av) {
        passed.push(`${c.name} (${sv} = ${av})`);
      } else {
        issues.push({ level: 'error', msg: `${c.name} 不一致: 概要 ${sv} vs 章节实际 ${av}` });
      }
    });

    if (s.ships !== undefined && a.ships !== undefined && a.ships >= 0) {
      if (s.ships === a.ships) passed.push(`发货数量: 概要 ${s.ships} = 差异章节 ${a.ships}`);
      else issues.push({ level: 'error', msg: `发货数量不一致: 概要 ${s.ships} vs 差异章节 ${a.ships}` });
    }
    if (s.receives !== undefined && a.receives !== undefined && a.receives >= 0) {
      if (s.receives === a.receives) passed.push(`收货数量: 概要 ${s.receives} = 差异章节 ${a.receives}`);
      else issues.push({ level: 'error', msg: `收货数量不一致: 概要 ${s.receives} vs 差异章节 ${a.receives}` });
    }

    if (s.ships !== undefined && s.matchedFlows !== undefined && s.unmatchedFlows !== undefined) {
      const ok = s.ships === s.matchedFlows + s.unmatchedFlows;
      if (ok) passed.push(`流向差异匹配: 发货总数(${s.ships}) = 匹配(${s.matchedFlows}) + 未匹配(${s.unmatchedFlows})`);
      else issues.push({ level: 'error', msg: `流向差异不匹配: 发货总数(${s.ships}) ≠ 匹配(${s.matchedFlows}) + 未匹配(${s.unmatchedFlows})` });
    }

    if (parsed.meta && parsed.meta.consistency && parsed.meta.consistency.flowShipsEqDiff === false) {
      issues.push({ level: 'error', msg: '报告自带一致性标记 flowShipsEqDiff 为 false' });
    }
    if (parsed.meta && parsed.meta.generatedAt) passed.push(`报告生成时间: ${parsed.meta.generatedAt}`);

    if (ext === 'json') {
      const cur = store.load('batch');
      const curFlows = store.load('flow');
      const f = parsed.meta.filters || {};
      let eb = cur.slice();
      let ef = curFlows.slice();
      if (f.batchNo) { eb = eb.filter(b => b.batchNo === f.batchNo); ef = ef.filter(fl => fl.batchNo === f.batchNo); }
      if (f.org) ef = ef.filter(fl => (fl.from && fl.from.includes(f.org)) || (fl.to && fl.to.includes(f.org)));
      if (f.fromDate || f.toDate) {
        ef = ef.filter(fl => {
          const d = (fl.date || fl.createdAt || '').slice(0, 10);
          if (f.fromDate && d < f.fromDate) return false;
          if (f.toDate && d > f.toDate) return false;
          return true;
        });
      }

      if (a.batches >= 0) {
        if (a.batches === eb.length) passed.push(`批次与当前系统数据一致 (${a.batches})`);
        else warnings.push({ msg: `批次与系统数据不同: 报告 ${a.batches} / 当前系统 ${eb.length}（历史报告属正常）` });
      }
      if (a.flows >= 0) {
        if (a.flows === ef.length) passed.push(`流向与当前系统数据一致 (${a.flows})`);
        else warnings.push({ msg: `流向与系统数据不同: 报告 ${a.flows} / 当前系统 ${ef.length}（历史报告属正常）` });
      }
    }
  }

  const fatalCount = issues.filter(i => i.level === 'fatal').length;
  const errCount = issues.filter(i => i.level === 'error').length;
  const warnCount = issues.filter(i => i.level === 'warn').length + warnings.length;

  console.log(chalk.white('  一、章节完整性检查'));
  const sectionIssues = issues.filter(i => !i.msg.includes('不一致'));
  const warnsOnly = warnings.concat(issues.filter(i => i.level === 'warn'));
  if (sectionIssues.length === 0 && warnsOnly.length === 0) {
    console.log(chalk.green('    ✓ 所有必要章节齐全'));
  } else {
    sectionIssues.forEach(i => console.log(chalk[i.level === 'fatal' ? 'red' : 'yellow'](`    ✗ [${i.level}] ${i.msg}`)));
    warnsOnly.forEach(w => console.log(chalk.yellow(`    ⚠ ${w.msg}`)));
  }

  console.log(chalk.white('\n  二、数据一致性检查'));
  if (passed.length === 0) console.log(chalk.gray('    (无通过检查项)'));
  else passed.forEach(p => console.log(chalk.green(`    ✓ ${p}`)));

  const dataErr = issues.filter(i => i.msg.includes('不一致') || i.msg.includes('不匹配'));
  if (dataErr.length) {
    console.log('');
    dataErr.forEach(i => console.log(chalk.red(`    ✗ [${i.level}] ${i.msg}`)));
  }

  console.log(chalk.white('\n  三、筛选条件'));
  const f = parsed && parsed.meta && parsed.meta.filters ? parsed.meta.filters : {};
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
    console.log(chalk.red(`    ✗ 不通过：存在 ${errCount} 处数据不一致，需要重导`));
    console.log(chalk.gray('    → 执行 durg-trace export ... 重新导出最新报告'));
  } else if (warnCount > 0) {
    console.log(chalk.yellow(`    ⚠ 有条件通过：存在 ${warnCount} 处警告，建议人工复核后归档`));
    console.log(chalk.gray('    → 若为历史报告则数据差异属正常，可归档'));
  } else {
    console.log(chalk.green('    ✓ 通过：报告完整且数据一致，可直接归档'));
  }

  console.log('');
  console.log(chalk.gray(`  审计时间: ${new Date().toISOString()}`));

  const result = {
    fatal: fatalCount,
    error: errCount,
    warn: warnCount,
    passed: passed.length,
    issues,
    warnings,
    canArchive: fatalCount === 0 && errCount === 0,
  };

  try {
    const ts = new Date();
    const y = ts.getFullYear();
    const m = String(ts.getMonth() + 1).padStart(2, '0');
    const d = String(ts.getDate()).padStart(2, '0');
    const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
    const auditArchiveId = `ARC-AUD-${y}${m}${d}-${rand}`;
    const archives = store.load('archive') || [];
    const fp = parsed && parsed.meta ? (parsed.meta.fingerprint || '') : '';
    archives.push({
      archiveId: auditArchiveId,
      fingerprint: fp,
      type: 'audit',
      format: ext,
      source: fullPath,
      target: {
        reportArchiveId: parsed && parsed.meta && parsed.meta.archiveId ? parsed.meta.archiveId : '',
        result: { fatal: fatalCount, error: errCount, warn: warnCount, passed: passed.length, canArchive: result.canArchive },
      },
      createdAt: new Date().toISOString(),
    });
    store.save('archive', archives);
    store.addLog('audit', `报告审计 ${auditArchiveId} 源=${fullPath} fatal=${fatalCount} error=${errCount} warn=${warnCount} canArchive=${result.canArchive}`);
  } catch (_) {}

  return result;
}

function auditReport(file) {
  audit(file);
}

module.exports = auditReport;
module.exports.audit = audit;
