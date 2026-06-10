const chalk = require('chalk');
const store = require('../store');

function mask(options) {
  const type = options.type || 'all';

  const sensitiveFields = ['password', 'phone', 'email', 'idCard', 'address'];

  function maskValue(val) {
    if (!val || typeof val !== 'string') return val;
    if (val.length <= 4) return '****';
    return val.substring(0, 2) + '****' + val.substring(val.length - 2);
  }

  function processRecord(record) {
    const masked = { ...record };
    sensitiveFields.forEach(field => {
      if (masked[field]) {
        masked[field] = maskValue(String(masked[field]));
      }
    });
    return masked;
  }

  let data = {};

  if (type === 'all' || type === 'account') {
    const accounts = store.load('account').map(processRecord);
    data.account = accounts;
    if (accounts.length > 0) {
      console.log(chalk.cyan('\n【账号信息】(已脱敏)'));
      accounts.forEach(a => {
        console.log(chalk.white(`  ${a.username}  机构:${a.org || '-'}  角色:${a.role || '-'}`));
      });
    }
  }

  if (type === 'all' || type === 'codepack') {
    const codepacks = store.load('codepack').map(p => {
      const masked = { ...p };
      delete masked.codes;
      return masked;
    });
    data.codepack = codepacks;
    if (codepacks.length > 0) {
      console.log(chalk.cyan('\n【码包信息】(追溯码已隐藏)'));
      codepacks.forEach(p => {
        console.log(chalk.white(`  ${p.name}  数量:${p.total}  绑定:${p.bound}`));
      });
    }
  }

  if (type === 'all' || type === 'flow') {
    const flows = store.load('flow').map(f => ({
      ...f,
      from: maskValue(f.from),
      to: maskValue(f.to),
    }));
    data.flow = flows;
    if (flows.length > 0) {
      console.log(chalk.cyan('\n【流向信息】(已脱敏)'));
      flows.forEach(f => {
        console.log(chalk.white(`  ${f.batchNo}  ${f.from} → ${f.to}  数量:${f.quantity}  状态:${f.status}`));
      });
    }
  }

  if (type === 'all' || type === 'batch') {
    data.batch = store.load('batch');
  }

  if (type === 'all' || type === 'verify') {
    data.verify = store.load('verify').map(v => {
      const masked = { ...v };
      if (masked.results) {
        masked.results = masked.results.map(r => ({
          ...r,
          code: maskValue(r.code),
        }));
      }
      return masked;
    });
  }

  store.addLog('mask', `脱敏输出, 类型: ${type}`);
  console.log(chalk.green('\n✓ 数据已脱敏输出'));
}

module.exports = mask;
