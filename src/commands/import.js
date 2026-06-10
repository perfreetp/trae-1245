const fs = require('fs');
const path = require('path');
const chalk = require('chalk');
const store = require('../store');

function parseCSV(content) {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  if (lines.length === 0) return [];
  const rawHeaders = lines[0].split(',').map(h => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].match(/("([^"]|"")*"|[^,]*)(,|$)/g) || [];
    const values = cells.map(c => c.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
    const obj = {};
    rawHeaders.forEach((h, idx) => {
      obj[h] = (values[idx] || '').trim();
    });
    rows.push(obj);
  }
  return rows;
}

function detectKind(filePath, explicitKind) {
  if (explicitKind && explicitKind !== 'auto') return explicitKind;
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('flow') || name.includes('ship') || name.includes('receive') || name.includes('流向')) {
    return 'flow';
  }
  if (name.includes('batch') || name.includes('批次')) {
    return 'batch';
  }
  return 'codepack';
}

function readAndParseFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.json') {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : (parsed.records || parsed.codes || parsed.rows || []);
  }
  if (ext === '.csv') {
    return parseCSV(content);
  }
  return content
    .split(/[\r\n]+/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      if (l.includes(',')) {
        const parts = l.split(',').map(p => p.trim());
        return parts.length > 2 ? Object.fromEntries(parts.map((p, i) => ['col' + i, p])) : { code: l };
      }
      return { code: l };
    });
}

function processCodepack(filePath, options) {
  const records = readAndParseFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const codes = records.map(r => {
    if (typeof r === 'string') return r;
    return r.code || r.traceCode || r.trace_code || r['追溯码'] || r;
  }).filter(c => c !== undefined && c !== null && c !== '');

  const errors = [];
  if (codes.length === 0) {
    errors.push('码包文件解析后为空，请检查文件格式');
    return { ok: 0, skipped: 0, errors, createdIds: [], preview: [], packName: '', total: 0 };
  }

  const packName = options.name || path.basename(filePath, ext);
  const existing = store.load('codepack');
  const dup = existing.find(p => p.name === packName);
  const skipped = dup ? 1 : 0;
  const preview = codes.slice(0, 5);

  return {
    ok: skipped ? 0 : 1,
    skipped,
    errors,
    createdIds: [],
    preview,
    packName,
    total: codes.length,
    codes,
    source: filePath,
  };
}

function applyCodepack(result) {
  const codepacks = store.load('codepack');
  const codepack = {
    id: 'CP' + Date.now().toString(36).toUpperCase(),
    name: result.packName,
    source: result.source,
    total: result.total,
    codes: result.codes,
    importedAt: new Date().toISOString(),
    bound: false,
  };
  codepacks.push(codepack);
  store.save('codepack', codepacks);
  store.addLog('import', `导入码包 ${result.packName}, 共 ${result.total} 个追溯码`);
  result.createdIds.push(codepack.id);

  console.log(chalk.green(`✓ 码包导入成功`));
  console.log(chalk.white(`  名称: ${result.packName}`));
  console.log(chalk.white(`  码包ID: ${codepack.id}`));
  console.log(chalk.white(`  追溯码数量: ${result.total}`));
  console.log(chalk.gray(`  来源: ${result.source}`));
  if (result.total <= 10) {
    console.log(chalk.gray('  追溯码:'));
    result.preview.forEach(c => console.log(chalk.gray(`    ${typeof c === 'object' ? JSON.stringify(c) : c}`)));
  } else {
    console.log(chalk.gray('  前5条追溯码:'));
    result.preview.forEach(c => console.log(chalk.gray(`    ${typeof c === 'object' ? JSON.stringify(c) : c}`)));
    console.log(chalk.gray(`  ... 还有 ${result.total - 5} 条`));
  }
  return codepack;
}

