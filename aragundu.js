const { createServer } = require('net');
const { EOL } = require('os');
const { spawn } = require('child_process');
const { curry, find: _find } = require('lodash');
const { parse } = require('path');
const { promisify } = require('util');
const { openSync, createWriteStream } = require('fs');
const CDP = require('chrome-remote-interface');

// utilFunctions
const { log: debug } = console;
const on = (promise) => {
  return promise
    .then((data) => {
      return [null, data];
    })
    .catch((err) => [err]);
};
const errHndlr = (e) => {
  debug('e @ errHndlr', e);
  return { status: ST_fail, err: e };
};
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
// utilFunctions

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
// exposedCommands

// statusResponses
const ST_fail = 'fail';
const ST_success = 'success';
// statusResponses

// araGunduResponses
const RES_unknown = 'req unknown to aragundu';
const RES_configFailed =
  "aragundu, pesarattu's server failed to autoconfig the debugging instances.\n" +
  'Could not read the config file.\nUsually sent as arg, ' +
  CONST_rcPath +
  '=<rc.js>.\n' +
  'Formatted, as in documentation, with node module.exports conventions.';
const RES_configSuccess =
  'aragundu, server of pesarattu is configged and ready';
// araGunduResponses

// globalVars
const clients = {};
const CDPInstances = {};
const socketUrlsPerInstance = {};
const breakpoints = {};
const scriptMappings = {};
const configPath = (
  process.argv.find((arg) => arg.startsWith(CONST_rcPath)) || ''
).substring(CONST_rcPath.length);
const logPath = (
  process.argv.find((arg) => arg.startsWith(CONST_logPath)) || ''
).substring(CONST_logPath.length);
const port =
  (process.argv.find((arg) => arg.startsWith(CONST_port)) || '').substring(
    CONST_port.length
  ) || CONST_defPort;
let config;
try {
  config = require(configPath);
} catch (e) {
  debug(e);
}
const debugging = {};
// globalVars

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

// sendMsgsResps
const genericMessage = async (soc, msg) => {
  soc.write(JSON.stringify([0, msg]));
};
// sendMsgsResps

const newCDPInstance = async (options) => {
  const [cdpErr, client] = await on(CDP(options));
  if (cdpErr) {
    return errHndlr(cdpErr);
  }
  debug('client.webSocketUrl @ newCDPInstance', client.webSocketUrl);
  const [enDebugErr] = await on(client.Debugger.enable());
  if (enDebugErr) {
    return errHndlr(enDebugErr);
  }
  CDPInstances[client.webSocketUrl] = client;
  return { status: ST_success, debSocket: client.webSocketUrl };
};

const nodeProcessEnded = (soc, instance, signal) => {
  genericMessage(
    soc,
    'The instance, ' +
      instance +
      ' at aragundu was closed  with the signal, ' +
      signal
  );
};
const processNotStarted = (soc, instance, err) => {
  genericMessage(
    soc,
    'aragundu failed to start node process for the instance, ' + instance
  );
  genericMessage(
    soc,
    'The instance, ' +
      instance +
      ' experienced this specific error: ' +
      err.toString()
  );
};

const sendBreakpoints = async (data) => {
  debug('data @ sendBreakpoints', data);
  return { status: ST_success, yay: 'yoho' };
};

const addUrlToLocation = (instance, location) => {
  location.url = scriptMappings[instance][location.scriptId];
  return location;
};

const setBP = async (data) => {
  const instance = data.instance;
  delete data.instance;
  if (!CDPInstances || !CDPInstances[instance]) {
    return errHndlr('instance not active');
  }
  const client = CDPInstances[instance];
  const [setBPErr, bp] = await on(client.Debugger.setBreakpointByUrl(data));
  if (setBPErr) {
    return errHndlr(setBPErr);
  }
  debug('bp @ setBP', JSON.stringify(bp, null, 2));
  if (!bp || !bp.locations || !bp.locations.length) {
    return errHndlr({ err: 'not possible', instance, data });
  }
  bp.locations = getLocationsWithUrls(instance, bp.locations);
  rememberBP(instance, bp);
  return Object.assign({ status: ST_success }, bp);
};

