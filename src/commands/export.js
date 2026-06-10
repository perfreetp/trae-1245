const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');

function inDateRange(isoStr, from, to) {
  if (!isoStr) return true;
  const d = isoStr.slice(0, 10);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function buildMissingIssues() {
  const accounts = store.load('account');
  const codepacks = store.load('codepack');
  const batches = store.load('batch');
  const flows = store.load('flow');
  const verifies = store.load('verify');
  const issues = [];

  if (accounts.length === 0) issues.push({ level: 'error', group: '账号', msg: '未登录' });
  codepacks.forEach(p => { if (!p.bound) issues.push({ level: 'warn', group: '码包', msg: `码包 ${p.name} 未绑定` }); });
  batches.forEach(b => {
    if (!b.packId) issues.push({ level: 'warn', group: '批次', msg: `批号 ${b.batchNo} 未关联码包` });
    if (!b.product) issues.push({ level: 'info', group: '批次', msg: `批号 ${b.batchNo} 未填写产品` });
  });
  const shipFlows = flows.filter(f => f.type === 'ship');
  shipFlows.forEach(f => {
    if (f.status === 'reported') {
      const has = flows.some(r => r.type === 'receive' && r.shipFlowId === f.id);
      if (!has) issues.push({ level: 'warn', group: '流向', msg: `批号 ${f.batchNo} 发货至 ${f.to} 未确认收货` });
    }
  });
  codepacks.forEach(p => {
    const hasV = verifies.some(v => v.packId === p.id);
    if (p.bound && !hasV) issues.push({ level: 'info', group: '核验', msg: `码包 ${p.name} 未执行抽样验码` });
  });
  if (accounts.length > 0 && !accounts[accounts.length - 1].org) {
    issues.push({ level: 'warn', group: '账号', msg: '当前账号未设置机构' });
  }
  return issues;
}

function buildFlowDiff() {
  const flows = store.load('flow');
  const shipRecords = flows.filter(f => f.type === 'ship');
  const receiveRecords = flows.filter(f => f.type === 'receive');
  const matched = [];
  const unmatched = [];
  const qtyMismatch = [];

  shipRecords.forEach(ship => {
    const recv = receiveRecords.find(
      r => r.shipFlowId === ship.id || (r.batchNo === ship.batchNo && r.from === ship.from && r.to === ship.to)
    );
    if (recv) {
      matched.push({
        batchNo: ship.batchNo,
        from: ship.from,
        to: ship.to,
        shipQty: ship.quantity,
        recvQty: recv.quantity,
        shipDate: ship.date,
        recvDate: recv.date,
        shipFlowId: ship.id,
        recvId: recv.id,
      });
      if (ship.quantity !== recv.quantity) {
        qtyMismatch.push({ batchNo: ship.batchNo, shipQty: ship.quantity, recvQty: recv.quantity, diff: recv.quantity - ship.quantity });
      }
    } else {
      unmatched.push({
        batchNo: ship.batchNo,
        from: ship.from,
        to: ship.to,
        shipQty: ship.quantity,
        shipDate: ship.date,
        status: ship.status,
        shipFlowId: ship.id,
      });
    }
  });
  return { matched, unmatched, qtyMismatch, shipTotal: shipRecords.length, recvTotal: receiveRecords.length };
}

function filterData(options) {
  const batchNo = options.batchNo || '';
  const org = options.org || '';
  const fromDate = options.from || '';
  const toDate = options.to || '';

  let account = store.load('account');
  let codepacks = store.load('codepack');
  let batches = store.load('batch');
  let flows = store.load('flow');
  let verifies = store.load('verify');
  let reports = store.load('report');
  let logs = store.load('log');

  if (batchNo) {
    batches = batches.filter(b => b.batchNo === batchNo);
    flows = flows.filter(f => f.batchNo === batchNo);
    reports = reports.filter(r => !r.batchNo || r.batchNo === batchNo);
    verifies = verifies.filter(v => !v.batchNo || v.batchNo === batchNo);
  }
  if (org) {
    flows = flows.filter(f =>
      (f.from && f.from.includes(org)) || (f.to && f.to.includes(org))
    );
    account = account.filter(a => !a.org || a.org.includes(org));
  }
  const dateKey = (item) => item.date || item.createdAt || item.loginAt || item.sampledAt || item.importedAt || item.boundAt || '';
  if (fromDate || toDate) {
    flows = flows.filter(f => inDateRange(dateKey(f), fromDate, toDate));
    batches = batches.filter(b => inDateRange(dateKey(b), fromDate, toDate));
    verifies = verifies.filter(v => inDateRange(dateKey(v), fromDate, toDate));
    reports = reports.filter(r => inDateRange(dateKey(r), fromDate, toDate));
    logs = logs.filter(l => inDateRange(l.timestamp, fromDate, toDate));
  }

  const verifyList = verifies.map(v => ({
    id: v.id,
    packId: v.packId,
    packName: v.packName,
    batchNo: v.batchNo,
    sampleSize: v.sampleSize,
    totalCodes: v.totalCodes,
    sampledAt: v.sampledAt,
    results: v.results,
    passRate: v.results && v.results.length ?
      Math.round(v.results.filter(r => r.status === 'valid').length / v.results.length * 10000) / 100 + '%' : 'N/A',
  }));

  const recallList = reports.filter(r => r.type === 'recall').map(r => ({
    id: r.id,
    batchNo: r.batchNo,
    product: r.product,
    reason: r.reason,
    createdAt: r.createdAt,
    batchCount: (r.recallList || []).length,
    summary: (r.recallList || []).map(x => ({
      batchNo: x.batchNo,
      product: x.product,
      flows: (x.flows || []).length,
    })),
  }));

  const flowDiff = buildFlowDiff();
  if (batchNo) {
    flowDiff.matched = flowDiff.matched.filter(m => m.batchNo === batchNo);
    flowDiff.unmatched = flowDiff.unmatched.filter(u => u.batchNo === batchNo);
    flowDiff.qtyMismatch = flowDiff.qtyMismatch.filter(q => q.batchNo === batchNo);
  }
  if (org) {
    flowDiff.matched = flowDiff.matched.filter(m => (m.from && m.from.includes(org)) || (m.to && m.to.includes(org)));
    flowDiff.unmatched = flowDiff.unmatched.filter(u => (u.from && u.from.includes(org)) || (u.to && u.to.includes(org)));
    flowDiff.qtyMismatch = flowDiff.qtyMismatch.filter(q => {
      const s = flows.find(f => f.id && f.batchNo === q.batchNo);
      return !s || (s.from && s.from.includes(org)) || (s.to && s.to.includes(org));
    });
  }

  let missing = buildMissingIssues();
  if (batchNo) {
    missing = missing.filter(i =>
      (i.msg && i.msg.includes(batchNo)) ||
      i.group === '账号'
    );
  }

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      filters: { batchNo, org, fromDate, toDate },
      summary: {
        accounts: account.length,
        codepacks: codepacks.length,
        batches: batches.length,
        flows: flows.length,
        verifies: verifyList.length,
        recalls: recallList.length,
      },
    },
    account: account.map(a => {
      const x = { ...a };
      delete x.password;
      return x;
    }),
    codepacks: codepacks.map(c => {
      const x = { ...c };
      delete x.codes;
      return x;
    }),
    batches,
    flows,
    verify: verifyList,
    recall: recallList,
    diff: flowDiff,
    missing,
    logs,
  };
}

