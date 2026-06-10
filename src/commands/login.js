const chalk = require('chalk');
const store = require('../store');

function login(username, options) {
  const accounts = store.load('account');
  const password = options.password || '';
  const org = options.org || '';

  if (!username) {
    console.log(chalk.red('错误: 请提供用户名'));
    return;
  }

  const existing = accounts.find(a => a.username === username);
  if (existing) {
    existing.loginAt = new Date().toISOString();
    if (org) existing.org = org;
    store.save('account', accounts);
    store.addLog('login', `用户 ${username} 重新登录`);
    console.log(chalk.green(`✓ 用户 ${username} 登录成功`));
    console.log(chalk.gray(`  机构: ${existing.org || '未设置'}`));
    console.log(chalk.gray(`  登录时间: ${existing.loginAt}`));
    return;
  }

  const account = {
    id: 'ACC' + Date.now().toString(36).toUpperCase(),
    username,
    password,
    org,
    role: 'operator',
    loginAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  accounts.push(account);
  store.save('account', accounts);
  store.addLog('login', `新用户 ${username} 登录注册`);
  console.log(chalk.green(`✓ 用户 ${username} 登录成功（新注册）`));
  console.log(chalk.gray(`  机构: ${org || '未设置'}`));
  console.log(chalk.gray(`  账号ID: ${account.id}`));
}

module.exports = login;
