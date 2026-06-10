const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

function loadJSONReport(filePath) {
  const full = path.resolve(filePath);
  if (!fs.existsSync(full)) {
    console.log(chalk.red(`错误: 文件不存在: ${full}`));
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch (e) {
    console.log(chalk.red(`错误: JSON 解析失败: ${full} - ${e.message}`));
    return null;
  }
}

function normalizeFlowKey(f) {
  return `${f.type || '?'}:${f.batchNo || ''}:${f.from || ''}:${f.to || ''}:${f.quantity || 0}:${f.date || ''}`;
}

function normalizeDiffKey(m, t) {
  if (t === 'unmatched') return `${m.batchNo}:${m.from}:${m.to}:ship${m.shipQty}`;
  if (t === 'qtyMismatch') return `${m.batchNo}:ship${m.shipQty}:recv${m.recvQty}`;
  return `${m.batchNo}:${m.from}:${m.to}:ship${m.shipQty}:recv${m.recvQty}`;
}

function normalizeMissingKey(m) {
  return `${m.group}:${m.msg}`;
}

function setByList(arr, keyFn) {
  const map = new Map();
  arr.forEach(x => map.set(keyFn(x), x));
  return map;
}

function diffMaps(oldMap, newMap) {
  const added = [];
  const removed = [];
  const same = [];
  const oldKeys = new Set(oldMap.keys());
  const newKeys = new Set(newMap.keys());
  newKeys.forEach(k => {
    if (oldKeys.has(k)) same.push(k);
    else added.push(k);
  });
  oldKeys.forEach(k => {
    if (!newKeys.has(k)) removed.push(k);
  });
  return { added, removed, same };
}

function compareReports(fileA, fileB) {
  const a = loadJSONReport(fileA);
  const b = loadJSONReport(fileB);
  if (!a || !b) return;

  console.log(chalk.cyan('═════════════════════════════════════════════════'));
  console.log(chalk.cyan('  报告对比 (report compare)'));
  console.log(chalk.cyan('═════════════════════════════════════════════════'));
  console.log(chalk.white('  报告A (旧/基准): ' + path.basename(fileA)));
  if (a.meta && a.meta.archiveId) console.log(chalk.gray(`    归档编号: ${a.meta.archiveId}  指纹: ${a.meta.fingerprint || '-'}`));
  if (a.meta && a.meta.generatedAt) console.log(chalk.gray(`    生成时间: ${a.meta.generatedAt}`));
  console.log(chalk.white('  报告B (新/对比): ' + path.basename(fileB)));
  if (b.meta && b.meta.archiveId) console.log(chalk.gray(`    归档编号: ${b.meta.archiveId}  指纹: ${b.meta.fingerprint || '-'}`));
  if (b.meta && b.meta.generatedAt) console.log(chalk.gray(`    生成时间: ${b.meta.generatedAt}`));
  console.log('');

  if (a.meta && b.meta) {
    if (a.meta.fingerprint && b.meta.fingerprint && a.meta.fingerprint === b.meta.fingerprint) {
      console.log(chalk.green('  ✓ 两份报告指纹相同，数据完全一致'));
      console.log(chalk.gray('  → 归档差异仅为生成时间等元信息'));
    } else {
      console.log(chalk.yellow('  ⚠ 两份报告数据有差异（指纹不同）'));
    }
    const fa = a.meta.filters || {};
    const fb = b.meta.filters || {};
    if (fa.batchNo !== fb.batchNo || fa.org !== fb.org || fa.fromDate !== fb.fromDate || fa.toDate !== fb.toDate) {
      console.log(chalk.yellow('  ⚠ 筛选条件不同：'));
      if (fa.batchNo !== fb.batchNo) console.log(chalk.yellow(`    批号: A="${fa.batchNo || ''}" vs B="${fb.batchNo || ''}"`));
      if (fa.org !== fb.org) console.log(chalk.yellow(`    机构: A="${fa.org || ''}" vs B="${fb.org || ''}"`));
      if (fa.fromDate !== fb.fromDate || fa.toDate !== fb.toDate) console.log(chalk.yellow(`    日期: A="${fa.fromDate || ''}~${fa.toDate || ''}" vs B="${fb.fromDate || ''}~${fb.toDate || ''}"`));
    }
  }
  console.log('');

  const sa = (a.meta && a.meta.summary) || {};
  const sb = (b.meta && b.meta.summary) || {};
  const diffKeys = ['accounts', 'codepacks', 'batches', 'flows', 'ships', 'receives', 'verifies', 'recalls', 'missingItems', 'matchedFlows', 'unmatchedFlows', 'qtyMismatches'];
  const cnNames = {
    accounts: '账号', codepacks: '码包', batches: '批次', flows: '流向', ships: '发货', receives: '收货',
    verifies: '验码', recalls: '召回', missingItems: '缺失项', matchedFlows: '匹配流向', unmatchedFlows: '未匹配流向', qtyMismatches: '数量差异'
  };
  console.log(chalk.white('  一、概要统计对比'));
  let hasSummaryDiff = false;
  diffKeys.forEach(k => {
    const av = sa[k] ?? 0;
    const bv = sb[k] ?? 0;
    if (av !== bv) {
      hasSummaryDiff = true;
      const delta = bv - av;
      const sign = delta > 0 ? '+' : '';
      console.log(chalk.yellow(`    ⚠ ${cnNames[k] || k}: A=${av}  →  B=${bv}  (${sign}${delta})`));
    }
  });
  if (!hasSummaryDiff) console.log(chalk.green('    ✓ 所有概要统计一致'));
  console.log('');

  const sections = [
    {
      title: '批次列表',
      oldArr: Array.isArray(a.batches) ? a.batches : [],
      newArr: Array.isArray(b.batches) ? b.batches : [],
      keyFn: x => x.batchNo,
      labelFn: x => `批号 ${x.batchNo} (${x.product || '无产品'})`,
    },
    {
      title: '流向记录',
      oldArr: Array.isArray(a.flows) ? a.flows : [],
      newArr: Array.isArray(b.flows) ? b.flows : [],
      keyFn: normalizeFlowKey,
      labelFn: x => `${x.type} ${x.batchNo} ${x.from}→${x.to} qty=${x.quantity} (${x.date})`,
    },
    {
      title: '匹配流向 (matched)',
      oldArr: (a.diff && a.diff.matched) || [],
      newArr: (b.diff && b.diff.matched) || [],
      keyFn: x => normalizeDiffKey(x, 'matched'),
      labelFn: x => `${x.batchNo} ${x.from}→${x.to} 发${x.shipQty}/收${x.recvQty}`,
    },
    {
      title: '未匹配流向 (unmatched)',
      oldArr: (a.diff && a.diff.unmatched) || [],
      newArr: (b.diff && b.diff.unmatched) || [],
      keyFn: x => normalizeDiffKey(x, 'unmatched'),
      labelFn: x => `${x.batchNo} ${x.from}→${x.to} 发${x.shipQty}`,
    },
    {
      title: '数量差异 (qtyMismatch)',
      oldArr: (a.diff && a.diff.qtyMismatch) || [],
      newArr: (b.diff && b.diff.qtyMismatch) || [],
      keyFn: x => normalizeDiffKey(x, 'qtyMismatch'),
      labelFn: x => `${x.batchNo} 发${x.shipQty}/收${x.recvQty}`,
    },
    {
      title: '缺失项 (missing)',
      oldArr: Array.isArray(a.missing) ? a.missing : [],
      newArr: Array.isArray(b.missing) ? b.missing : [],
      keyFn: normalizeMissingKey,
      labelFn: x => `[${x.group}] ${x.msg}`,
    },
    {
      title: '验码记录 (verify)',
      oldArr: Array.isArray(a.verify) ? a.verify : [],
      newArr: Array.isArray(b.verify) ? b.verify : [],
      keyFn: x => x.id || `${x.packName}:${x.batchNo || ''}`,
      labelFn: x => `${x.packName} (${x.batchNo || '-'}) ${x.sampleSize}/${x.totalCodes} 合格${x.passRate}`,
    },
    {
      title: '召回清单 (recall)',
      oldArr: Array.isArray(a.recall) ? a.recall : [],
      newArr: Array.isArray(b.recall) ? b.recall : [],
      keyFn: x => x.id || x.batchNo,
      labelFn: x => `${x.batchNo || x.id} 产品=${x.product || '-'} 原因=${x.reason || '-'}`,
    },
  ];

  sections.forEach(sec => {
    console.log(chalk.white(`  二、${sec.title} 变化`));
    const oldMap = setByList(sec.oldArr, sec.keyFn);
    const newMap = setByList(sec.newArr, sec.keyFn);
    const { added, removed, same } = diffMaps(oldMap, newMap);

    if (added.length === 0 && removed.length === 0) {
      console.log(chalk.green(`    ✓ 无变化 (${same.length} 条一致)`));
    } else {
      if (added.length) {
        console.log(chalk.green(`    + 新增 ${added.length} 条:`));
        added.slice(0, 5).forEach(k => {
          const v = newMap.get(k);
          console.log(chalk.green(`      + ${sec.labelFn(v)}`));
        });
        if (added.length > 5) console.log(chalk.green(`      ... 共 ${added.length} 条新增`));
      }
      if (removed.length) {
        console.log(chalk.red(`    - 删除 ${removed.length} 条:`));
        removed.slice(0, 5).forEach(k => {
          const v = oldMap.get(k);
          console.log(chalk.red(`      - ${sec.labelFn(v)}`));
        });
        if (removed.length > 5) console.log(chalk.red(`      ... 共 ${removed.length} 条删除`));
      }
    }
    console.log('');
  });

  console.log(chalk.white('  三、对比结论'));
  let major = false;
  if (sa.matchedFlows !== sb.matchedFlows || sa.unmatchedFlows !== sb.unmatchedFlows || sa.qtyMismatches !== sb.qtyMismatches) {
    console.log(chalk.yellow('    ⚠ 差异表有变化（流向匹配状态改变）'));
    major = true;
  }
  if (sa.missingItems !== sb.missingItems) {
    console.log(chalk.yellow('    ⚠ 缺失项数量变化，合规状态可能改变'));
    major = true;
  }
  if (sa.recalls !== sb.recalls) {
    console.log(chalk.red('    ✗ 召回清单有变化！需特别关注'));
    major = true;
  }
  if (!major) {
    console.log(chalk.green('    ✓ 合规核心指标（匹配/未匹配/缺失/召回）未变，仅次要内容更新'));
  }
  console.log('');
  console.log(chalk.gray(`  对比时间: ${new Date().toISOString()}`));
}

module.exports = compareReports;