function toCSV(data) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return s.includes(',') || s.includes('\n') || s.includes('"')
      ? '"' + s.replace(/"/g, '""') + '"'
      : s;
  };
  let out = '';
  out += '# 报告元信息\n';
  out += 'generatedAt,' + data.meta.generatedAt + '\n';
  if (data.meta.filters.batchNo) out += 'filterBatchNo,' + data.meta.filters.batchNo + '\n';
  if (data.meta.filters.org) out += 'filterOrg,' + data.meta.filters.org + '\n';
  if (data.meta.filters.fromDate) out += 'filterFromDate,' + data.meta.filters.fromDate + '\n';
  if (data.meta.filters.toDate) out += 'filterToDate,' + data.meta.filters.toDate + '\n';
  out += '\n# 批次 (batches)\n';
  if (data.batches.length) {
    out += Object.keys(data.batches[0]).join(',') + '\n';
    data.batches.forEach(b => out += Object.values(b).map(esc).join(',') + '\n');
  }
  out += '\n# 流向 (flows)\n';
  if (data.flows.length) {
    out += Object.keys(data.flows[0]).join(',') + '\n';
    data.flows.forEach(f => out += Object.values(f).map(esc).join(',') + '\n');
  }
  out += '\n# 上下游差异 unmatched\n';
  out += 'batchNo,from,to,shipQty,shipDate,status,shipFlowId\n';
  data.diff.unmatched.forEach(u => out += [u.batchNo, u.from, u.to, u.shipQty, u.shipDate, u.status, u.shipFlowId].map(esc).join(',') + '\n');
  out += '\n# 上下游差异 matched\n';
  out += 'batchNo,from,to,shipQty,recvQty,shipDate,recvDate,shipFlowId,recvId\n';
  data.diff.matched.forEach(m => out += [m.batchNo, m.from, m.to, m.shipQty, m.recvQty, m.shipDate, m.recvDate, m.shipFlowId, m.recvId].map(esc).join(',') + '\n');
  out += '\n# 数量差异 qtyMismatch\n';
  out += 'batchNo,shipQty,recvQty,diff\n';
  data.diff.qtyMismatch.forEach(q => out += [q.batchNo, q.shipQty, q.recvQty, q.diff].map(esc).join(',') + '\n');
  out += '\n# 抽样验码 verify\n';
  out += 'id,packName,batchNo,sampleSize,totalCodes,sampledAt,passRate\n';
  data.verify.forEach(v => out += [v.id, v.packName, v.batchNo, v.sampleSize, v.totalCodes, v.sampledAt, v.passRate].map(esc).join(',') + '\n');
  out += '\n# 召回清单 recall\n';
  out += 'id,batchNo,product,reason,createdAt,batchCount\n';
  data.recall.forEach(r => out += [r.id, r.batchNo, r.product, r.reason, r.createdAt, r.batchCount].map(esc).join(',') + '\n');
  out += '\n# 缺失项 missing\n';
  out += 'level,group,msg\n';
  data.missing.forEach(m => out += [m.level, m.group, m.msg].map(esc).join(',') + '\n');
  return out;
}

