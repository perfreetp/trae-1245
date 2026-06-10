const chalk = require('chalk');
const store = require('../store');

function config(action, key, options) {
  const accounts = store.load('account');

  if (action === 'set') {
    if (!key) {
      console.log(chalk.red('错误: 请提供配置项名称'));
      return;
    }
    const value = options.value || '';
    const currentAccount = accounts.length > 0 ? accounts[accounts.length - 1] : null;
    if (!currentAccount) {
      console.log(chalk.red('错误: 请先使用 login 登录'));
      return;
    }
    currentAccount[key] = value;
    store.save('account', accounts);
    store.addLog('config', `设置 ${key} = ${value}`);
    console.log(chalk.green(`✓ 已设置 ${key} = ${value}`));
    return;
  }

  if (action === 'get') {
    if (!key) {
      console.log(chalk.red('错误: 请提供配置项名称'));
      return;
    }
    const currentAccount = accounts.length > 0 ? accounts[accounts.length - 1] : null;
    if (!currentAccount) {
      console.log(chalk.red('错误: 请先使用 login 登录'));
      return;
    }
    console.log(chalk.cyan(`${key} = ${currentAccount[key] || '未设置'}`));
    return;
  }

  if (action === 'list' || !action) {
    const currentAccount = accounts.length > 0 ? accounts[accounts.length - 1] : null;
    if (!currentAccount) {
      console.log(chalk.red('错误: 请先使用 login 登录'));
      return;
    }
    console.log(chalk.cyan('当前机构配置信息:'));
    Object.entries(currentAccount).forEach(([k, v]) => {
      const display = k === 'password' && v ? '******' : v;
      console.log(chalk.white(`  ${k}: ${display}`));
    });
    return;
  }

  console.log(chalk.red(`未知操作: ${action}`));
  console.log(chalk.gray('可用操作: set, get, list'));
}

module.exports = config;