function processFlow(filePath) {
  const records = readAndParseFile(filePath);
  const errors = [];
  if (records.length === 0 || (records[0] && typeof records[0] === 'string')) {
    errors.push('流向文件必须包含表头: 推荐 type,batchNo,from,to,quantity,date,... 或 发货/收货,批号,发货方,收货方,数量,日期');
    return { ok: 0, shipCount: 0, recvCount: 0, skipped: 0, errors, createdIds: [], preview: [] };
  }

  const existingFlows = store.load('flow');
  let shipCount = 0;
  let recvCount = 0;
  const createdShips = [];
  const createdRecvs = [];
  const preview = [];
  const matchedExisting = new Set();

  records.forEach((r, idx) => {
    const type = (r.type || r['类型'] || r['类型标识'] || '').toString().toLowerCase();
    const isReceive = type.includes('receive') || type.includes('收') || type.includes('rcv');
    const isShip = !isReceive && (type.includes('ship') || type.includes('发') || type.includes('out') || type === '');

    const batchNo = r.batchNo || r['批号'] || r['批次号'] || r.batchno || r['批次'];
    const from = r.from || r['发货方'] || r['fromOrg'] || r['发货单位'];
    const to = r.to || r['收货方'] || r['toOrg'] || r['收货单位'];
    const quantity = parseInt(r.quantity || r['数量'] || r.qty || r['件数']) || 0;
    const date = r.date || r['日期'] || r['发货日期'] || r['收货日期'] || r['操作日期'] || new Date().toISOString().split('T')[0];

    if (!batchNo || !quantity || quantity <= 0) {
      errors.push(`第${idx + 2}行: 缺少批号或有效数量`);
      return;
    }

    if (isReceive) {
      let shipFlow = null;
      if (from && to) {
        shipFlow = createdShips.find(s => s.batchNo === batchNo && s.from === from && s.to === to);
        if (!shipFlow) {
          shipFlow = existingFlows
            .filter(f => f.type === 'ship' && f.batchNo === batchNo && f.from === from && f.to === to && f.status === 'reported' && !matchedExisting.has(f.id))
            .sort((a, b) => a.date.localeCompare(b.date))[0];
        }
      } else {
        shipFlow = createdShips.find(s => s.batchNo === batchNo);
        if (!shipFlow) {
          shipFlow = existingFlows
            .filter(f => f.type === 'ship' && f.batchNo === batchNo && f.status === 'reported' && !matchedExisting.has(f.id))
            .sort((a, b) => a.date.localeCompare(b.date))[0];
        }
      }

      if (!shipFlow) {
        errors.push(`第${idx + 2}行: 收货记录无法匹配到发货记录`);
        return;
      }

      if (shipFlow._fromExisting) matchedExisting.add(shipFlow.id);
      else shipFlow._matched = true;

      const recv = {
        _idx: idx,
        type: 'receive',
        shipFlowId: shipFlow.id || '',
        batchNo,
        from: from || shipFlow.from || '',
        to: to || shipFlow.to || '',
        quantity,
        receivedBy: r.receivedBy || r['收货人'] || r['验收人'] || (to || shipFlow.to || ''),
        date,
        remark: r.remark || r['备注'] || '',
        _matchedShip: shipFlow,
      };
      createdRecvs.push(recv);
      recvCount += 1;
      if (preview.length < 5) preview.push({ type: '收货', batchNo, from: recv.from, to: recv.to, qty: quantity, date });
    } else if (isShip) {
      if (!from || !to) {
        errors.push(`第${idx + 2}行: 发货记录缺少 from/to`);
        return;
      }
      const ship = {
        _idx: idx,
        type: 'ship',
        batchNo,
        from,
        to,
        quantity,
        date,
        status: 'reported',
        remark: r.remark || r['备注'] || '',
        _matched: false,
      };
      createdShips.push(ship);
      shipCount += 1;
      if (preview.length < 5) preview.push({ type: '发货', batchNo, from, to, qty: quantity, date });
    } else {
      errors.push(`第${idx + 2}行: 无法识别类型 ${type}`);
    }
  });

  const createdIds = [...createdShips, ...createdRecvs];
  return {
    ok: shipCount + recvCount,
    shipCount,
    recvCount,
    skipped: 0,
    errors,
    createdIds,
    preview,
    source: filePath,
  };
}