function toTXT(data) {
  const fmt = (v) => v === null || v === undefined ? '-' : (typeof v === 'object' ? JSON.stringify(v) : v);
  const bar = (t) => '\n' + '═'.repeat(60) + '\n' + `  ${t}\n` + '═'.repeat(60) + '\n';
  let out = '';
  out += '药品追溯合规报告\n';
  out += `生成时间: ${data.meta.generatedAt}\n`;
  const f = data.meta.filters;
  const applied = [];
  if (f.batchNo) applied.push(`批号: ${f.batchNo}`);
  if (f.org) applied.push(`机构: ${f.org}`);
  if (f.fromDate || f.toDate) applied.push(`日期范围: ${f.fromDate || '...'} ~ ${f.toDate || '...'}`);
  if (applied.length) out += `筛选条件: ${applied.join('  ')}\n`;
  out += `数据概要: 账号 ${data.meta.summary.accounts}, 码包 ${data.meta.summary.codepacks}, 批次 ${data.meta.summary.batches}, 流向 ${data.meta.summary.flows}, 验码 ${data.meta.summary.verifies}, 召回 ${data.meta.summary.recalls}\n`;

  out += bar('一、缺失项检查 (check)');
  if (data.missing.length === 0) out += '  ✓ 所有检查项通过\n';
  else {
    data.missing.forEach(m => {
      const icon = { error: '✗', warn: '⚠', info: 'ℹ' }[m.level];
      out += `  ${icon} [${m.group}] ${m.msg}\n`;
    });
  }

  out += bar('二、批次列表');
  if (data.batches.length === 0) out += '  (空)\n';
  else {
    data.batches.forEach(b => {
      out += `  批号 ${b.batchNo}  产品: ${fmt(b.product)}  规格: ${fmt(b.spec)}  生产: ${fmt(b.prodDate)}  有效期至: ${fmt(b.expiry)}\n`;
    });
  }

  out += bar('三、上下游流向比对 (diff)');
  out += `  发货记录总数: ${data.diff.shipTotal}  收货记录总数: ${data.diff.recvTotal}\n`;
  out += `  已匹配 ${data.diff.matched.length} 条，未匹配 ${data.diff.unmatched.length} 条，数量差异 ${data.diff.qtyMismatch.length} 条\n\n`;
  if (data.diff.matched.length) {
    out += '  【已匹配】\n';
    data.diff.matched.forEach(m => out += `    ${m.batchNo}  ${m.from} → ${m.to}  发${m.shipQty}/收${m.recvQty}  ${m.shipDate} ~ ${m.recvDate}\n`);
  }
  if (data.diff.unmatched.length) {
    out += '\n  【未匹配】\n';
    data.diff.unmatched.forEach(u => out += `    ${u.batchNo}  ${u.from} → ${u.to}  数量${u.shipQty}  状态${u.status}\n`);
  }
  if (data.diff.qtyMismatch.length) {
    out += '\n  【数量差异】\n';
    data.diff.qtyMismatch.forEach(q => out += `    ${q.batchNo}  发货${q.shipQty}  收货${q.recvQty}  差异${q.diff}\n`);
  }

  out += bar('四、抽样验码记录 (verify)');
  if (data.verify.length === 0) out += '  (无)\n';
  else {
    data.verify.forEach(v => {
      out += `  验码ID ${v.id}  码包:${v.packName}  批号:${v.batchNo || '-'}  ${v.sampleSize}/${v.totalCodes}  合格率${v.passRate}\n`;
      if (v.results && v.results.length) {
        v.results.slice(0, 3).forEach(r => out += `    · ${r.code}  [${r.status}]\n`);
        if (v.results.length > 3) out += `    · 省略 ${v.results.length - 3} 条\n`;
      }
    });
  }

  out += bar('五、召回清单 (recall)');
  if (data.recall.length === 0) out += '  (无)\n';
  else {
    data.recall.forEach(r => {
      out += `  召回ID ${r.id}  批号:${r.batchNo || '-'}  产品:${r.product || '-'}  原因:${r.reason}\n`;
      (r.summary || []).forEach(s => out += `    · 批号 ${s.batchNo}  产品:${s.product}  流向${s.flows}条\n`);
    });
  }

  out += bar('六、操作日志摘要');
  const actionCount = {};
  (data.logs || []).forEach(l => { actionCount[l.action] = (actionCount[l.action] || 0) + 1; });
  Object.entries(actionCount).forEach(([k, v]) => out += `  ${k}: ${v} 次\n`);
  out += '\n═══════════════════════════════════════════════════════════\n';
  out += `报告生成完成 - ${data.meta.generatedAt}\n`;
  return out;
}

