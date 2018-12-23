const { promisify } = require('util');
const { openSync, createWriteStream } = require('fs');
const { EOL } = require('os');
const { log: debug } = console;

let config;
const CONST_rcPath = 'rcPath=';
const CONST_logPath = 'logPath=';
const CONST_port = 'port=';
const CONST_defPort = 8080;
const configPath = (
  process.argv.find((arg) => arg.startsWith(CONST_rcPath)) || ''
).substring(CONST_rcPath.length);
const logPath = (
  process.argv.find((arg) => arg.startsWith(CONST_logPath)) || ''
).substring(CONST_logPath.length);
const socketPort =
  (process.argv.find((arg) => arg.startsWith(CONST_port)) || '').substring(
    CONST_port.length
  ) || CONST_defPort;

try {
  config = require(configPath);
} catch (e) {
  debug(e);
}

try {
  const fd = openSync(logPath, 'w');
  const ops = createWriteStream(null, { fd });
  const message = ' The logs for, aragundu, the server of pesrattu' + EOL;
  process.stdout.write = process.stderr.write = ops.write.bind(ops);
  debug(
    '#'.repeat(message.length) +
      EOL +
      message +
      '#'.repeat(message.length) +
      EOL +
      EOL
  );
} catch (e) {
  debug('failed to create a log stream with err: ', e);
}

const getSocketURL = (s) => s.remoteFamily + s.remoteAddress + s.remotePort;
// statusResponses
const ST_fail = 'fail';
const ST_success = 'success';
const sendFail = (e) => {
  debug('e @ sendFail', e);
  return { status: ST_fail, err: e };
};
const sendSuccess = (m) => {
  debug('m @ sendSuccess', m);
  return { status: ST_success, ...m };
};
const on = (promise) => {
  return promise
    .then((data) => {
      return [null, data];
    })
    .catch((err) => [err]);
};
// sendMsgsResps
const sendMsg = async (soc, msg) => {
  soc.write(JSON.stringify([0, msg]));
};
// araGunduResponses
const msgBadReq = 'req unknown to aragundu';
const msgNotReady = JSON.stringify({
  greeting:
    "aragundu, pesarattu's server failed to autoconfig the debugging instances.\n" +
    'Could not read the config file.\nUsually sent as arg, ' +
    CONST_rcPath +
    '=<rc.js>.\n' +
    'Formatted, as in documentation, with node module.exports conventions.'
});
const msgReady = JSON.stringify({
  greeting: 'aragundu, server of pesarattu is configged and ready'
});
// araGunduResponses
// sendMsgsResps
const keepTrying = promisify((promiseGetter, cb) => {
  const max = 10;
  const delay = 500;
  function rejectDelay(reason) {
    return new Promise(function(resolve, reject) {
      setTimeout(reject.bind(null, reason), delay);
    });
  }
  let p = promiseGetter();
  for (let i = 0; i < max; i++) {
    p = p.catch(promiseGetter).catch(rejectDelay);
  }
  p = p.then((res) => cb(null, res)).catch(cb);
});

// statusResponses
module.exports = {
  debug,
  sendFail,
  sendSuccess,
  sendMsg,
  on,
  keepTrying,
  config,
  logPath,
  configPath,
  msgNotReady,
  msgBadReq,
  msgReady,
  socketPort,
  getSocketURL
};
