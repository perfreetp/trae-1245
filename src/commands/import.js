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

function importCodepack(filePath, options) {
  const records = readAndParseFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const codes = records.map(r => {
    if (typeof r === 'string') return r;
    return r.code || r.traceCode || r.trace_code || r['追溯码'] || r;
  }).filter(c => c !== undefined && c !== null && c !== '');

  if (codes.length === 0) {
    throw new Error('码包文件解析后为空，请检查文件格式');
  }

  const packName = options.name || path.basename(filePath, ext);
  const codepacks = store.load('codepack');

  const codepack = {
    id: 'CP' + Date.now().toString(36).toUpperCase(),
    name: packName,
    source: filePath,
    total: codes.length,
    codes: codes,
    importedAt: new Date().toISOString(),
    bound: false,
  };

  codepacks.push(codepack);
  store.save('codepack', codepacks);
  store.addLog('import', `导入码包 ${packName}, 共 ${codes.length} 个追溯码`);

  console.log(chalk.green(`✓ 码包导入成功`));
  console.log(chalk.white(`  名称: ${packName}`));
  console.log(chalk.white(`  码包ID: ${codepack.id}`));
  console.log(chalk.white(`  追溯码数量: ${codes.length}`));
  console.log(chalk.gray(`  来源: ${filePath}`));

  const preview = codes.length <= 10 ? codes : codes.slice(0, 5);
  console.log(chalk.gray(`  ${codes.length <= 10 ? '追溯码' : '前5条追溯码'}:`));
  preview.forEach(c => console.log(chalk.gray(`    ${typeof c === 'object' ? JSON.stringify(c) : c}`)));
  if (codes.length > 10) {
    console.log(chalk.gray(`  ... 还有 ${codes.length - 5} 条`));
  }
  return codepack;
}

function importFlow(filePath) {
  const records = readAndParseFile(filePath);
  if (records.length === 0 || (records[0] && typeof records[0] === 'string')) {
    throw new Error('流向文件必须包含表头: 推荐 type,batchNo,from,to,quantity,date,... 或 发货/收货,批号,发货方,收货方,数量,日期');
  }

  const flows = store.load('flow');
  let shipCount = 0;
  let recvCount = 0;
  const errors = [];
  const createdIds = [];

  records.forEach((r, idx) => {
    const type = (r.type || r['类型'] || r['类型标识'] || '').toString().toLowerCase();
    const isReceive = type.includes('receive') || type.includes('收') || type.includes('rcv');
    const isShip = !isReceive && (type.includes('ship') || type.includes('发') || type.includes('out') || type === '');

    const batchNo = r.batchNo || r['批号'] || r['批次号'] || r.batchno || r['批次'];
    const from = r.from || r['发货方'] || r['fromOrg'] || r['发货单位'];
    const to = r.to || r['收货方'] || r['toOrg'] || r['收货单位'];
    const quantity = parseInt(r.quantity || r['数量'] || r.qty || r['件数']) || 0;
    const date = r.date || r['日期'] || r['发货日期'] || r['收货日期'] || r['操作日期'] || new Date().toISOString().split('T')[0];
    const receivedBy = r.receivedBy || r['收货人'] || r['验收人'] || '';
    const remark = r.remark || r['备注'] || '';

    if (!batchNo || !quantity || quantity <= 0) {
      errors.push(`第${idx + 2}行: 缺少批号或有效数量`);
      return;
    }

    if (isReceive) {
      const shipFlow = flows
        .filter(f => f.type === 'ship' && f.batchNo === batchNo && f.status === 'reported' && !f._matched)
        .sort((a, b) => a.date.localeCompare(b.date))[0];

      if (!shipFlow && (!from || !to)) {
        errors.push(`第${idx + 2}行: 收货记录无法匹配到发货记录，且未提供from/to`);
        return;
      }

      if (shipFlow) {
        shipFlow.status = 'received';
        shipFlow.receivedAt = new Date().toISOString();
        shipFlow._matched = true;
      }

      const recv = {
        id: 'RCV' + Date.now().toString(36).toUpperCase() + idx,
        type: 'receive',
        shipFlowId: shipFlow ? shipFlow.id : '',
        batchNo,
        from: from || (shipFlow ? shipFlow.from : ''),
        to: to || (shipFlow ? shipFlow.to : ''),
        quantity,
        receivedBy: receivedBy || (to || (shipFlow ? shipFlow.to : '')),
        date,
        remark,
        createdAt: new Date().toISOString(),
      };
      flows.push(recv);
      createdIds.push(recv.id);
      recvCount += 1;
    } else if (isShip) {
      if (!from || !to) {
        errors.push(`第${idx + 2}行: 发货记录缺少 from/to`);
        return;
      }
      const ship = {
        id: 'FLW' + Date.now().toString(36).toUpperCase() + idx,
        type: 'ship',
        batchNo,
        from,
        to,
        quantity,
        date,
        status: 'reported',
        remark,
        createdAt: new Date().toISOString(),
      };
      flows.push(ship);
      createdIds.push(ship.id);
      shipCount += 1;
    } else {
      errors.push(`第${idx + 2}行: 无法识别类型 ${type}`);
    }
  });

  flows.forEach(f => delete f._matched);
  store.save('flow', flows);
  store.addLog('import', `批量导入流向: 发货 ${shipCount}, 收货 ${recvCount}, 错误 ${errors.length}`);

  console.log(chalk.green(`✓ 流向批量导入完成`));
  console.log(chalk.white(`  发货记录: ${shipCount} 条`));
  console.log(chalk.white(`  收货记录: ${recvCount} 条`));
  if (errors.length > 0) {
    console.log(chalk.yellow(`  跳过: ${errors.length} 条`));
    errors.slice(0, 5).forEach(e => console.log(chalk.yellow(`    - ${e}`)));
    if (errors.length > 5) console.log(chalk.yellow(`    ... 共 ${errors.length} 条错误`));
  }
  console.log(chalk.gray(`  来源: ${filePath}`));
  return { shipCount, recvCount, errors, createdIds };
}

