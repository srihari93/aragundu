const CDP = require('chrome-remote-interface');
const { spawn } = require('child_process');
const { EOL } = require('os');
const { parse } = require('path');
const { openSync, createWriteStream } = require('fs');
const { curry, find: _find } = require('lodash');

const {
  sendMsg,
  sendSuccess,
  debug,
  sendFail,
  on,
  keepTrying,
  config,
  logPath,
  getSocketURL
} = require('./util.js');

const CONST_nodeInspect = 'node-inspect';
const CONST_inspect = '--inspect';
const CONST_inspectBrk = '--inspect-brk';
const CONST_inspectPort = 9229;
const CONST_inspectAddr = 'localhost';
const CONST_node = 'node';
const CONST_fsRoot = parse(process.cwd()).root;

const CDPInstances = {};
const debugging = {};
const sockets = {};
const scriptMappings = {};
const breakpoints = {};

const nodeProcessEnded = (soc, instance, signal) => {
  sendMsg(soc, { msg: instance + ' instane closed with signal ' + signal });
};
const setBP = async (data) => {
  const instance = data.instance;
  delete data.instance;
  if (!CDPInstances || !CDPInstances[instance]) {
    return sendFail('instance not active');
  }
  const client = CDPInstances[instance];
  const [setBPErr, bp] = await on(client.Debugger.setBreakpointByUrl(data));
  if (setBPErr) {
    return sendFail(setBPErr);
  }
  debug('bp @ setBP', JSON.stringify(bp, null, 2));
  if (!bp || !bp.locations || !bp.locations.length) {
    return sendFail({ err: 'not possible', instance, data });
  }
  bp.locations = getLocationsWithUrls(instance, bp.locations);
  rememberBP(instance, bp);
  return sendSuccess(bp);
};

const forgetBPById = (instance, bpId) => delete breakpoints[instance][bpId];

const rememberBP = (instance, bp) =>
  (breakpoints[instance][bp.breakpointId] = bp);

const removeBP = async (data) => {
  const instance = data.instance;
  delete data.instance;
  if (!CDPInstances || !CDPInstances[instance]) {
    return sendFail('instance not active');
  }
  const client = CDPInstances[instance];
  const bp = getBPByLoc(instance, data);
  if (!bp) {
    return sendFail('Breakpoint not found');
  }
  const breakpointId = bp.breakpointId;
  const [removeBPErr] = await on(
    client.Debugger.removeBreakpoint({ breakpointId })
  );
  if (removeBPErr) {
    return sendFail(removeBPErr);
  }
  debug('breakpointId @ removeBP', breakpointId);
  forgetBPById(instance, breakpointId);
  return sendSuccess(bp);
};
const getBPByLoc = (instance, loc) => {
  return _find(breakpoints[instance], (b) =>
    b.locations.some(
      (l) => l.lineNumber === loc.lineNumber && l.url === loc.url
    )
  );
};

const processNotStarted = (soc, instance, err) => {
  sendMsg(soc, Object.assign({ msg: 'failed to start instance' }, err));
};

const addSocketToInstance = (soc, ins) => {
  const socUrl = getSocketURL(soc);
  if (!sockets[ins]) {
    sockets[ins] = { socUrl: soc };
  } else if (!sockets[ins][socUrl]) {
    sockets[ins][socUrl] = soc;
  }
};

const addUrlToLocation = (instance, location) => {
  location.url = scriptMappings[instance][location.scriptId];
  return location;
};

const getLocationsWithUrls = (instance, locations) =>
  locations.map(curry(addUrlToLocation)(instance));

const paused = async (availableSockets, instance, params) => {
  debug('instance @ paused', instance);
  debug('params @ paused', params);
  if (params.hitBreakpoints) {
    params.hitBreakpoints.map((id) => {
      const bp = breakpoints[instance][id];
      sockets[instance].entries.map((socket) => {
        try {
          debug('getSocketURL @ pause', getSocketURL(socket));
          if (socket) {
            sendMsg(socket, Object.assign({ pausedBP: bp }, { instance }));
          }
        } catch (e) {
          debug(
            'e , instance, params, url @ send paused message to remote url',
            e,
            instance,
            params,
            getSocketURL(socket)
          );
        }
      });
    });
  }
};

const startDebug = async (soc, data) => {
  const instance = data.instance;

  // if the instance is already being debugged, send an ack directly
  if (CDPInstances && CDPInstances[instance]) {
    addSocketToInstance(soc, instance);
    debug('instance @ location', JSON.stringify(instance, null, 2));
    return sendSuccess({ instance });
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

    sendMsg(
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
    return sendFail(cdpErr);
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
    return sendFail(enDebugErr);
  }
  CDPInstances[instance] = client;
  addSocketToInstance(soc, instance);
  if (!breakpoints[instance]) {
    breakpoints[instance] = {};
  }
  return sendSuccess({ instance });
};
module.exports = {
  startDebug,
  setBP,
  removeBP
};
