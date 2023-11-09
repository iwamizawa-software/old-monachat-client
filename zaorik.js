const net = require('net');
const io = require('socket.io-client');
const fs = require('fs');
const readline = require('readline').createInterface({
  input: process.stdin,
  output: process.stdout
});
var config = new function () {
  Object.assign(this, {
    "astralURL": "wss://monachat.xyz/",
    "astralPath": "/monachatchat/",
    "monaPort" : 9095,
    "max": {"name": 23, "stat": 23, "cmt": 100},
    "monaArea": {"x": [30, 690], "y": [240, 320]},
    "astralArea": {"x": [0, 940], "y": [170, 350]},
    "scalable": 1,
    "debug": 1
  });
  this.load = function () {
    try {
      Object.assign(this, JSON.parse(fs.readFileSync('config.txt')));
    } catch (e) {
      console.log(e);
    }
  };
  this.load();
};
console.log('ザオリク\nreloadで設定リロード exitで終了');

readline.question('', function f(ans) {
  var command = ans.split(/\s/);
  switch (command[0]) {
    case 'reload':
      config.load();
      break;
    case 'exit':
      process.exit();
  }
  readline.question('', f);
});

const log = text => config.debug && console.log(text);
const convert = (type, from, to, n) => Math.round((+n - from[type][0]) * (to[type][1] - to[type][0]) / (from[type][1] - from[type][0]) + to[type][0]);
const convertPosition = (from, to, attr) => {
  if ('x' in attr)
    attr.x = convert('x', from, to, attr.x);
  if ('y' in attr)
    attr.y = convert('y', from, to, attr.y);
  if ('scl' in attr)
    attr.scl = +attr.scl < 0 ? -100 : 100;
  return attr;
};
const getihash = id => Buffer.from(id.replace(/-/g, '').replace(/../g, s => String.fromCharCode('0x' + s))).toString('base64').slice(0, 10);

