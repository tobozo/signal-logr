var mapElement,
    parent,
    mapOptions,
    map,
    marker,
    circle,
    bounds,
    latLng,
    openMarker,
    lastFix,
    lastState,
    nmeaInfo,
    rawData,
    secondsSinceLastFix = 0,
    totalFixes = 0,
    updateFreq = 1000,
    updateTimer = false,
    timeSinceLastPoll = 0,
    fixPoll = [],
    heatmap,
    heatmapData = [],
    heatmapFiles = {},
    heatmapCount = 0,
    pollReceiving = false,
    lastPoint = false,
    radius = 15,
    filterBefore,
    filterAfter,
    wifiCache = {},
    wifiTimeline = [],
    wifiSort = 'quality',
    wifiName = 'ssid',
    $wifilist = $('.wifi-list'),
    deviceStatus = {
      wifi:null,
      rtlsdr:null,
      gpshat:null,
      gpsdaemon:null
    }
;

var socket = io();

var rad = function(x) {
    return x * Math.PI / 180;
};

var getDistance = function(p1, p2) {
    var R = 6378137; // Earth ^ ^ s mean radius in meter
    var dLat = rad(p2.lat() - p1.lat());
    var dLong = rad(p2.lng() - p1.lng());
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(p1.lat())) * Math.cos(rad(p2.lat())) *
    Math.sin(dLong / 2) * Math.sin(dLong / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    var d = R * c;
    return d; // returns the distance in meter
};


String.prototype.toHHMMSS = function () {
    var sec_num = parseInt(this, 10); // don't forget the second param
    var hours   = Math.floor(sec_num / 3600);
    var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    var seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (10 > hours) {hours   = "0"+hours;}
    if (10 > minutes) {minutes = "0"+minutes;}
    if (10 > seconds) {seconds = "0"+seconds;}
    return hours+':'+minutes+':'+seconds;
}

String.prototype.replaceAll = function(search, replacement) {
    var target = this;
    return target.replace(new RegExp(search, 'g'), replacement);
};


google.maps.event.addDomListener(window, 'load', initializeMap);

var renderIface = function(iface) {
    var wifibar = '<div class="wifi-bar"></div>';
    var $ifacename = $('<div class="iface-name">'+iface[wifiName]+'</div>');
    var $ifacebox = $('<div class="iface-box"></div>')
    var $signalbox = $('<div class="signal-box"></div>');
    var clearfix = '<div style="clear:both"></div>';
    var signalstrength = Math.floor( iface.quality / 20 );
    var encryption_type = 'none';

    $ifacename.appendTo($ifacebox);

    for(var i=5;i>0;i--) {
        if(signalstrength>=i) {
            $(wifibar).appendTo($signalbox);
        } else {
            $(wifibar).addClass('off').appendTo($signalbox);
        }
    }

    $signalbox.prependTo($ifacebox);

    $ifacebox.css({
        "background-image": "linear-gradient(to right, lightgreen, rgba(125,0,0,0.5) "+ ( iface.quality - 1) + "%, transparent " + iface.quality + "%)"
    });

    if (iface.encryption_wep) {
        encryption_type = 'wep';
    } else if (iface.encryption_wpa && iface.encryption_wpa2) {
        encryption_type = 'wpa-wpa2';
    } else if (iface.encryption_wpa) {
        encryption_type = 'wpa';
    } else if (iface.encryption_wpa2) {
        encryption_type = 'wpa2';
    }

    $ifacename.attr('data-encryption-type', encryption_type);
    $ifacebox.attr('data-iface-addr', iface.address);
    $ifacebox.appendTo($wifilist);
    $(clearfix).appendTo($ifacebox);
}


var renderWifiCache = function(data) {
    var ifaceList = Object.keys(data).sort(function(a,b){return data[b][wifiSort]-data[a][wifiSort]});
    wifiCache = data;
    $wifilist.empty();
    // console.log(ifaceList);
    ifaceList.forEach(function(iface) {
      renderIface(wifiCache[iface]);
    });
    $wifilist.attr('data-iface-size', ifaceList.length);
    updateWifi(wifiCache);
}