function importBatch(filePath) {
  const records = readAndParseFile(filePath);
  if (records.length === 0 || (records[0] && typeof records[0] === 'string')) {
    throw new Error('批次文件必须包含表头: 推荐 batchNo,product,prodDate,expiry,packId 或 批号,产品,生产日期,有效期,码包ID');
  }

  const batches = store.load('batch');
  let ok = 0;
  let skipped = 0;
  const errors = [];

  records.forEach((r, idx) => {
    const batchNo = r.batchNo || r['批号'] || r['批次号'] || r['批次'];
    if (!batchNo) {
      errors.push(`第${idx + 2}行: 缺少批号`);
      return;
    }
    if (batches.find(b => b.batchNo === batchNo)) {
      skipped += 1;
      return;
    }
    const product = r.product || r['产品'] || r['产品名称'] || r['药品名称'] || '';
    const prodDate = r.prodDate || r['生产日期'] || r['生产批号日期'] || r.productionDate || '';
    const expiry = r.expiry || r['有效期至'] || r['到期日'] || r.expireDate || '';
    const packId = r.packId || r['码包ID'] || r['码包'] || r.codepackId || '';
    const spec = r.spec || r['规格'] || r['药品规格'] || '';

    batches.push({
      id: 'BAT' + Date.now().toString(36).toUpperCase() + idx,
      batchNo,
      packId,
      product,
      spec,
      prodDate,
      expiry,
      status: 'registered',
      createdAt: new Date().toISOString(),
    });
    ok += 1;
  });

  store.save('batch', batches);
  store.addLog('import', `批量导入批次: 成功 ${ok}, 跳过 ${skipped}, 错误 ${errors.length}`);

  console.log(chalk.green(`✓ 批次批量导入完成`));
  console.log(chalk.white(`  成功: ${ok} 条`));
  console.log(chalk.white(`  跳过(重复): ${skipped} 条`));
  if (errors.length > 0) {
    console.log(chalk.yellow(`  错误: ${errors.length} 条`));
    errors.slice(0, 5).forEach(e => console.log(chalk.yellow(`    - ${e}`)));
  }
  console.log(chalk.gray(`  来源: ${filePath}`));
  return { ok, skipped, errors };
}

function importCodes(file, options) {
  if (!file) {
    console.log(chalk.red('错误: 请提供文件路径'));
    return;
  }

  const filePath = path.resolve(file);
  const kind = detectKind(filePath, (options.kind || 'auto').toLowerCase());

  if (!fs.existsSync(filePath)) {
    const msg = `文件不存在: ${filePath}`;
    console.log(chalk.red(`错误: ${msg}`));
    const r = store.addRetry(`import:${kind}`, { file: filePath, options: { name: options.name, kind } }, msg);
    console.log(chalk.gray(`  已记录重试任务: ${r.id}，修好文件后执行 durg-trace retry run --id ${r.id}`));
    return;
  }

  try {
    if (kind === 'codepack') {
      importCodepack(filePath, options);
    } else if (kind === 'flow') {
      importFlow(filePath);
    } else if (kind === 'batch') {
      importBatch(filePath);
    } else {
      console.log(chalk.red(`错误: 不支持的文件类型 ${kind}`));
    }
  } catch (e) {
    console.log(chalk.red(`错误: 导入失败: ${e.message}`));
    const r = store.addRetry(`import:${kind}`, { file: filePath, options: { name: options.name, kind } }, e.message);
    console.log(chalk.gray(`  已记录重试任务: ${r.id}，修好文件后执行 durg-trace retry run --id ${r.id}`));
  }
}

module.exports = importCodes;
module.exports.importCodes = importCodes;
module.exports.importCodepack = importCodepack;
module.exports.importFlow = importFlow;
module.exports.importBatch = importBatch;