function applyFlow(result) {
  const flows = store.load('flow');
  const ships = result.createdIds.filter(i => i.type === 'ship');
  const recvs = result.createdIds.filter(i => i.type === 'receive');

  ships.forEach((item, idx) => {
    const id = 'FLW' + Date.now().toString(36).toUpperCase() + 'S' + idx;
    item.id = id;
    const record = { ...item, id, createdAt: new Date().toISOString() };
    delete record._idx;
    delete record._matched;
    flows.push(record);
  });

  recvs.forEach((item, idx) => {
    const id = 'RCV' + Date.now().toString(36).toUpperCase() + 'R' + idx;
    let shipId = item.shipFlowId;
    let matchedShip = item._matchedShip;
    if (matchedShip && !shipId && matchedShip.id) shipId = matchedShip.id;

    if (shipId) {
      const ship = flows.find(f => f.id === shipId);
      if (ship) {
        ship.status = 'received';
        ship.receivedAt = new Date().toISOString();
      }
    }

    const record = {
      ...item,
      id,
      shipFlowId: shipId,
      createdAt: new Date().toISOString(),
    };
    delete record._idx;
    delete record._matchedShip;
    flows.push(record);
  });

  store.save('flow', flows);
  store.addLog('import', `批量导入流向: 发货 ${result.shipCount}, 收货 ${result.recvCount}, 错误 ${result.errors.length}`);

  console.log(chalk.green(`✓ 流向批量导入完成`));
  console.log(chalk.white(`  发货记录: ${result.shipCount} 条`));
  console.log(chalk.white(`  收货记录: ${result.recvCount} 条`));
  if (result.errors.length > 0) {
    console.log(chalk.yellow(`  跳过: ${result.errors.length} 条`));
    result.errors.slice(0, 5).forEach(e => console.log(chalk.yellow(`    - ${e}`)));
    if (result.errors.length > 5) console.log(chalk.yellow(`    ... 共 ${result.errors.length} 条错误`));
  }
  console.log(chalk.gray(`  来源: ${result.source}`));
}

function processBatch(filePath) {
  const records = readAndParseFile(filePath);
  const errors = [];
  if (records.length === 0 || (records[0] && typeof records[0] === 'string')) {
    errors.push('批次文件必须包含表头: 推荐 batchNo,product,prodDate,expiry,packId 或 批号,产品,生产日期,有效期,码包ID');
    return { ok: 0, skipped: 0, errors, createdIds: [], preview: [] };
  }

  const existing = store.load('batch');
  let ok = 0;
  let skipped = 0;
  const createdIds = [];
  const preview = [];

  records.forEach((r, idx) => {
    const batchNo = r.batchNo || r['批号'] || r['批次号'] || r['批次'];
    if (!batchNo) {
      errors.push(`第${idx + 2}行: 缺少批号`);
      return;
    }
    if (existing.find(b => b.batchNo === batchNo) || createdIds.find(c => c.batchNo === batchNo)) {
      skipped += 1;
      return;
    }
    const product = r.product || r['产品'] || r['产品名称'] || r['药品名称'] || '';
    const prodDate = r.prodDate || r['生产日期'] || r['生产批号日期'] || r.productionDate || '';
    const expiry = r.expiry || r['有效期至'] || r['到期日'] || r.expireDate || '';
    const packId = r.packId || r['码包ID'] || r['码包'] || r.codepackId || '';
    const spec = r.spec || r['规格'] || r['药品规格'] || '';

    createdIds.push({ batchNo, product, spec, prodDate, expiry, packId });
    ok += 1;
    if (preview.length < 5) preview.push({ batchNo, product, spec });
  });

  return { ok, skipped, errors, createdIds, preview, source: filePath };
}

function applyBatch(result) {
  const batches = store.load('batch');
  result.createdIds.forEach((item, idx) => {
    batches.push({
      id: 'BAT' + Date.now().toString(36).toUpperCase() + idx,
      ...item,
      status: 'registered',
      createdAt: new Date().toISOString(),
    });
  });
  store.save('batch', batches);
  store.addLog('import', `批量导入批次: 成功 ${result.ok}, 跳过 ${result.skipped}, 错误 ${result.errors.length}`);

  console.log(chalk.green(`✓ 批次批量导入完成`));
  console.log(chalk.white(`  成功: ${result.ok} 条`));
  console.log(chalk.white(`  跳过(重复): ${result.skipped} 条`));
  if (result.errors.length > 0) {
    console.log(chalk.yellow(`  错误: ${result.errors.length} 条`));
    result.errors.slice(0, 5).forEach(e => console.log(chalk.yellow(`    - ${e}`)));
  }
  console.log(chalk.gray(`  来源: ${result.source}`));
}