socket.on('reload', function() { location.reload(); });
socket.on('device-status', function(data) {
  
  if(data.wirelessisrunning != deviceStatus.wifi) {
    deviceStatus.wifi = data.wirelessisrunning;
    if(deviceStatus.wifi) {
      $('.device-wifi').removeClass('disabled')
      $('.wifi-item').show();
    } else {
      $('.device-wifi').addClass('disabled');
      $('.wifi-item').hide();
    }
  }
  if(data.gpsdaemonisrunning != deviceStatus.gpsdaemon) {
    deviceStatus.gpsdaemon = data.gpsdaemonisrunning;
    if(deviceStatus.gpsdaemon)
      $('.device-gpsdaemon').removeClass('disabled') 
    else
      $('.device-gpsdaemon').addClass('disabled');
  }
  if(data.rtlsdrisrunning != deviceStatus.rtlsdr) {
    deviceStatus.rtlsdr = data.rtlsdrisrunning;
    if(deviceStatus.rtlsdr) {
      $('.device-rtlsdr').removeClass('disabled')
      $('.wifi-item').hide();
    } else {
      $('.device-rtlsdr').addClass('disabled');
      $('.wifi-item').show();
    }
  }
  if(data.gpshatisrunning != deviceStatus.gpshat) {
    deviceStatus.gpshat = data.gpshatisrunning;
    if(deviceStatus.gpshat)
      $('.device-gpshat').removeClass('disabled')
    else
      $('.device-gpshat').addClass('disabled');
  }

});

socket.on('wificache', renderWifiCache);

socket.on('wifi', function(data) {
    var event = Object.keys(data)[0];
    var wifi = data[event];
    switch(event) {
      case 'vanish':
        if(wifiCache[wifi.address]!==undefined) {
          delete(wifiCache[wifi.address]);
        }
      break;
      case 'appear':
      case 'change':
        wifiCache[wifi.address] = wifi;
      break;
    }
    renderWifiCache(wifiCache);
    //console.log('wifi', event, wifi.ssid, wifi.address, Object.keys(wifiCache).length);
});


socket.on('state', function(state) {
    //console.log('state', state);
    updateSatellite(state);
    updateTable(state);
    updateMap(state);
});


socket.on('pollsize', function(data) {
    $('#pollsize').attr("data-poll-currentsize", data);
});


socket.on('pollfiles', function(data) {
    data.forEach(function(file) {
        if(heatmapFiles[file]!==undefined) return;

        stringDate = file.replaceAll("_", ":").replace(":000Z.json", ".000Z");
        propDate = new Date( stringDate ).getTime();
        if(!isNaN(filterBefore) && propDate > filterBefore ) return;
        if(!isNaN(filterAfter)  && filterAfter > propDate ) return;

        heatmapFiles[file] = [];
    });
    setOnePoll();
});


