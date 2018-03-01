/*

  RPi-GPS-Wifi logger
  (c+) tobozo 2016-11-13

 */

require('dotenv').config();

// load app stack

const express = require('express')
  , app = express()
  , http = require('http').Server(app)
  , request = require('request')
  , io = require('socket.io')(http)
  , gpsd = require("node-gpsd")
  , GPS = require('gps')
  , exec = require('child_process').exec
  , spawn = require('child_process').spawn
  , execSync = require("child_process").execSync
  , jsonfile = require('jsonfile')
  , fs = require('fs')
  , Wireless = require('wireless')
  , os = require('os')
  , path = require('path')
;

// throw some vars
let connected = false
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
  , rtlsdrDataDir = htmlDir + '/dump1090'
  , dump1090Dir = '/home/pi/dump1090/'
  , dump1090HTMLDir = dump1090Dir + 'public_html/'
  , dump1090ConfigFile = dump1090HTMLDir + 'config.js'
  , dump1090timer
  , pollFiles = []
  , wifiFiles = []
  , wifiMaxHistoryItems = 100
  , googleMapsApiKey = process.env.apiKey
  , wifiCache = { }
  , gpstime = new Date()
  , gpsdaemonisrunning = true
  , gpshatisrunning = false
  , wirelessisrunning = false
  , rtlsdrisrunning = false
;


if(googleMapsApiKey===undefined) console.log("[WARN] Missing apiKey in .env file, GUI may suffer");

const wireless = new Wireless({
    iface: 'wlan0',
    updateFrequency: 30, // Optional, seconds to scan for networks
    connectionSpyFrequency: 2, // Optional, seconds to scan if connected
    vanishThreshold: 5 // Optional, how many scans before network considered gone
});


const gpsWarn = function(msg) {
  console.log('[WARN] GPSD - ', msg);
}
const gpsErr = function(msg) {
  console.log('[ERROR] GPSD - ', msg);
  gpsdaemonisrunning = false;
}


const gps = new GPS;


const listener = new gpsd.Listener({
    port: 2947,
    hostname: 'localhost',
    emitraw: true,
    parsejson: false,
    logger:  {
        info:  function() {},
        warn:  gpsWarn,
        error: gpsErr
    },
    parse: false
});


const mkdirSync = function (path) {
  try {
    fs.mkdirSync(path);
  } catch(e) {
    if ( e.code != 'EEXIST' ) throw e;
  }
}


