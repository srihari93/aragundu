const { createServer } = require('net');
const { curry } = require('lodash');

const { setBP, startDebug, removeBP } = require('./cdp.js');
const {
  sendMsg,
  sendSuccess,
  debug,
  sendFail,
  on,
  config,
  msgNotReady,
  msgBadReq,
  msgReady,
  socketPort,
  getSocketURL
} = require('./util.js');

// utilFunctions
// utilFunctions

// exposedCommands
const CONST_populateBreakpoints = 'populate breakpoints';
const CONST_startDebug = 'debug';
const CONST_setBP = 'setBP';
const CONST_removeBP = 'removeBP';
const CONST_resume = 'resume';
// exposedCommands

// globalVars
const clients = {};
const CDPInstances = {};
// globalVars

const sendBreakpoints = async (data) => {
  debug('data @ sendBreakpoints', data);
  return sendSuccess({ yay: 'yoho' });
};

const resume = async (data) => {
  const instance = data.instance;
  delete data.instance;
  if (!CDPInstances || !CDPInstances[instance]) {
    return sendFail('instance not active');
  }
  const client = CDPInstances[instance];
  const [resumeErr] = await on(client.Debugger.resume());
  if (resumeErr) {
    return sendFail(resumeErr);
  }
  return sendSuccess(data);
};

const pesarattuHandler = async (socket) => {
  const remote = getSocketURL(socket);
  debug('connected @ socket ', remote);
  clients[remote] = socket;

  let servings = 0;
  const waitingOrders = {};

  if (!config) {
    sendMsg(socket, msgNotReady);
  } else {
    sendMsg(socket, msgReady);
    sendMsg(socket, { instances: Object.keys(config.instances) });
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
      return sendFail(msgBadReq);
    };

    if (command === CONST_startDebug) {
      commandHandler = curry(startDebug)(socket);
    } else if (command === CONST_populateBreakpoints) {
      commandHandler = sendBreakpoints;
    } else if (command === CONST_setBP) {
      commandHandler = setBP;
    } else if (command === CONST_removeBP) {
      commandHandler = removeBP;
    } else if (command === CONST_resume) {
      commandHandler = resume;
    }
    const res = await commandHandler(req);
    return await socket.write(JSON.stringify([commandCount, res]));
  };

  socket.on('data', async (data) => {
    try {
      data = JSON.parse(data.toString());
    } catch (e) {
      debug('data.toString() @ parse data', data.toString());
      return socket.write(JSON.stringify(sendFail(e)));
    }
    debug('data from ', remote, ' ', data);
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
    delete clients[getSocketURL(socket)];
  });
};

const commandReceiver = createServer(pesarattuHandler);
commandReceiver.on('error', (err) => {
  debug('err @ server error event', err);
});
commandReceiver.on('closed', () => {
  debug('aragundu server closed');
});
try {
  commandReceiver.listen(socketPort);
  debug('socketPort openned at ', socketPort);
} catch (e) {
  debug('failed to start a listening socket at ', socketPort, '\nErr:', e);
}