socket.on('pollfile', function(data) {
    var progress = 0;

    if(heatmapFiles[data.filename]!==undefined && heatmapFiles[data.filename].length>0) return;

    if(data.content===undefined) {
        data.content = [];
    }

    data.content.forEach(function(obj, index) {
        if(obj.wifilist!==undefined) {
          //console.log(obj.wifilist);
          //throw('bah');
          return; // skip wifilist
        }
        if(obj.lat===null || obj.lon===null) return; // exclude null coords
        if(0- -(obj.lat).toFixed(4)===0 || 0- -(obj.lon).toFixed(4)===0) return; // exclude zero coords
        var thisPoint = new google.maps.LatLng(obj.lat, obj.lon);
        var distance = 0;
        var objTime = new Date(obj.time).getTime();
        if(lastPoint!==false) {
            lastObject = obj;
            distance = google.maps.geometry.spherical.computeDistanceBetween( thisPoint, lastPoint );
            if( radius > distance ) {
            return;
            }
            if(!isNaN(filterBefore) && objTime > filterBefore ) return;
            if(!isNaN(filterAfter)  && filterAfter > objTime ) return;
        }
        lastPoint = thisPoint;
        heatmapData.push(new google.maps.LatLng(obj.lat, obj.lon));
        bounds.extend(thisPoint);
    });

    heatmapFiles[data.filename] = data.content;
    heatmapCount++;

    if(data.error) {
        console.log('ignoring invalid data for', data.filename);
        delete(heatmapFiles[data.filename]);
    }

    progress = Math.floor( (heatmapCount / Object.keys(heatmapFiles).length) * 100 );

    $('#pollsize').css('background-image', 'linear-gradient(to right, lightgray, rgba(0,0,0,0.5) '+(progress-1)+'%, transparent '+progress+'%)')
                .attr('data-pollsize', heatmapData.length);

    if(progress===100) {
        if(heatmapData.length>0) {
            $('.button-control-heatmap').prop("disabled", false);
            $('#pollsize').prop('disabled', true).css('background-image', '');
            map.fitBounds(bounds);
            initHeatmap();
        }
    } else {
        setOnePoll();
    }
});

//Width and height
var width = 500;
var barHeight = 100;
var padding = 1;
var paddingGPS = 4;

var dataset = [];

//Create SVG element for satellites
var svg = d3.select(".dataviz .satellites")
        .append("svg")
        .attr("width", width)
        .attr("height", barHeight + 50)
        .append("g");


var svgWifi = d3.select(".dataviz .wifi")
        .append("svg")
        .attr("width", width)
        .attr("height", barHeight)
        .append("g");

function updateWifi(obj) {
    var data = [];
    var keys = Object.keys(obj);
    var rect;

    // turn incoming object into an array
    keys.forEach(function(iface){ data.push(obj[iface]); });

    rect = svgWifi.selectAll("rect").data(data);

    rect.enter().append("rect");
    rect.attr("x", function(d, i) {
      return i * (width / data.length);
    }).attr("y", function(d) {
      var v = d.quality || 10;
      return barHeight - (v * 1);
    }).attr("width", width / data.length - padding).attr("height", function(d) {
      var v = d.quality || 10;
      return v * 4;
    }).attr("fill", function(d) {
      var v = 255 + d.strength*2 || 0;
      if (d.strength<-67) {
        return "rgb(0, 0, " + (v * 1 | 0) + ")";
      }
      return "rgb(" + (v * 1 | 0) + ", 0, 0)";
    });
    rect.exit().remove();
}

function updateSatellite(data) {

    var rect = svg.selectAll("rect").data(data.satsVisible);
    var text = svg.selectAll("text").data(data.satsVisible);
    rect.enter().append("rect");
    rect.enter().append("text");
    rect.attr("x", function(d, i) {
      return i * (width / data.satsVisible.length);
    }).attr("y", function(d) {
      var v = d.snr || 10;
      return barHeight - (v * 2);
    }).attr("width", width / data.satsVisible.length - paddingGPS).attr("height", function(d) {
      var v = d.snr || 10;
      return v * 2;
    }).attr("fill", function(d) {
      var v = d.snr || 10;
      if (-1 !== data.satsActive.indexOf(d.prn)) {
        return "rgb(0, 0, " + (v * 10 | 0) + ")";
      }
      return "rgb(" + (v * 10 | 0) + ", 0, 0)";
    });
    text.attr("x", function(d, i) {
      return 15 + i * (width / data.satsVisible.length);
    }).attr("y", barHeight + 20).text(function(d) {
      return d.prn;
    }).attr("fill", "black");
    rect.exit().remove();
    text.exit().remove();
}


function updateTable(state) {
    lastState = state;
    $("#date").text(state.time);
    $("#lat").text(state.lat);
    $("#lon").text(state.lon);
    $("#alt").text(state.alt);
    $("#speed").text(state.speed);
    $("#status").text(state.fix);
    $("#pdop").text(state.pdop);
    $("#vdop").text(state.vdop);
    $("#hdop").text(state.hdop);
    $("#active").text(state.satsActive.length);
    $("#view").text(state.satsVisible.length);
}


