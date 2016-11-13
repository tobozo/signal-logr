/*

  RPi-GPS-Wifi logger
  (c+) tobozo 2016-11-13

 */

require('dotenv').config();

// load app stack
var app = require('express')()
  , http = require('http').Server(app)
  , io = require('socket.io')(http)
  , gpsd = require("node-gpsd")
  , GPS = require('gps')
  , exec = require('child_process').exec
  , execSync = require("child_process").execSync
  , jsonfile = require('jsonfile')
  , fs = require('fs')
  , Wireless = require('wireless')
  , os = require('os')
;

// throw some vars
var connected = false
  , killing_app = false
  , oldalias = 0
  , secondsSinceLastPoll = 0
  , fixPoll = []
  , lastFix
  , currentFix
  , secondsSinceLastFix = 0
  , dataDir = __dirname + '/data'
  , geoDataDir = dataDir + '/gps/'
  , wifiDataDir = dataDir + '/wifi/'
  , htmlDir =  __dirname + '/www'
  , pollFiles = []
  , wifiFiles = []
  , wifiMaxHistoryItems = 100
  , googleMapsApiKey = process.env.apiKey
  , wifiCache = { }
  , gpstime = new Date()
;


if(googleMapsApiKey===undefined) console.log("[WARN] Missing apiKey in .env file, GUI may suffer");


var wireless = new Wireless({
    iface: 'wlan0',
    updateFrequency: 10, // Optional, seconds to scan for networks
    connectionSpyFrequency: 2, // Optional, seconds to scan if connected
    vanishThreshold: 5 // Optional, how many scans before network considered gone
});


var gps = new GPS;


var listener = new gpsd.Listener({
    port: 2947,
    hostname: 'localhost',
    emitraw: true,
    parsejson: false,
    logger:  {
        info: function() {},
        warn: console.warn,
        error: console.error
    },
    parse: false
});


var mkdirSync = function (path) {
  try {
    fs.mkdirSync(path);
  } catch(e) {
    if ( e.code != 'EEXIST' ) throw e;
  }
}


var checkInterfaces = function() {
  var ifaces = os.networkInterfaces();
  var alias = 0;
  Object.keys(ifaces).forEach(function (ifname) {
    alias = 0;

    ifaces[ifname].forEach(function (iface) {

      if ('IPv4' !== iface.family || iface.internal !== false) {
        // skip over internal (i.e. 127.0.0.1) and non-ipv4 addresses
        return;
      }

      if (alias >= 1) {
        // this single interface has multiple ipv4 addresses
        //console.log(ifname + ':' + alias, iface.address);
      } else {
        // this interface has only one ipv4 adress
        //console.log(ifname, iface.address);
      }
      ++alias;
    });
  });

  if(alias==0) {
    console.log('no eth0: headless mode');
  } else {
    if(oldalias!==0 && oldalias!==alias) {
      console.log('network changed, restarting nodejs app');
      process.exit(0);
    }
  }
  oldalias = alias;
};


var setPoll = function() {
  secondsSinceLastFix++;
  secondsSinceLastPoll++;
  if(fixPoll.length === 0) {
    return;
  }
  if(fixPoll.length>=100 || secondsSinceLastPoll>=60) {
    savePoll();
    secondsSinceLastPoll = 0;
  }
};


var setFix = function() {
  if(lastFix===undefined) {
    // not started yet
    return;
  }
  if(currentFix===undefined) {
    // setting initial currentFix
    currentFix = lastFix;
    fixPoll.push(lastFix);
    return;
  }
  if(currentFix.time === lastFix.time) return; // don't create duplicates
  fixPoll.push(lastFix);
  currentFix = lastFix;
}


var savePoll = function() {
  if(fixPoll.length===0) {
    // can't save empty poll!
    return;
  }

  var fileName = geoDataDir + fixPoll[0].time.replace(/[^a-z0-9-]+/gi, '_') + '.json';
  var wifilist = {};
  try {
    wifilist = wireless.list();
  } catch(e) {
    console.log('cannot save wifilist', e);
  }

  jsonfile.writeFile(fileName, fixPoll, {spaces: 2}, function(err) {
    if(err) console.error(err);
    resetPoll();
    refreshPollInventory();
  });

}


var resetPoll = function() {
  fixPoll = [];
}


