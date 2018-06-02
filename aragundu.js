const net = require('net');
const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const _ = require('lodash');
const path = require('path');
const { promisify } = require('util');

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
const CONST_port = 'port=';
const CONST_defPort = 8080;
const CONST_nodeInspect = 'node-inspect';
const CONST_inspect = '--inspect';
const CONST_inspectBrk = '--inspect-brk';
const CONST_inspectPort = 9229;
const CONST_inspectAddr = 'localhost';
const CONST_node = 'node';
const CONST_fsRoot = path.parse(process.cwd()).root;
// miscConsts

// exposedCommands
const CONST_newInstance = 'new instance';
const CONST_populateBreakpoints = 'populate breakpoints';
const CONST_startDebug = 'debug';
const CONST_setBP = 'setBP';
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
const clients = [];
const CDPInstances = {};
const scriptMappings = {};
const configPath = (
  process.argv.find((arg) => arg.startsWith(CONST_rcPath)) || ''
).substring(CONST_rcPath.length);
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
  soc,
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
  debug('scriptMappings @ addUrlToLocation', scriptMappings);
  debug('location @ addUrlToLocation', location);
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
  bp.locations = bp.locations.map(_.curry(addUrlToLocation)(instance));
  debug('bp @ setBP', JSON.stringify(bp, null, 2));
  return Object.assign({ status: ST_success }, bp);
};

const startDebug = async (soc, data) => {
  // if the instance is already being debugged, send an ack directly
  if (CDPInstances && CDPInstances[data.instance]) {
    return { status: ST_success, instance: data.instance };
  }

  const options = config.instances[data.instance];
  const CDPOptions = {};

  if (options.type === CONST_nodeInspect) {
    const args = options.command.substring(CONST_node.length + 1).split(' ');
    const spawnArgs = [CONST_node, args, { cwd: CONST_fsRoot }];

    const process = spawn(...spawnArgs);
    process.on('close', _.curry(nodeProcessEnded)(soc, data.instance));
    process.on('error', _.curry(processNotStarted)(soc, data.instance));

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
    debugging[data.instance] = {
      process,
      type: options.type
    };

    genericMessage(
      soc,
      'The instance ' +
        data.instance +
        ' was spawned with these param: ' +
        JSON.stringify(spawnArgs)
    );
  }
  // let counter = 1;
  const [cdpErr, client] = await on(
    keepTrying(() => {
      // genericMessage(
      //   soc,
      //   'The CDP is trying to connect the instance ' +
      //     data.instance +
      //     ' for ' +
      //     counter++ +
      //     ' time'
      // );
      return CDP(CDPOptions);
    })
  );
  if (cdpErr) {
    return errHndlr(cdpErr);
  }
  debug('client.webSocketUrl @ newCDPInstance', client.webSocketUrl);

  // collect all sID to url mappings for future use
  scriptMappings[data.instance] = {};
  client.on('Debugger.scriptParsed', (p) => {
    scriptMappings[data.instance][p.scriptId] = p.url;
  });

  const [enDebugErr] = await on(client.Debugger.enable());
  if (enDebugErr) {
    return errHndlr(enDebugErr);
  }
  CDPInstances[data.instance] = client;
  return { status: ST_success, instance: data.instance };
};

const pesarattuHandler = async (socket) => {
  debug('connected');
  clients.push(socket);

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
      commandHandler = _.curry(startDebug)(socket);
    } else if (command === CONST_populateBreakpoints) {
      commandHandler = sendBreakpoints;
    } else if (command === CONST_setBP) {
      commandHandler = setBP;
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
    const clientIndx = clients.indexOf(socket);
    clients.splice(clientIndx, 1);
  });
};

const commandReceiver = net.createServer(pesarattuHandler);
try {
  commandReceiver.listen(port);
  debug('port @ socket', port);
} catch (e) {
  debug('aragundu: failed to start a listening socket at ', port, '\nErr:', e);
}