const checkInterfaces = function() {
  if(wirelessisrunning===false) return;
  const ifaces = os.networkInterfaces();
  let alias = 0;
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


const setPoll = function() {
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


const setFix = function() {
  if(gpsdaemonisrunning===false) return;
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


const savePoll = function() {
  if(fixPoll.length===0) {
    // can't save empty poll!
    return;
  }

  const fileName = geoDataDir + fixPoll[0].time.replace(/[^a-z0-9-]+/gi, '_') + '.json';
  let wifilist = {};
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


const resetPoll = function() {
  fixPoll = [];
}


const refreshPollInventory = function() {
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


const sendPollInventory = function() {
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

const sendPollContent = function(fileName) {
  let pollName = false;
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


const sendWifiCache = function() {
  io.emit('wificache', wifiCache);
}

const setWifiCache = function() {
  if(wirelessisrunning===false) return;
  if(Object.keys(wifiCache).length ===0) return;
  sendWifiCache();
}


const saveWifi = function(wifi, event) {
  const fileName = wifiDataDir + wifi.address.replace(/[^a-z0-9-]+/gi, '_') + '.json';

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



const sendWifiInventory = function() {
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


const sendWifiContent = function(fileName) {
  let wifiName = false;
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


const wirelessStart = function() {
  if(wirelessisrunning===true) {
    console.log("[INFO] Wireless already started");
    return;
  }
  wireless.enable(function(err) {
    if (err) {
        console.log("[FAILURE] Unable to enable wireless card. Quitting...");
        return;
    }
    console.log("[INFO] Wireless card enabled.");
    console.log("[INFO] Starting wireless scan...");
    wireless.start();
    wirelessisrunning = true;
  });
}


const wirelessStop = function() {
  if(wirelessisrunning===false) {
    console.log("[INFO] Wireless already stopped");
    return;
  }
  wireless.disable(function() {
      console.log("[INFO] Stopping Wifi");
      wireless.stop();
      wirelessisrunning = false;
  });
}



const onChildStdOut = function(data) {
  console.log('[STDOUT]', data.toString());
}
const onChildStdErr = function(data) {
  console.log('[STDOUT]', data.toString());
}
const onChildClose = function(code) {
  console.log("[EOL] Finished with code " + code);
}

const spawnChild = function(cmd, args, opts, onstdout, onstderr, onclose) {
  let child = spawn(cmd, args, opts);
  child.stdout.on('data', onstdout);
  child.stderr.on('data', onstderr);
  child.on('close', onclose);
}

const dump1090JSON = function() {
  // get http://localhost:8080/dump1090/data.json 
  // write locally
  request('http://localhost:8080/dump1090/data.json').pipe(fs.createWriteStream(htmlDir + '/dump1090/data.json'))
}


const startDump1090 = function() {
  //execSync(dump1090Dir + 'dump1090 --net --net-http-port 8080 --quiet &');
  
  spawnChild(dump1090Dir + 'dump1090', ['--net', '--net-http-port', '8080', '--quiet'], {cwd:dump1090Dir}, onChildStdOut, onChildStdErr, function() {
    console.log('[INFO] dump1090 exited Successfully!');
    rtlsdrisrunning = false;
  });
  
  rtlsdrisrunning = true;
  clearInterval( dump1090timer );
  dump1090timer = setInterval( dump1090JSON, 5000);
  
  console.log('[INFO] RTLSDR Device Started Successfully!');
}
const stopDump1090 = function() {
  execSync('sudo killall dump1090'); // yuck
  rtlsdrisrunning = false;
  clearInterval( dump1090timer );
  console.log('[INFO] RTLSDR Device Killed Successfully!');
}


const startGPSDaemon = function() {
  execSync('sudo service gpsd restart');
  console.log('[INFO] GPS Daemon Started Successfully, will restart server');
  process.exit(0);
}
const stopGPSDaemon = function() {
  execSync('sudo service gpsd stop');
  console.log('[INFO] GPS Daemon Stopped Successfully');
  //process.exit(0);
}

const startGPSDevice = function() {
  spawnChild('python', ['scripts/startgps.py'], null, onChildStdOut, onChildStdErr, function() {
    gpsdaemonisrunning = true;
    console.log('[INFO] GPS Device Started Successfully!');
    startGPSDaemon();
  });
}
const stopGPSDevice = function() {
  spawnChild('python', ['scripts/stopgps.py'], null, onChildStdOut, onChildStdErr, function() {
    gpsdaemonisrunning = true;
    console.log('[INFO] GPS Device Stopped Successfully!');
    stopGPSDaemon();
  });
}

const sendDeviceStatus = function() {
  io.emit('device-status', {
     wirelessisrunning:wirelessisrunning,
    gpsdaemonisrunning:gpsdaemonisrunning,
       gpshatisrunning:gpshatisrunning,
       rtlsdrisrunning:rtlsdrisrunning
  });
}


mkdirSync( dataDir );
mkdirSync( geoDataDir );
mkdirSync( wifiDataDir);
mkdirSync( rtlsdrDataDir );

setInterval(checkInterfaces, 20000); // check for network change every 20 sec
setInterval(setPoll, 1000);
setInterval(setFix, 1000);
setInterval(setWifiCache, 61000); // force wifi cache reload every minute
setInterval(sendDeviceStatus, 1000); // send device status every second


listener.connect(function() {
  console.log('[INFO] Connected and Listening to GPSD');
  gpsdaemonisrunning = true;
});


listener.watch({class: 'WATCH', nmea: true});

// tell express to use ejs for rendering HTML files:
app.set('views', htmlDir);
//app.set('views', htmlDir+'/dump1090');
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
app.get('/gmap.html', function(req, res) {
  res.render('gmap.html', {
    host: req.headers.host.replace('3000', '8080'),
    lat: lastFix.lat,
    lon: lastFix.lon
  });
  //res.sendFile(htmlDir + '/gmap.html');
});


app.get('/dump1090/data.json', function(req, res) {
  res.sendFile(htmlDir + '/dump1090/data.json');
});

app.get('/dashboard.js', function(req, res) {
  res.sendFile(htmlDir + '/dashboard.js');
});
app.use(express.static(path.join(__dirname, 'www/img')));

http.listen(3000, function() {
  console.log('[INFO] Web Server GUI listening on *:3000');

  gps.on('data', function() {
    io.emit('state', gps.state);
    //console.log('[state]', gps.state);
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
    gpshatisrunning = true;
    try {
      gps.update(data);
      //console.log('[RAW]', data);
    } catch(e) {
      console.log('invalid data');
      console.log(data)
      console.dir(e);
    }
  });


  io.sockets.on('connection', function (socket) {

    socket.on('gpsenable', function(data) {
      console.log('[INFO] Will enable GPS');
      startGPSDevice();
    });
    socket.on('gpsdisable', function(data) {
      console.log('[INFO] Will disable GPS');
      stopGPSDevice();
    });
    socket.on('gpsdaemonstart', function(data) {
      startGPSDaemon();
    });
    socket.on('gpsdaemonstop', function(data) {
      stopGPSDaemon();
    });
    socket.on('rtlsdrenable', function(data) {
      //stop wifi
      wirelessStop();
      //start dump1090
      startDump1090();
      rtlsdrisrunning = true;
    });
    socket.on('rtlsdrdisable', function(data) {
      //stop dump1090
      stopDump1090();
    });
    socket.on('wifienable', function(data) {
      //stop dump1090
      stopDump1090();
      //start wifi
      wirelessStart();
      rtlsdrisrunning = false;
    });
    socket.on('wifidisable', function(data) {
      wirelessStop();
    });
    
    
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
    socket.on('device-status', sendDeviceStatus);

  });

  setTimeout(function() {
    console.log('will reload web UI');
    io.emit('reload', {go:true});
  }, 2000);


  wirelessStart();

});


// Found a new network
wireless.on('appear', function(network) {
    const quality = Math.floor(network.quality / 70 * 100);

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
    const quality = Math.floor(network.quality / 70 * 100);

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
    wirelessStop();
    /*
    wireless.disable(function() {
        console.log("[INFO] Stopping Wifi");
        wireless.stop();
    });
    */
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

   wirelessStop();
   /*
    wireless.disable(function() {
        console.log("[INFO] Stopping Wifi and Exiting...");

        wireless.stop();
    });
   */
});