const AstralClient = function () {
  this.id = 1;
  this.idCounter = 2;
  this.idCache = {};
  this.roomInfo = {c: 0, n: 'a'};
  this.setInfo = {x: 0, y: 0, scl: 100, stat: '通常'};
  this.buffer = [];
};
Object.assign(AstralClient.prototype, {
  send: function (type, obj) {
    if (!this.socket || !this.socket.connected)
      return this.buffer.push([type, obj]);
    if (this.token)
      obj.token = this.token;
    obj = convertPosition(config.monaArea, config.astralArea, Object.assign({}, obj));
    ['style', 'r', 'g', 'b'].forEach(key => { if (key in obj) obj[key] = +obj[key];});
    delete obj.umax;
    queueMicrotask(() => log('→☆ω:' + JSON.stringify([type, obj])));
    this.socket.emit(type, obj);
  },
  getMonaId: function (astralId) {
    return this.idCache[astralId] || (this.idCache[astralId] = this.idCounter++);
  },
  com: function (attr) {
    this.send('COM', attr);
  },
  ignore: function (attr) {
    if (attr.ihash)
      attr.ihash = attr.ihash.slice(4) + attr.ihash.slice(0, 4);
    this.send('IG', attr);
  },
  set: function (attr) {
    var resend, i;
    if (config.scalable) {
      ['x', 'y'].forEach(key => {
        if (key in attr && (config.monaArea[key][i = 0] > +attr[key] || config.monaArea[key][i = 1] < +attr[key])) {
          resend = true;
          config.monaArea[key][i] = +attr[key];
        }
      });
      if (resend)
        Object.keys(this.users).forEach(key => {
          const attr = {};
          ['x', 'y', 'scl'].forEach(k => attr[k] = this.users[key][k]);
          attr.id = key;
          this.listener('SET', attr);
        });
    }
    this.send('SET', Object.assign(this.setInfo, attr));
  },
  enter: function (attr) {
    this.users = {};
    attr.room = '/' + (this.roomInfo.n = attr.room.split('/').pop());
    if (!attr.name)
      attr.name = '';
    if (!attr.trip)
      attr.trip = '';
    if (this.socket) {
      if (attr.attrib) {
        if (/^\/\d+$/.test(this.lastRoom))
          this.send('EXIT', {});
        return;
      } else {
        this.setInfo = {x: attr.x, y: attr.y, scl: attr.scl, stat: attr.stat};
      }
    } else {
      this.socket = io(config.astralURL, {path: config.astralPath, withCredentials: true, reconnectionDelay: 200, closeOnBeforeunload: false});
      this.socket.onAny(this.listener.bind(this));
      this.socket.on('disconnect', reason => {
        console.log('☆ω切断');
        this.ondata('COM', {id: 1, cmt: 'サーバーから切断された'});
        if (this.onclose)
          this.onclose();
      });
      this.socket.on('connect', () => {
        console.log('☆ω接続');
        this.buffer.forEach(data => {
          this.send(...data);
        });
        this.buffer.length = 0;
      });
    }
    this.lastRoom = attr.room;
    this.send('ENTER', attr);
  },
  close: function () {
    if (this.socket)
      this.socket.close();
    if (this.onclose)
      this.onclose();
  },
  listener: function (eventName, obj) {
    log('←☆ω:' + JSON.stringify([eventName, obj]));
    const addUser = (user, monaId) => {
      const userCache = this.users[user.id] = {};
      user.ihash = user.ihash ? user.ihash.slice(6) + user.ihash.slice(0, 6) : getihash(user.id);
      if (!user.trip)
        delete user.trip;
      user.id = monaId;
      Object.assign(userCache, user);
      convertPosition(config.astralArea, config.monaArea, user);
    };
    switch (eventName) {
      case 'AUTH':
        this.token = obj.token;
        this.idCache[obj.id] = this.id;
        return;
      case 'COUNT':
        var roomsTable = {};
        for (var n = 1; n <= 20; n++)
          roomsTable[n] = {n, c: 0};
        obj.rooms.forEach(room => roomsTable[room.n] = {n: room.n.slice(1), c: room.c});
        obj.rooms = Object.values(roomsTable);
        break;
      case 'USER':
        if (Object.keys(this.users).length) {
          var tmp = {};
          obj.forEach(user => {
            tmp[user.id] = user;
            if (!this.users[user.id])
              this.listener('ENTER', user);
          });
          for (var id in this.users)
            if (!tmp[id])
              this.listener('EXIT', {id});
          return;
        } else {
          obj = obj.filter(user => {
            var monaId = this.getMonaId(user.id);
            if (monaId === this.id)
              return false;
            addUser(user, monaId);
            return true;
          });
          this.roomInfo.c = obj.length;
        }
        break;
      case 'ENTER':
        var monaId = this.getMonaId(obj.id);
        if (this.users[obj.id]) {
          this.roomInfo.c--;
          this.ondata('EXIT', {id: monaId});
        }
        addUser(obj, monaId);
        this.roomInfo.c++;
        break;
      case 'EXIT':
        delete this.users[obj.id];
        obj.id = this.getMonaId(obj.id);
        this.roomInfo.c--;
        break;
      case 'SLEEP':
      case 'AWAKE':
        return;
      case 'SET':
        var user = this.users[obj.id];
        obj.id = this.getMonaId(obj.id);
        if (user) {
          if (user.stat === obj.stat)
            delete obj.stat;
          Object.assign(user, obj);
        }
        convertPosition(config.astralArea, config.monaArea, obj);
        break;
      case 'COM':
        obj.id = this.getMonaId(obj.id);
        break;
      case 'IG':
        obj.id = this.getMonaId(obj.id);
        if (obj.ihash)
          obj.ihash = obj.ihash.slice(6) + obj.ihash.slice(0, 6);
        break;
    }
    this.ondata(eventName, obj);
  }
});

