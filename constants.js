const { parse } = require('path');

// miscConsts
const CONST_rcPath = 'rcPath=';
const CONST_logPath = 'logPath=';
const CONST_port = 'port=';
const CONST_defPort = 8080;
const CONST_nodeInspect = 'node-inspect';
const CONST_inspect = '--inspect';
const CONST_inspectBrk = '--inspect-brk';
const CONST_inspectPort = 9229;
const CONST_inspectAddr = 'localhost';
const CONST_node = 'node';
const CONST_fsRoot = parse(process.cwd()).root;
// miscConsts

// exposedCommands
const CONST_newInstance = 'new instance';
const CONST_populateBreakpoints = 'populate breakpoints';
const CONST_startDebug = 'debug';
const CONST_setBP = 'setBP';
const CONST_removeBP = 'removeBP';
const CONST_resume = 'resume';
// exposedCommands

// statusResponses
const ST_fail = 'fail';
const ST_success = 'success';
// statusResponses

// araGunduResponses
const RES_unknown = 'req unknown to aragundu';
const RES_configFailed = JSON.stringify({
  greeting:
    "aragundu, pesarattu's server failed to autoconfig the debugging instances.\n" +
    'Could not read the config file.\nUsually sent as arg, ' +
    CONST_rcPath +
    '=<rc.js>.\n' +
    'Formatted, as in documentation, with node module.exports conventions.'
});
const RES_configSuccess = JSON.stringify({
  greeting: 'aragundu, server of pesarattu is configged and ready'
});
// araGunduResponses
module.exports = {
  CONST_rcPath,
  CONST_logPath,
  CONST_port,
  CONST_defPort,
  CONST_nodeInspect,
  CONST_inspect,
  CONST_inspectBrk,
  CONST_inspectPort,
  CONST_inspectAddr,
  CONST_node,
  CONST_fsRoot,

  CONST_newInstance,
  CONST_populateBreakpoints,
  CONST_startDebug,
  CONST_setBP,
  CONST_removeBP,
  CONST_resume,

  ST_fail,
  ST_success,

  RES_unknown,
  RES_configFailed,
  RES_configSuccess
};
