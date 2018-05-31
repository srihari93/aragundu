const net = require('net');
const CDP = require('chrome-remote-interface');
// const _ = require('lodash');

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
// utilFunctions

// exposedCommands
const newInstance = 'new instance';
const populateBreakpoints = 'populate breakpoints';
// exposedCommands

// statusResponses
const ST_fail = 'fail';
const ST_success = 'success';
// statusResponses

// araGunduResponses
const RES_unknown = 'req unknown to aragundu';
const RES_hi = 'chittam maha prabhu';
// araGunduResponses

// globalVars
const clients = [];
const CDPInstances = [];
// globalVars

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

const sendBreakpoints = async (data) => {
  return { status: ST_success, yay: 'yoho' };
};

const pesarattuHandler = async (socket) => {
  clients.push(socket);

  let servings = 0;
  const waitingOrders = {};

  socket.write(JSON.stringify([0, RES_hi]));

  const flushWaiting = async () => {
    if (Object.keys(waitingOrders).length) {
      debug('whaaaat? waiting on orders? waaaaat? ', waitingOrders);
    }
  };
  const serveOrder = async (data) => {
    debug(data);
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

    if (command === newInstance) {
      commandHandler = newCDPInstance;
    } else if (command === populateBreakpoints) {
      commandHandler = sendBreakpoints;
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
    debug('data @ location', data);
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
    const clientIndx = clients.indexOf(socket);
    clients.splice(clientIndx, 1);
  });
};

const commandReceiver = net.createServer(pesarattuHandler);

commandReceiver.listen(8080);