const getBPByLoc = (instance, loc) => {
  return _find(breakpoints[instance], (b) =>
    b.locations.some(
      (l) => l.lineNumber === loc.lineNumber && l.url === loc.url
    )
  );
};

const getLocationsWithUrls = (instance, locations) =>
  locations.map(curry(addUrlToLocation)(instance));

const forgetBPById = (instance, bpId) => delete breakpoints[instance][bpId];

const rememberBP = (instance, bp) =>
  (breakpoints[instance][bp.breakpointId] = bp);

const removeBP = async (data) => {
  const instance = data.instance;
  delete data.instance;
  if (!CDPInstances || !CDPInstances[instance]) {
    return errHndlr('instance not active');
  }
  const client = CDPInstances[instance];
  const bp = getBPByLoc(instance, data);
  if (!bp) {
    return errHndlr('Breakpoint not found');
  }
  const breakpointId = bp.breakpointId;
  const [removeBPErr] = await on(
    client.Debugger.removeBreakpoint({ breakpointId })
  );
  if (removeBPErr) {
    return errHndlr(removeBPErr);
  }
  debug('breakpointId @ removeBP', breakpointId);
  forgetBPById(instance, breakpointId);
  return Object.assign({ status: ST_success }, bp);
};

const getRemoteSocket = (url) => clients[url];

const paused = async (instance, params) => {
  if (params.hitBreakpoints) {
    params.hitBreakpoints.map((id) => {
      const bp = breakpoints[instance][id];
      socketUrlsPerInstance[instance].map((url) => {
        try {
          const socket = getRemoteSocket(url);
          if (socket) {
            genericMessage(
              socket,
              Object.assign({ pausedBP: bp }, { instance })
            );
          }
        } catch (e) {
          debug(
            'e , instance, params, url @ send paused message to remote url',
            e,
            instance,
            params,
            url
          );
        }
      });
    });
  }
};

const addSocketToInstance = (soc, ins) => {
  const remote = getSocketRemote(soc);
  if (!socketUrlsPerInstance[ins]) {
    socketUrlsPerInstance[ins] = [remote];
  } else if (!socketUrlsPerInstance.includes(remote)) {
    socketUrlsPerInstance[ins].push(remote);
  }
};

const startDebug = async (soc, data) => {
  const instance = data.instance;

  // if the instance is already being debugged, send an ack directly
  if (CDPInstances && CDPInstances[instance]) {
    addSocketToInstance(soc, instance);
    return { status: ST_success, instance: instance };
  }

  const options = config.instances[instance];
  const CDPOptions = {};

  if (options.type === CONST_nodeInspect) {
    const args = options.command.substring(CONST_node.length + 1).split(' ');

    const instanceLog = logPath + instance;
    let stdio;
    try {
      // accessSync(instanceLog, CONST_fs.R_OK | CONST_fs.W_OK);
      // await on(promisify(rename)(instanceLog, instanceLog + 'prev'));
      const fd = openSync(instanceLog, 'w');
      const ops = createWriteStream(null, { fd });
      const message =
        ' aragundu, the server of Pesrattu is loggin the instance ' +
        instance +
        EOL;
      ops.write(
        '#'.repeat(message.length) +
          EOL +
          message +
          '#'.repeat(message.length) +
          EOL +
          EOL
      );
      stdio = ['pipe', ops, ops];
    } catch (e) {
      // do nothing and the default stdio will be configged
    }

    const spawnArgs = [CONST_node, args, { cwd: CONST_fsRoot, stdio }];
    const process = spawn(...spawnArgs);
    process.on('close', curry(nodeProcessEnded)(soc, instance));
    process.on('error', curry(processNotStarted)(soc, instance));

    const inspectArg =
      // check first for inspect-brk flag and then for inspect flag else pass empty string
      args.find(
        (a) => a.startsWith(CONST_inspectBrk) || a.startsWith(CONST_inspect)
      ) || '';

    CDPOptions.port =
      inspectArg.split('=').length > 1 // check if inspect options are given
        ? inspectArg.split(':').length > 1 //check if inspect options are of <host>:<port>
          ? inspectArg.split(':')[1] // get <port> from <host>:<port>
          : inspectArg.split('=')[1] // get <port> from <port>
        : CONST_inspectPort; // no inspect options, go for default
    CDPOptions.host =
      inspectArg.split('=').length > 1 // check if inspect options are given
        ? inspectArg.split(':').length > 1 //check if inspect options are of <host>:<port>
          ? inspectArg.split(':')[0] // get <host> from <host>:<port>
          : CONST_inspectAddr // inspect options if of <port> only. useless.
        : CONST_inspectAddr; // no inspect options, go for default
    debugging[instance] = {
      process,
      type: options.type
    };

    genericMessage(
      soc,
      'The instance ' +
        instance +
        ' was spawned with these param: ' +
        JSON.stringify(spawnArgs)
    );
  }
  // let counter = 1;
  const [cdpErr, client] = await on(keepTrying(() => CDP(CDPOptions)));
  if (cdpErr) {
    return errHndlr(cdpErr);
  }
  debug('client.webSocketUrl @ newCDPInstance', client.webSocketUrl);

  // collect all sID to url mappings for future use
  scriptMappings[instance] = {};
  client.on('Debugger.scriptParsed', (p) => {
    scriptMappings[instance][p.scriptId] = p.url;
  });

  const [enDebugErr] = await on(client.Debugger.enable());
  client.on('Debugger.paused', curry(paused)(instance));
  if (enDebugErr) {
    return errHndlr(enDebugErr);
  }
  CDPInstances[instance] = client;
  addSocketToInstance(soc, instance);
  if (!breakpoints[instance]) {
    breakpoints[instance] = {};
  }
  return { status: ST_success, instance: instance };
};