function updateMap(state) {
    if(state.lat===undefined ||  state.lon===undefined) return;
    if(state.lat===null ||  state.lon===null) return;
    if(google===undefined) return;
    if(google.maps===undefined) return;
    if(map==undefined) return;
    if(state.fix=='2D' || state.fix=='3D') {
        // do not overload UI + localStorage
        if(updateTimer) return;
        updateTimer = setTimeout(function() {
            updateTimer = false;
        }, updateFreq);

        if(state.hdop!== undefined && state.pdop!==undefined) {
            if(state.hdop>50 || state.pdop>50) return;
            if(2>state.hdop || 2>state.pdop) return;
            circle.setRadius( Math.sqrt(state.hdop*state.pdop) *10 );
        }

        localStorage.setItem('lastFix', JSON.stringify(state));

        setPoll(lastFix);

        lastFix = state;
        totalFixes++;

        $('#fix-progress').trigger('reset');

        latLng = new google.maps.LatLng(state.lat, state.lon);

        marker.setPosition(latLng);
        circle.setCenter(latLng);
        map.setCenter(latLng);
    }
}


function initializeMap() {

    $fixProgress = $('#fix-progress');
    $secondsSinceLastFix = $('#secondsSinceLastFix');
    $totalFixes = $('#totalFixes');
    $pollisze = $('#pollsize');

    lastFix = JSON.parse(localStorage.getItem('lastFix'));

    if(lastFix===null) {
        latLng = new google.maps.LatLng(48.8, 2.3);
    } else {
        latLng = new google.maps.LatLng(lastFix.lat, lastFix.lon);
    }

    mapElement = document.getElementById('mapid');

    mapOptions = {
        center: latLng,
        zoom: 14,
        mapTypeId: google.maps.MapTypeId.ROADMAP
    };
    map = new google.maps.Map(mapElement, mapOptions)
    bounds = new google.maps.LatLngBounds();
    marker = new google.maps.Marker({position: latLng, map: map});
    circle = new google.maps.Circle({
        strokeColor: '#FF0000',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#FF0000',
        fillOpacity: 0.35,
        map: map,
        center: latLng,
        radius: 100
    });

    $('#focus-lastfix').on('click', function() {
        latLng = new google.maps.LatLng( document.getElementById('lat').innerHTML, document.getElementById('lon').innerHTML );
        map.setCenter(latLng);
        marker.setPosition(latLng);
        circle.setCenter(latLng);
    });

    $('#reload-ws').on('click', function() {
        $(this).attr('disabled', true);
        socket.emit('reload', "blah");
        setTimeout(function() {
            top.location = top.location
        }, 10000);
    });
    
    
    $('.device-gpsdaemon').on('click', function() {
      if(deviceStatus.gpsdaemon===true) {
        socket.emit('gpsdaemonstop');
      } else {
        socket.emit('gpsdaemonstart');
      }
    });
    $('.device-gpshat').on('click', function() {
      if(deviceStatus.gpshat===true) {
        socket.emit('gpsdisable');
      } else {
        socket.emit('gpsenable');
      }
    });
    $('.device-rtlsdr').on('click', function() {
      if(deviceStatus.rtlsdr===true) {
        socket.emit('rtlsdrdisable');
      } else {
        socket.emit('rtlsdrenable');
      }
    });
    $('.device-wifi').on('click', function() {
      if(deviceStatus.wifi===true) {
        socket.emit('wifidisable');
      } else {
        socket.emit('wifienable');
      }
    });    

    $fixProgress.on('reset', function() {
        $fixProgress.val(60);
        $totalFixes.text(totalFixes);
        secondsSinceLastFix = 0;
        $secondsSinceLastFix.text('00:00:01');
    });

    setInterval(function() {
      var fixVal = 0- -$fixProgress.val();
      secondsSinceLastFix++;
      timeSinceLastPoll++;
      $secondsSinceLastFix.text( (""+secondsSinceLastFix).toHHMMSS() );
      if(fixVal==0) return;
      $fixProgress.val(fixVal-1);
    }, 1000);

    setWifiSort();
}