const demonaTable = {
  '#t' : '\t',
  '#r' : '\r',
  '#n' : '\n',
  '#c' : ',',
  '#e' : '=',
  '#p' : '%',
  '#a' : '&',
  '#g' : '>',
  '#l' : '<',
  '#d' : "'",
  '#q' : '"',
  '#s' : '#'
};
const parseMona = function (xml) {
  var m = xml.match(/^<(\S+)(.+)\s*\/>$/);
  if (!m)
    return;
  var o = {type: m[1], attr: {}};
  m[2].replace(/\s*([^=]+)="([^"]*)"/g, ($0, $1, $2) => (o.attr[$1] = $2 && $2.replace(/&#(\d+);/g, (s, s1) => String.fromCharCode(s1))), '');
  ['cmt', 'name', 'trip'].forEach(key => {
    if (typeof o.attr[key] === 'string')
      o.attr[key] = o.attr[key].replace(/#./g, s => demonaTable[s] || s);
  });
  return o;
};
const toXML = function (tagName, attr) {
  attr = Object.assign({}, attr);
  Object.keys(config.max).forEach(key => {
    if (typeof attr[key] === 'string')
      attr[key] = attr[key].slice(0, config.max[key]);
  });
  ['cmt', 'name'].forEach(key => {
    if (typeof attr[key] === 'string')
      attr[key] = attr[key].replace(/#/g, '#s');
  });
  if (typeof attr.type === 'string')
    attr.type = attr.type.replace(/[\.\/]/g, '');
  return '<' + tagName + ' ' + Object.keys(attr).map(key => key + '="' + ('' + attr[key]).replace(/[<>"&]/g, s => '&#' + s.charCodeAt(0) + ';') + '"').join(' ') + '/>';
};

const server = net.createServer(async function (socket) {
  log('accept');
  socket.setEncoding('utf8');
  var closed, astralClient;
  const onclose = function (event) {
    if (!closed) {
      closed = true;
      log('クライアント切断\n' + event);
      socket.destroy();
      if (astralClient)
        astralClient.close();
    }
  };
  socket.on('close', onclose);
  socket.on('error', onclose);
  const sendToMona = function (text) {
    if (socket.readyState !== 'open') {
      log('クライアントに送信失敗');
      return;
    }
    queueMicrotask(() => log('クライアント←:' + text));
    socket.write(text + '\0');
  };
  const ondata = data => {
    switch (data) {
      case '<policy-file-request/>':
        sendToMona('<cross-domain-policy><allow-access-from domain="monachat.dyndns.org" to-ports="' + config.monaPort + '"/></cross-domain-policy>');
      case '<NOP />':
        return;
      case 'MojaChat':
        astralClient = new AstralClient();
        astralClient.onclose = onclose;
        astralClient.ondata = function (type, obj) {
          switch (type) {
            case 'COUNT':
              sendToMona('<COUNT>' + obj.rooms.map(room => toXML('ROOM', room)).join('') + '</COUNT>');
              break;
            case 'USER':
              sendToMona('<ROOM>' + obj.map(user => toXML('USER', user)).join('') + '</ROOM>');
              break;
            case 'ENTER':
              sendToMona(toXML(obj.attrib && obj.id === astralClient.id ? 'UINFO' : 'ENTER', obj));
              sendToMona(toXML('COUNT', astralClient.roomInfo));
              break;
            case 'EXIT':
              sendToMona(toXML('COUNT', astralClient.roomInfo));
            case 'COM':
            case 'SET':
            case 'IG':
              sendToMona(toXML(type, obj));
              break;
          }
        };
        sendToMona('+connect id=' + astralClient.id);
        sendToMona('<CONNECT id="' + astralClient.id + '"/>');
        break;
      default:
        var monaData = parseMona(data);
        if (data) switch (monaData.type) {
          case 'ENTER':
            astralClient.enter(monaData.attr);
            break;
          case 'COM':
            astralClient.com(monaData.attr);
            break;
          case 'SET':
            if (!monaData.attr.cmd) {
              astralClient.set(monaData.attr);
              break;
            }
          case 'IG':
            astralClient.ignore(monaData.attr);
            break;
          default:
            sendToMona(data.replace('/>', ' id="' + astralClient.id + '"/>'));
        }
    }
    log('クライアント→:' + data);
  };
  var buf = '';
  socket.on('data', data => {
    var datas = (buf + data).split('\0');
    buf = datas.pop();
    datas.forEach(ondata);
  });
}).listen(config.monaPort);