const getSocketRemote = (s) => s.remoteFamily + s.remoteAddress + s.remotePort;

const pesarattuHandler = async (socket) => {
  const remote = getSocketRemote(socket);
  debug('connected @ socket ', remote);
  clients[remote] = socket;

  let servings = 0;
  const waitingOrders = {};

  if (!config) {
    genericMessage(socket, RES_configFailed);
  } else {
    genericMessage(socket, RES_configSuccess);
    genericMessage(socket, { instances: Object.keys(config.instances) });
  }

  const flushWaiting = async () => {
    if (Object.keys(waitingOrders).length) {
      debug('whaaaat? waiting on orders? waaaaat? ', waitingOrders);
    }
  };
  const serveOrder = async (data) => {
    if (!data[1] || !data[1].attu) {
      let msg = ['ex', "echo 'teehe'"];
      if (data[1].includes('orai')) {
        msg = 'sup?';
      }
      return await socket.write(JSON.stringify([data[0], msg]));
    }
    const command = data[1].attu;
    delete data[1].attu;
    const commandCount = data[0];
    const req = data[1];
    let commandHandler = () => {
      return errHndlr(RES_unknown);
    };

    if (command === CONST_newInstance) {
      commandHandler = newCDPInstance;
    } else if (command === CONST_startDebug) {
      commandHandler = curry(startDebug)(socket);
    } else if (command === CONST_populateBreakpoints) {
      commandHandler = sendBreakpoints;
    } else if (command === CONST_setBP) {
      commandHandler = setBP;
    } else if (command === CONST_removeBP) {
      commandHandler = removeBP;
    }
    const res = await commandHandler(req);
    return await socket.write(JSON.stringify([commandCount, res]));
  };

  socket.on('data', async (data) => {
    try {
      data = JSON.parse(data.toString());
    } catch (e) {
      debug('data.toString() @ parse data', data.toString());
      return socket.write(JSON.stringify(errHndlr(e)));
    }
    debug('data @ socket', data);
    // vim counts its requests.
    // store the out of order requests and serve them later
    if (servings + 1 < parseInt(data[0])) {
      waitingOrders[data[0]] = data;
      return;
    }
    await serveOrder(data);
    servings += 1;
    flushWaiting();
  });

  socket.on('close', () => {
    debug('disconnected');
    delete clients[getSocketRemote(socket)];
  });
};

const commandReceiver = createServer(pesarattuHandler);
try {
  commandReceiver.listen(port);
  debug('port openned at ', port);
} catch (e) {
  debug('failed to start a listening socket at ', port, '\nErr:', e);
}