function setPoll() {
    fixPoll.push(lastFix);
    // save every minute or every 100 records
    if(fixPoll.length>100 || timeSinceLastPoll > 60) {
        // save
        socket.emit('setpoll', fixPoll);
        // purge
        fixPoll = [];
        timeSinceLastPoll = 0;
        return;
    }
}


function togglePollFiles() {
    if(pollReceiving===true) {
        stopPollFiles();
    } else {
        getPollFiles();
    }
}


function getPollFiles() {
    pollReceiving = true;
    $('#pollsize').attr('data-label', 'Stop retrieving files');
    radius = 0- -$('#radius').val();
    filterBeforeString = $('#date-filter-before').val().replace(" ", "") + ".000Z";
    filterAfterString  = $('#date-filter-after').val().replace(" ", "") + ".000Z";

    filterBefore = new Date( filterBeforeString ).getTime();
    filterAfter  = new Date(  filterAfterString ).getTime();
    $('.button-control-heatmap').prop("disabled", true);
    socket.emit('poll-files', {blah:true});
}


function stopPollFiles() {
    pollReceiving = false;
    $('.button-control-heatmap').prop("disabled", false);
    $('#pollsize').attr('data-label', 'Start retrieving files');
    if(heatmapData.length>0) {
        $('#initheatmap-button').css('display', 'inline-block');
    } else {
        $('#initheatmap-button').css('display', 'none');
    }
}


function setOnePoll() {
    //var propDate;
    //var stringDate;
    if(pollReceiving!==true) return;
    for(prop in heatmapFiles) {
        if(!prop.match(/^[0-9]{4}-[0-9]{2}-[0-9]{2}/)) continue;
        if(heatmapFiles[prop].length===0) {
            socket.emit('poll-content', prop);
            return;
        }
    }
}

function toggleHeatmap() {
    heatmap.setMap(heatmap.getMap() ? null : map);
}

function changeGradient() {
    var gradient = [
        'rgba(0, 255, 255, 0)',
        'rgba(0, 255, 255, 1)',
        'rgba(0, 191, 255, 1)',
        'rgba(0, 127, 255, 1)',
        'rgba(0, 63, 255, 1)',
        'rgba(0, 0, 255, 1)',
        'rgba(0, 0, 223, 1)',
        'rgba(0, 0, 191, 1)',
        'rgba(0, 0, 159, 1)',
        'rgba(0, 0, 127, 1)',
        'rgba(63, 0, 91, 1)',
        'rgba(127, 0, 63, 1)',
        'rgba(191, 0, 31, 1)',
        'rgba(255, 0, 0, 1)'
    ];
    heatmap.set('gradient', heatmap.get('gradient') ? null : gradient);
}


function changeRadius() {
    heatmap.set('radius', heatmap.get('radius') ? null : 20);
}


function changeHeatmapOpacity() {
    heatmap.set('opacity', heatmap.get('opacity') ? null : 0.2);
}


function changecircleOpacity() {
    circle.setVisible(!circle.getVisible());
}


function getPoints() {
    return heatmapData;
}

function setWifiSort() {
    wifiSort = $('#wifi-sort-by').val();
    socket.emit('wifi-cache', "blah");
}

function setWifiName() {
    wifiName = $('#wifi-named-by').val();
    socket.emit('wifi-cache', 'blah');
}

function initHeatmap() {
    heatmap = new google.maps.visualization.HeatmapLayer({
        data: getPoints(),
        map: map
    });
    $('#initheatmap-button').prop('disabled', true);
    circle.setVisible(false);
}

$(function() {
    $( 'input[type="datetime"]').datetimepicker({dateFormat:"yy-mm-ddT", timeFormat:"HH:mm:ss"}); 
});