var refreshPollInventory = function() {
  fs.readdir(geoDataDir, function(err, files) {
    if(err) {
      console.log('failed to get dir', geoDataDir, err);
      return;
    }
    if(files.length===0) {
      // geodatadir is empty!
      return;
    }
    pollFiles = JSON.parse(JSON.stringify(files));
    io.emit('pollsize', pollFiles.length);
  });
}


var sendPollInventory = function() {
  fs.readdir(geoDataDir, function(err, files) {
    if(err) {
      console.log('failed to get dir', geoDataDir, err);
      return;
    }
    if(files.length===0) {
      // geodatadir is empty!
      return;
    }
    pollFiles = JSON.parse(JSON.stringify(files));
    io.emit('pollfiles', files);
  });
}

var sendPollContent = function(fileName) {
  var pollName = false;
  // console.log('got poll content request', fileName);
  pollFiles.forEach(function(tmpFileName) {
    if(fileName === tmpFileName) {
      pollName = fileName;
    }
  });
  if(pollName===false) return;
  jsonfile.readFile(geoDataDir + pollName, function(err, obj) {
    if(err) {
      console.log(err);
      io.emit('pollfile', {filename:pollName, error: JSON.stringify(err)});
      return;
    }
    io.emit('pollfile', {filename:pollName, content: obj});
  });
}


var sendWifiCache = function() {
  io.emit('wificache', wifiCache);
}

var setWifiCache = function() {
  if(Object.keys(wifiCache).length ===0) return;
  sendWifiCache();
}


var saveWifi = function(wifi, event) {
  var fileName = wifiDataDir + wifi.address.replace(/[^a-z0-9-]+/gi, '_') + '.json';

  jsonfile.readFile(fileName, function(err, obj) {

    if(obj===undefined || (err!==null && err.code==="ENOENT")) {
      // console.log('new wifi device');
      obj = {};
      obj.iface = wifi;
      obj.events = [];
    }

    // prevent database explosion
    if(obj.events.length > wifiMaxHistoryItems) {
      while(obj.events.length > wifiMaxHistoryItems) {
        obj.events.pop();
      }
    }

    obj.events.unshift([gpstime, event, wifi.channel, wifi.quality, wifi.strength]);

    jsonfile.writeFile(fileName, obj, {spaces:0}, function(err, obj) {
      if(err) console.error(err);
    });

  });
}



var sendWifiInventory = function() {
  fs.readdir(wifiDataDir, function(err, files) {
    if(err) {
      console.log('failed to get dir', geoDataDir, err);
      return;
    }
    if(files.length===0) {
      // wifidatadir is empty!
      return;
    }
    wifiFiles = JSON.parse(JSON.stringify(files));
    io.emit('wififiles', files);
  });
}


var sendWifiContent = function(fileName) {
  var wifiName = false;
  // console.log('got wifi content request', fileName);
  wifiFiles.forEach(function(tmpFileName) {
    if(fileName === tmpFileName) {
      wifiName = fileName;
    }
  });
  if(wifiName===false) return;
  jsonfile.readFile(wifiDataDir + wifiName, function(err, obj) {
    if(err) {
      console.log(err);
      io.emit('wififile', {filename:wifiName, error: JSON.stringify(err)});
      return;
    }
    io.emit('wififile', {filename:wifiName, content: obj});
  });
}


mkdirSync( dataDir );
mkdirSync( geoDataDir );
mkdirSync( wifiDataDir);

setInterval(checkInterfaces, 20000); // check for network change every 20 sec
setInterval(setPoll, 1000);
setInterval(setFix, 1000);
setInterval(setWifiCache, 61000); // force wifi cache reload every minute


listener.connect(function() {
    console.log('[INFO] Connected and Listening to GPSD');
});


listener.watch({class: 'WATCH', nmea: true});

// tell express to use ejs for rendering HTML files:
app.set('views', htmlDir);
app.engine('html', require('ejs').renderFile);

// feed the dashboard with the apiKey
app.get('/', function(req, res) {
  res.render('dashboard.html', {
    apiKey: googleMapsApiKey
  });
});

app.get('/jquery-ui-timepicker-addon.js', function(req, res) {
  res.sendFile(htmlDir + '/jquery-ui-timepicker-addon.js');
});

app.get('/dashboard.js', function(req, res) {
  res.sendFile(htmlDir + '/dashboard.js');
});