function exportReport(options) {
  const format = (options.format || 'json').toLowerCase();
  const output = options.output || '';

  const data = filterData(options);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  let content = '';
  let ext = format;
  if (format === 'json') content = JSON.stringify(data, null, 2);
  else if (format === 'csv') content = toCSV(data);
  else if (format === 'txt') content = toTXT(data);
  else {
    console.log(chalk.red(`不支持的格式: ${format}`));
    console.log(chalk.gray('支持格式: json / csv / txt'));
    return;
  }

  const defaultName = `compliance-report-${timestamp}.${ext}`;
  const filePath = path.resolve(output || defaultName);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');

  store.addLog('export',
    `导出合规报告 格式=${format} 批号=${options.batchNo || '-'} 机构=${options.org || '-'} 日期=${options.from || '-'}-${options.to || '-'} → ${filePath}`
  );

  const s = data.meta.summary;
  console.log(chalk.green('✓ 合规报告导出完成'));
  console.log(chalk.white(`  路径: ${filePath}`));
  console.log(chalk.white(`  格式: ${format.toUpperCase()}`));
  console.log(chalk.white(`  数据量: 账号 ${s.accounts}  码包 ${s.codepacks}  批次 ${s.batches}  流向 ${s.flows}  验码 ${s.verifies}  召回 ${s.recalls}`));
  console.log(chalk.white(`  缺失项: ${data.missing.length}  匹配:${data.diff.matched.length} 未匹配:${data.diff.unmatched.length} 数量差异:${data.diff.qtyMismatch.length}`));
  if (data.meta.filters.batchNo) console.log(chalk.gray(`  筛选批号: ${data.meta.filters.batchNo}`));
  if (data.meta.filters.org) console.log(chalk.gray(`  筛选机构: ${data.meta.filters.org}`));
  if (data.meta.filters.fromDate || data.meta.filters.toDate) console.log(chalk.gray(`  日期范围: ${data.meta.filters.fromDate || '...'} ~ ${data.meta.filters.toDate || '...'}`));
}

module.exports = exportReport;