function printDryRun(kind, result) {
  console.log(chalk.cyan('═══════════════════════════════════════════════'));
  console.log(chalk.cyan('  导入预览 (dry-run)'));
  console.log(chalk.cyan('═══════════════════════════════════════════════'));
  console.log(chalk.white(`  文件类型: ${kind}`));
  console.log(chalk.white(`  来源: ${result.source}`));
  console.log('');

  if (kind === 'codepack') {
    console.log(chalk.green(`  新增码包: ${result.ok} 个  (追溯码 ${result.total} 个)`));
    console.log(chalk.yellow(`  跳过: ${result.skipped} 个 (重名)`));
    console.log(chalk.red(`  错误: ${result.errors.length} 条`));
    if (result.preview && result.preview.length) {
      console.log(chalk.gray(`  前5条追溯码预览:`));
      result.preview.forEach(c => console.log(chalk.gray(`    ${typeof c === 'object' ? JSON.stringify(c) : c}`)));
    }
    if (result.errors.length > 0) {
      result.errors.slice(0, 5).forEach(e => console.log(chalk.red(`    - ${e}`)));
    }
  } else if (kind === 'flow') {
    console.log(chalk.green(`  新增记录: ${result.ok} 条 (发货 ${result.shipCount} / 收货 ${result.recvCount})`));
    console.log(chalk.red(`  错误: ${result.errors.length} 条`));
    if (result.preview && result.preview.length) {
      console.log(chalk.gray(`  前5条预览:`));
      result.preview.forEach(p => console.log(chalk.gray(`    [${p.type}] ${p.batchNo}  ${p.from} → ${p.to}  数量:${p.qty}  日期:${p.date}`)));
    }
    if (result.errors.length > 0) {
      result.errors.slice(0, 5).forEach(e => console.log(chalk.red(`    - ${e}`)));
    }
  } else if (kind === 'batch') {
    console.log(chalk.green(`  新增批次: ${result.ok} 条`));
    console.log(chalk.yellow(`  跳过(重复): ${result.skipped} 条`));
    console.log(chalk.red(`  错误: ${result.errors.length} 条`));
    if (result.preview && result.preview.length) {
      console.log(chalk.gray(`  前5条预览:`));
      result.preview.forEach(p => console.log(chalk.gray(`    ${p.batchNo}  产品:${p.product || '-'}  规格:${p.spec || '-'}`)));
    }
    if (result.errors.length > 0) {
      result.errors.slice(0, 5).forEach(e => console.log(chalk.red(`    - ${e}`)));
    }
  }

  console.log('');
  if (result.errors.length > 0) {
    console.log(chalk.red('  ⚠ 文件存在问题，请修正后再执行正式导入'));
  } else {
    console.log(chalk.green('  ✓ 格式校验通过，可执行正式导入'));
    console.log(chalk.gray('  → 去掉 --dry-run 选项即可写入数据'));
  }
  console.log(chalk.gray('  → 若文件有修改，可使用 durg-trace retry run 重新导入'));
}

function importCodes(file, options) {
  if (!file) {
    console.log(chalk.red('错误: 请提供文件路径'));
    return;
  }

  const filePath = path.resolve(file);
  const kind = detectKind(filePath, (options.kind || 'auto').toLowerCase());
  const dryRun = !!(options.dryRun || options['dry-run'] || options.validate);

  if (!fs.existsSync(filePath)) {
    const msg = `文件不存在: ${filePath}`;
    console.log(chalk.red(`错误: ${msg}`));
    const r = store.addRetry(`import:${kind}`, { file: filePath, options: { name: options.name, kind, dryRun } }, msg);
    console.log(chalk.gray(`  已记录重试任务: ${r.id}，修好文件后执行 durg-trace retry run --id ${r.id}`));
    return;
  }

  let result = null;
  try {
    if (kind === 'codepack') result = processCodepack(filePath, options || {});
    else if (kind === 'flow') result = processFlow(filePath);
    else if (kind === 'batch') result = processBatch(filePath);
    else {
      console.log(chalk.red(`错误: 不支持的文件类型 ${kind}`));
      return;
    }

    if (dryRun) {
      printDryRun(kind, result);
      return;
    }

    if (kind === 'codepack') {
      if (result.skipped > 0) {
        console.log(chalk.yellow(`警告: 码包 ${result.packName} 已存在，跳过`));
        return;
      }
      applyCodepack(result);
    } else if (kind === 'flow') {
      applyFlow(result);
    } else if (kind === 'batch') {
      applyBatch(result);
    }
  } catch (e) {
    console.log(chalk.red(`错误: 导入失败: ${e.message}`));
    const r = store.addRetry(`import:${kind}`, { file: filePath, options: { name: options.name, kind, dryRun } }, e.message);
    console.log(chalk.gray(`  已记录重试任务: ${r.id}，修好文件后执行 durg-trace retry run --id ${r.id}`));
  }
}

module.exports = importCodes;
module.exports.importCodes = importCodes;
module.exports.processCodepack = processCodepack;
module.exports.processFlow = processFlow;
module.exports.processBatch = processBatch;
module.exports.applyCodepack = applyCodepack;
module.exports.applyFlow = applyFlow;
module.exports.applyBatch = applyBatch;