http.listen(3000, function() {
  console.log('[INFO] Web Server GUI listening on *:3000');

  gps.on('data', function() {
    io.emit('state', gps.state);
    if(gps.state.fix && gps.state.fix==='3D') {
      if(gps.state.lat===0 || gps.state.lat===null) return;
      if(gps.state.lon===0 || gps.state.lon===null) return;
      lastFix = JSON.parse(JSON.stringify(gps.state));
      secondsSinceLastFix = 0;
    }
    if(gps.time) {
      gpstime = new Date(gps.time);
    }
  });


  listener.on('raw', function(data) {
    try {
      gps.update(data);
    } catch(e) {
      console.log('invalid data');
      console.log(data)
      console.dir(e);
    }
  });


  io.sockets.on('connection', function (socket) {

    //socket.on('sms', function(data) {
    //  console.log('received event sms', data);
    //  var gammu = "/usr/bin/sudo";
    //  var destination = "0606060606";
    //  var cmdargs = '';
    //  cmdargs = ' /usr/bin/gammu-smsd-inject TEXT ' + destination + ' -text "'+data.msg+'"';
    //  console.log(gammu+cmdargs);
    //  execSync([gammu+cmdargs]);
    //});

    socket.on('reload', function(data) {
      // foreferjs
      process.exit(0);
    });

    socket.on('poll-files', sendPollInventory);
    socket.on('poll-content', sendPollContent);
    socket.on('wifi-cache', sendWifiCache);

  });


  wireless.enable(function(err) {
    if (err) {
        console.log("[FAILURE] Unable to enable wireless card. Quitting...");
        return;
    }

    console.log("[INFO] Wireless card enabled.");
    console.log("[INFO] Starting wireless scan...");

    wireless.start();

  });

});


// Found a new network
wireless.on('appear', function(network) {
    var quality = Math.floor(network.quality / 70 * 100);

    network.ssid = network.ssid || '[HIDDEN]';

    network.encryption_type = 'NONE';
    if (network.encryption_wep) {
        network.encryption_type = 'WEP';
    } else if (network.encryption_wpa && network.encryption_wpa2) {
        network.encryption_type = 'WPA-WPA2';
    } else if (network.encryption_wpa) {
        network.encryption_type = 'WPA';
    } else if (network.encryption_wpa2) {
        network.encryption_type = 'WPA2';
    }
    io.emit('wifi', {appear:network});
    wifiCache[network.address] = network;
    //console.log("[  APPEAR] " + network.ssid + " [" + network.address + "] " + quality + "% " + network.strength + "dBm " + network.encryption_type);
    saveWifi(network, 'appear');
});

wireless.on('change', function(network) {
    var quality = Math.floor(network.quality / 70 * 100);

    network.ssid = network.ssid || '[HIDDEN]';

    network.encryption_type = 'NONE';
    if (network.encryption_wep) {
        network.encryption_type = 'WEP';
    } else if (network.encryption_wpa && network.encryption_wpa2) {
        network.encryption_type = 'WPA-WPA2';
    } else if (network.encryption_wpa) {
        network.encryption_type = 'WPA';
    } else if (network.encryption_wpa2) {
        network.encryption_type = 'WPA2';
    }
    io.emit('wifi', {appear:network});
    wifiCache[network.address] = network;
    //console.log("[  APPEAR] " + network.ssid + " [" + network.address + "] " + quality + "% " + network.strength + "dBm " + network.encryption_type);
    saveWifi(network, 'change');
});


// A network disappeared (after the specified threshold)
wireless.on('vanish', function(network) {
    io.emit('wifi', {vanish:network});
    if(wifiCache[network.address]!==undefined) {
      delete(wifiCache[network.address]);
    }
    //console.log("[  VANISH] " + network.ssid + " [" + network.address + "] ");
    saveWifi(network, 'vanish');
});

wireless.on('error', function(message) {
    // io.emit('wifi', {error:network});
    console.log("[ERROR] Wifi / " + message);
});


// User hit Ctrl + C
process.on('SIGINT', function() {
    console.log("\n");

    if (killing_app) {
        console.log("[INFO] Double SIGINT, Killing without cleanup!");
        process.exit();
    }

    killing_app = true;
    console.log("[INFO] Gracefully shutting down from SIGINT (Ctrl+C)");
    console.log("[INFO] Disabling Wifi Adapter...");

    wireless.disable(function() {
        console.log("[INFO] Stopping Wifi and Exiting...");

        wireless.stop();
    });
});
