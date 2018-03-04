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
    },
    listKMLType = ['Approch', 'Departure', 'Transit', 'Custom1', 'Custom2'],
    listKMLs = localStorage['listKMLs'] || [],
    Planes        = {},
    PlanesOnMap   = 0,
    PlanesOnTable = 0,
    PlanesToReap  = 0,
    SelectedPlane = null,
    SpecialSquawk = false,
    iSortCol=-1,
    bSortASC=true,
    bDefaultSortASC=true,
    iDefaultSortCol=3,
    Metric = false,
    MarkerColor	  = "rgb(127, 127, 127)",
    SelectedColor = "rgb(225, 225, 225)",
    StaleColor = "rgb(190, 190, 190)",
    SiteShow    = false,
    SiteCircles = true, // true or false (Only shown if SiteShow is true)
    // In nautical miles or km (depending settings value 'Metric')
    SiteCirclesDistances = new Array(100,150,200)
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


socket.on('rtlsdr', function(data) {
  data = JSON.parse(data);
  console.log(data);
  PlanesOnMap = 0
  SpecialSquawk = false;
  
  // Loop through all the planes in the data packet
  for (var j=0; j < data.length; j++) {
      // Do we already have this plane object in Planes?
      // If not make it.
      if (Planes[data[j].hex]) {
          var plane = Planes[data[j].hex];
      } else {
          var plane = jQuery.extend(true, {}, planeObject);
      }
      
      /* For special squawk tests
      if (data[j].hex == '48413x') {
          data[j].squawk = '7700';
      } //*/
      
      // Set SpecialSquawk-value
      if (data[j].squawk == '7500' || data[j].squawk == '7600' || data[j].squawk == '7700') {
          SpecialSquawk = true;
      }

      // Call the function update
      plane.funcUpdateData(data[j]);
      
      // Copy the plane into Planes
      Planes[plane.icao] = plane;
  }

  PlanesOnTable = data.length;
  
  refreshTableInfo();
  refreshSelected();
  reaper();
  
});


socket.on('reload', function() { location.reload(); });


socket.on('device-status', function(data) {
  
  if(data.wirelessisrunning != deviceStatus.wifi) {
    deviceStatus.wifi = data.wirelessisrunning;
    if(deviceStatus.wifi) {
      $('.device-wifi').removeClass('disabled')
      $('.wifi-item').show();
      $('.rtlsdr-wrapper').hide();
      marker.setVisible(true);
    } else {
      $('.device-wifi').addClass('disabled');
      $('.wifi-item').hide();
    }
  }
  if(data.gpsdaemonisrunning != deviceStatus.gpsdaemon) {
    deviceStatus.gpsdaemon = data.gpsdaemonisrunning;
    if(deviceStatus.gpsdaemon)
      $('.device-gpsdaemon').removeClass('disabled');
    else
      $('.device-gpsdaemon').addClass('disabled');
  }
  if(data.rtlsdrisrunning != deviceStatus.rtlsdr) {
    deviceStatus.rtlsdr = data.rtlsdrisrunning;
    if(deviceStatus.rtlsdr) {
      $('.device-rtlsdr').removeClass('disabled')
      $('.wifi-item').hide();
      $('.rtlsdr-wrapper').show();
      marker.setVisible(false);
    } else {
      $('.device-rtlsdr').addClass('disabled');
      $('.wifi-item').show();
      $('.rtlsdr-wrapper').hide();
      marker.setVisible(true);
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
var svgSatellite = d3.select(".dataviz .satellites")
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

    var rect = svgSatellite.selectAll("rect").data(data.satsVisible);
    var text = svgSatellite.selectAll("text").data(data.satsVisible);
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
        
        localStorage['CenterLat'] = state.lat;
        localStorage['CenterLon'] = state.lon;

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

    /*
    mapOptions = {
        center: latLng,
        zoom: 14,
        mapTypeId: google.maps.MapTypeId.ROADMAP
    };
    */
    
    
    // Get current map settings
    //CenterLat = Number(localStorage['CenterLat']) || latL;
    //CenterLon = Number(localStorage['CenterLon']) || CONST_CENTERLON;
    ZoomLvl   = Number(localStorage['ZoomLvl']) || 5;
	// Make a list of all the available map IDs
	var mapTypeIds = [];
	for(var type in google.maps.MapTypeId) {
		mapTypeIds.push(google.maps.MapTypeId[type]);
	}
	// Push OSM on to the end
	mapTypeIds.push("OSM");
	mapTypeIds.push("dark_map");

	// Styled Map to outline airports and highways
	var styles = [
		{
			"featureType": "administrative",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "landscape",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "poi",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "road",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "transit",
			"stylers": [
				{ "visibility": "off" }
			]
		},{
			"featureType": "landscape",
			"stylers": [
				{ "visibility": "on" },
				{ "weight": 8 },
				{ "color": "#000000" }
			]
		},{
			"featureType": "water",
			"stylers": [
			{ "lightness": -74 }
			]
		},{
			"featureType": "transit.station.airport",
			"stylers": [
				{ "visibility": "on" },
				{ "weight": 8 },
				{ "invert_lightness": true },
				{ "lightness": 27 }
			]
		},{
			"featureType": "road.highway",
			"stylers": [
				{ "visibility": "simplified" },
				{ "invert_lightness": true },
				{ "gamma": 0.3 }
			]
		},{
			"featureType": "road",
			"elementType": "labels",
			"stylers": [
				{ "visibility": "off" }
			]
		}
	]

	// Add our styled map
	var styledMap = new google.maps.StyledMapType(styles, {name: "Dark Map"});

	// Define the Google Map
	var mapOptions = {
		center: latLng, // new google.maps.LatLng(CenterLat, CenterLon),
		zoom: ZoomLvl,
		mapTypeId: google.maps.MapTypeId.ROADMAP,
		mapTypeControl: true,
		streetViewControl: false,
		mapTypeControlOptions: {
			mapTypeIds: mapTypeIds,
			position: google.maps.ControlPosition.TOP_LEFT,
			style: google.maps.MapTypeControlStyle.DROPDOWN_MENU
		}
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

    
	//Define OSM map type pointing at the OpenStreetMap tile server
	map.mapTypes.set("OSM", new google.maps.ImageMapType({
		getTileUrl: function(coord, zoom) {
			return "http://tile.openstreetmap.org/" + zoom + "/" + coord.x + "/" + coord.y + ".png";
		},
		tileSize: new google.maps.Size(256, 256),
		name: "OpenStreetMap",
		maxZoom: 18
	}));

	map.mapTypes.set("dark_map", styledMap);
    
	// Listeners for newly created Map
    google.maps.event.addListener(map, 'center_changed', function() {
        localStorage['CenterLat'] = map.getCenter().lat();
        localStorage['CenterLon'] = map.getCenter().lng();
    });
    
    google.maps.event.addListener(map, 'zoom_changed', function() {
        localStorage['ZoomLvl']  = map.getZoom();
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



// This looks for planes to reap out of the master Planes variable
function reaper() {
	PlanesToReap = 0;
	// When did the reaper start?
	reaptime = new Date().getTime();
	// Loop the planes
	for (var reap in Planes) {
		// Is this plane possibly reapable?
		if (Planes[reap].reapable == true) {
			// Has it not been seen for 5 minutes?
			// This way we still have it if it returns before then
			// Due to loss of signal or other reasons
			if ((reaptime - Planes[reap].updated) > 300000) {
				// Reap it.
				delete Planes[reap];
			}
			PlanesToReap++;
		}
	};
} 

// Refresh the detail window about the plane
function refreshSelected() {
    var selected = false;
	if (typeof SelectedPlane !== 'undefined' && SelectedPlane != "ICAO" && SelectedPlane != null) {
    	selected = Planes[SelectedPlane];
    }
	
	var columns = 2;
	var html = '';
	
	if (selected) {
    	html += '<table id="selectedinfo" width="100%">';
    } else {
        html += '<table id="selectedinfo" class="dim" width="100%">';
    }
	
	// Flight header line including squawk if needed
	if (selected && selected.flight == "") {
	    html += '<tr><td colspan="' + columns + '" id="selectedinfotitle"><b>N/A (' +
	        selected.icao + ')</b>';
	} else if (selected && selected.flight != "") {
	    html += '<tr><td colspan="' + columns + '" id="selectedinfotitle"><b>' +
	        selected.flight + '</b>';
	} else {
	    html += '<tr><td colspan="' + columns + '" id="selectedinfotitle"><b>DUMP1090</b>';
	}
	
	if (selected && selected.squawk == 7500) { // Lets hope we never see this... Aircraft Hijacking
		html += '&nbsp;<span class="squawk7500">&nbsp;Squawking: Aircraft Hijacking&nbsp;</span>';
	} else if (selected && selected.squawk == 7600) { // Radio Failure
		html += '&nbsp;<span class="squawk7600">&nbsp;Squawking: Radio Failure&nbsp;</span>';
	} else if (selected && selected.squawk == 7700) { // General Emergency
		html += '&nbsp;<span class="squawk7700">&nbsp;Squawking: General Emergency&nbsp;</span>';
	} else if (selected && selected.flight != '') {
		html += '&nbsp;<a href="http://fr24.com/'+selected.flight+'" target="_blank">[FR24]</a>';
	    html += '&nbsp;<a href="http://www.flightstats.com/go/FlightStatus/flightStatusByFlight.do?';
        html += 'flightNumber='+selected.flight+'" target="_blank">[FlightStats]</a>';
	    html += '&nbsp;<a href="http://flightaware.com/live/flight/'+selected.flight+'" target="_blank">[FlightAware]</a>';
	}
	html += '<td></tr>';
	
	if (selected) {
	    if (Metric) {
        	html += '<tr><td>Altitude: ' + Math.round(selected.altitude / 3.2828) + ' m</td>';
        } else {
            html += '<tr><td>Altitude: ' + selected.altitude + ' ft</td>';
        }
    } else {
        html += '<tr><td>Altitude: n/a</td>';
    }
		
	if (selected && selected.squawk != '0000') {
		html += '<td>Squawk: ' + selected.squawk + '</td></tr>';
	} else {
	    html += '<td>Squawk: n/a</td></tr>';
	}
	
	html += '<tr><td>Speed: ' 
	if (selected) {
	    if (Metric) {
	        html += Math.round(selected.speed * 1.852) + ' km/h';
	    } else {
	        html += selected.speed + ' kt';
	    }
	} else {
	    html += 'n/a';
	}
	html += '</td>';
	
	if (selected) {
        html += '<td>ICAO (hex): ' + selected.icao + '</td></tr>';
    } else {
        html += '<td>ICAO (hex): n/a</td></tr>'; // Something is wrong if we are here
    }
    
    html += '<tr><td>Track: ' 
	if (selected && selected.vTrack) {
	    html += selected.track + '&deg;' + ' (' + normalizeTrack(selected.track, selected.vTrack)[1] +')';
	} else {
	    html += 'n/a';
	}
	html += '</td><td>&nbsp;</td></tr>';

	html += '<tr><td colspan="' + columns + '" align="center">Lat/Long: ';
	if (selected && selected.vPosition) {
	    html += selected.latitude + ', ' + selected.longitude + '</td></tr>';
	    
	    // Let's show some extra data if we have site coordinates
	    if (SiteShow) {
            //var siteLatLon  = new google.maps.LatLng(SiteLat, SiteLon);
            var planeLatLon = new google.maps.LatLng(selected.latitude, selected.longitude);
            var dist = google.maps.geometry.spherical.computeDistanceBetween (latLng, planeLatLon);
            
            if (Metric) {
                dist /= 1000;
            } else {
                dist /= 1852;
            }
            dist = (Math.round((dist)*10)/10).toFixed(1);
            html += '<tr><td colspan="' + columns + '" align="center">Distance from Site: ' + dist +
                (Metric ? ' km' : ' NM') + '</td></tr>';
        } // End of SiteShow
	} else {
	    if (SiteShow) {
	        html += '<tr><td colspan="' + columns + '" align="center">Distance from Site: n/a ' + 
	            (Metric ? ' km' : ' NM') + '</td></tr>';
	    } else {
    	    html += 'n/a</td></tr>';
    	}
	}

	html += '</table>';
	
	document.getElementById('plane_detail').innerHTML = html;
}

// Right now we have no means to validate the speed is good
// Want to return (n/a) when we dont have it
// TODO: Edit C code to add a valid speed flag
// TODO: Edit js code to use said flag
function normalizeSpeed(speed, valid) {
	return speed	
}

// Returns back a long string, short string, and the track if we have a vaild track path
function normalizeTrack(track, valid){
	x = []
	if ((track > -1) && (track < 22.5)) {
		x = ["North", "N", track]
	}
	if ((track > 22.5) && (track < 67.5)) {
		x = ["North East", "NE", track]
	}
	if ((track > 67.5) && (track < 112.5)) {
		x = ["East", "E", track]
	}
	if ((track > 112.5) && (track < 157.5)) {
		x = ["South East", "SE", track]
	}
	if ((track > 157.5) && (track < 202.5)) {
		x = ["South", "S", track]
	}
	if ((track > 202.5) && (track < 247.5)) {
		x = ["South West", "SW", track]
	}
	if ((track > 247.5) && (track < 292.5)) {
		x = ["West", "W", track]
	}
	if ((track > 292.5) && (track < 337.5)) {
		x = ["North West", "NW", track]
	}
	if ((track > 337.5) && (track < 361)) {
		x = ["North", "N", track]
	}
	if (!valid) {
		x = [" ", "n/a", ""]
	}
	return x
}

// Refeshes the larger table of all the planes
function refreshTableInfo() {
	var html = '<table id="tableinfo" width="100%">';
	html += '<thead style="background-color: #BBBBBB; cursor: pointer;">';
	html += '<td onclick="setASC_DESC(\'0\');sortTable(\'tableinfo\',\'0\');">ICAO</td>';
	html += '<td onclick="setASC_DESC(\'1\');sortTable(\'tableinfo\',\'1\');">Flight</td>';
	html += '<td onclick="setASC_DESC(\'2\');sortTable(\'tableinfo\',\'2\');" ' +
	    'align="right">Squawk</td>';
	html += '<td onclick="setASC_DESC(\'3\');sortTable(\'tableinfo\',\'3\');" ' +
	    'align="right">Altitude</td>';
	html += '<td onclick="setASC_DESC(\'4\');sortTable(\'tableinfo\',\'4\');" ' +
	    'align="right">Speed</td>';
        // Add distance column header to table if site coordinates are provided
        if (SiteShow && (typeof SiteLat !==  'undefined' || typeof SiteLon !==  'undefined')) {
            html += '<td onclick="setASC_DESC(\'5\');sortTable(\'tableinfo\',\'5\');" ' +
                'align="right">Distance</td>';
        }
	html += '<td onclick="setASC_DESC(\'5\');sortTable(\'tableinfo\',\'6\');" ' +
	    'align="right">Track</td>';
	html += '<td onclick="setASC_DESC(\'6\');sortTable(\'tableinfo\',\'7\');" ' +
	    'align="right">Msgs</td>';
	html += '<td onclick="setASC_DESC(\'7\');sortTable(\'tableinfo\',\'8\');" ' +
	    'align="right">Seen</td></thead><tbody>';
	for (var tablep in Planes) {
		var tableplane = Planes[tablep]
		if (!tableplane.reapable) {
			var specialStyle = "";
			// Is this the plane we selected?
			if (tableplane.icao == SelectedPlane) {
				specialStyle += " selected";
			}
			// Lets hope we never see this... Aircraft Hijacking
			if (tableplane.squawk == 7500) {
				specialStyle += " squawk7500";
			}
			// Radio Failure
			if (tableplane.squawk == 7600) {
				specialStyle += " squawk7600";
			}
			// Emergancy
			if (tableplane.squawk == 7700) {
				specialStyle += " squawk7700";
			}
			
			if (tableplane.vPosition == true) {
				html += '<tr class="plane_table_row vPosition' + specialStyle + '">';
			} else {
				html += '<tr class="plane_table_row ' + specialStyle + '">';
		    }
		    
			html += '<td>' + tableplane.icao + '</td>';
			html += '<td>' + tableplane.flight + '</td>';
			if (tableplane.squawk != '0000' ) {
    			html += '<td align="right">' + tableplane.squawk + '</td>';
    	    } else {
    	        html += '<td align="right">&nbsp;</td>';
    	    }
    	    
    	    if (Metric) {
    			html += '<td align="right">' + Math.round(tableplane.altitude / 3.2828) + '</td>';
    			html += '<td align="right">' + Math.round(tableplane.speed * 1.852) + '</td>';
    	    } else {
    	        html += '<td align="right">' + tableplane.altitude + '</td>';
    	        html += '<td align="right">' + tableplane.speed + '</td>';
    	    }
                        // Add distance column to table if site coordinates are provided
                        if (SiteShow && (typeof SiteLat !==  'undefined' || typeof SiteLon !==  'undefined')) {
                        html += '<td align="right">';
                            if (tableplane.vPosition) {
                                //var siteLatLon  = new google.maps.LatLng(SiteLat, SiteLon);
                                var planeLatLon = new google.maps.LatLng(tableplane.latitude, tableplane.longitude);
                                var dist = google.maps.geometry.spherical.computeDistanceBetween (latLng, planeLatLon);
                                    if (Metric) {
                                        dist /= 1000;
                                    } else {
                                        dist /= 1852;
                                    }
                                dist = (Math.round((dist)*10)/10).toFixed(1);
                                html += dist;
                            } else {
                            html += '0';
                            }
                            html += '</td>';
                        }
			
			html += '<td align="right">';
			if (tableplane.vTrack) {
    			 html += normalizeTrack(tableplane.track, tableplane.vTrack)[2];
    			 // html += ' (' + normalizeTrack(tableplane.track, tableplane.vTrack)[1] + ')';
    	    } else {
    	        html += '&nbsp;';
    	    }
    	    html += '</td>';
			html += '<td align="right">' + tableplane.messages + '</td>';
			html += '<td align="right">' + tableplane.seen + '</td>';
			html += '</tr>';
		}
	}
	html += '</tbody></table>';

	document.getElementById('planes_table').innerHTML = html;

	if (SpecialSquawk) {
    	$('#SpecialSquawkWarning').css('display', 'inline');
    } else {
        $('#SpecialSquawkWarning').css('display', 'none');
    }

	// Click event for table
	$('#planes_table').find('tr').click( function(){
		var hex = $(this).find('td:first').text();
		if (hex != "ICAO") {
			selectPlaneByHex(hex);
			refreshTableInfo();
			refreshSelected();
		}
	});

	sortTable("tableinfo");
}

// Credit goes to a co-worker that needed a similar functions for something else
// we get a copy of it free ;)
function setASC_DESC(iCol) {
	if(iSortCol==iCol) {
		bSortASC=!bSortASC;
	} else {
		bSortASC=bDefaultSortASC;
	}
}

function sortTable(szTableID,iCol) { 
	//if iCol was not provided, and iSortCol is not set, assign default value
	if (typeof iCol==='undefined'){
		if(iSortCol!=-1){
			var iCol=iSortCol;
                } else if (SiteShow && (typeof SiteLat !==  'undefined' || typeof SiteLon !==  'undefined')) {
                        var iCol=5;
		} else {
			var iCol=iDefaultSortCol;
		}
	}

	//retrieve passed table element
	var oTbl=document.getElementById(szTableID).tBodies[0];
	var aStore=[];

	//If supplied col # is greater than the actual number of cols, set sel col = to last col
	if (typeof oTbl.rows[0] !== 'undefined' && oTbl.rows[0].cells.length <= iCol) {
		iCol=(oTbl.rows[0].cells.length-1);
    }

	//store the col #
	iSortCol=iCol;

	//determine if we are delaing with numerical, or alphanumeric content
	var bNumeric = false;
	if ((typeof oTbl.rows[0] !== 'undefined') &&
	    (!isNaN(parseFloat(oTbl.rows[0].cells[iSortCol].textContent ||
	    oTbl.rows[0].cells[iSortCol].innerText)))) {
	    bNumeric = true;
	}

	//loop through the rows, storing each one inro aStore
	for (var i=0,iLen=oTbl.rows.length;i<iLen;i++){
		var oRow=oTbl.rows[i];
		vColData=bNumeric?parseFloat(oRow.cells[iSortCol].textContent||oRow.cells[iSortCol].innerText):String(oRow.cells[iSortCol].textContent||oRow.cells[iSortCol].innerText);
		aStore.push([vColData,oRow]);
	}

	//sort aStore ASC/DESC based on value of bSortASC
	if (bNumeric) { //numerical sort
		aStore.sort(function(x,y){return bSortASC?x[0]-y[0]:y[0]-x[0];});
	} else { //alpha sort
		aStore.sort();
		if(!bSortASC) {
			aStore.reverse();
	    }
	}

	//rewrite the table rows to the passed table element
	for(var i=0,iLen=aStore.length;i<iLen;i++){
		oTbl.appendChild(aStore[i][1]);
	}
	aStore=null;
}

function selectPlaneByHex(hex) {
	// If SelectedPlane has something in it, clear out the selected
	if (SelectedPlane != null) {
		Planes[SelectedPlane].is_selected = false;
		Planes[SelectedPlane].funcClearLine();
		Planes[SelectedPlane].markerColor = MarkerColor;
		// If the selected has a marker, make it not stand out
		if (Planes[SelectedPlane].marker) {
			Planes[SelectedPlane].marker.setIcon(Planes[SelectedPlane].funcGetIcon());
		}
	}

	// If we are clicking the same plane, we are deselected it.
	if (String(SelectedPlane) != String(hex)) {
		// Assign the new selected
		SelectedPlane = hex;
		Planes[SelectedPlane].is_selected = true;
		// If the selected has a marker, make it stand out
		if (Planes[SelectedPlane].marker) {
			Planes[SelectedPlane].funcUpdateLines();
			Planes[SelectedPlane].marker.setIcon(Planes[SelectedPlane].funcGetIcon());
		}
	} else { 
		SelectedPlane = null;
	}
    refreshSelected();
    refreshTableInfo();
}


var planeObject = {
	oldlat		: null,
	oldlon		: null,
	oldalt		: null,

	// Basic location information
	altitude	: null,
	speed		: null,
	track		: null,
	latitude	: null,
	longitude	: null,
	
	// Info about the plane
	flight		: null,
	squawk		: null,
	icao		: null,
	is_selected	: false,	

	// Data packet numbers
	messages	: null,
	seen		: null,

	// Vaild...
	vPosition	: false,
	vTrack		: false,

	// GMap Details
	marker		: null,
	markerColor	: MarkerColor,
	lines		: [],
	trackdata	: new Array(),
	trackline	: new Array(),

	// When was this last updated?
	updated		: null,
	reapable	: false,

	// Appends data to the running track so we can get a visual tail on the plane
	// Only useful for a long running browser session.
	funcAddToTrack	: function(){
			// TODO: Write this function out
			this.trackdata.push([this.latitude, this.longitude, this.altitude, this.track, this.speed]);
			this.trackline.push(new google.maps.LatLng(this.latitude, this.longitude));
		},

	// This is to remove the line from the screen if we deselect the plane
	funcClearLine	: function() {
			if (this.line) {
				this.line.setMap(null);
				this.line = null;
			}
		},

	// Should create an icon for us to use on the map...
	funcGetIcon	: function() {
			this.markerColor = MarkerColor;
			// If this marker is selected we should make it lighter than the rest.
			if (this.is_selected == true) {
				this.markerColor = SelectedColor;
			}

			// If we have not seen a recent update, change color
			if (this.seen > 15) {
				this.markerColor = StaleColor;
			}
			
			// Plane marker
            var baseSvg = {
                planeData : "M 1.9565564,41.694305 C 1.7174505,40.497708 1.6419973,38.448747 " +
                    "1.8096508,37.70494 1.8936398,37.332056 2.0796653,36.88191 2.222907,36.70461 " +
                    "2.4497603,36.423844 4.087816,35.47248 14.917931,29.331528 l 12.434577," +
                    "-7.050718 -0.04295,-7.613412 c -0.03657,-6.4844888 -0.01164,-7.7625804 " +
                    "0.168134,-8.6194061 0.276129,-1.3160905 0.762276,-2.5869575 1.347875," +
                    "-3.5235502 l 0.472298,-0.7553719 1.083746,-0.6085497 c 1.194146,-0.67053522 " +
                    "1.399524,-0.71738842 2.146113,-0.48960552 1.077005,0.3285939 2.06344," +
                    "1.41299352 2.797602,3.07543322 0.462378,1.0469993 0.978731,2.7738408 " +
                    "1.047635,3.5036272 0.02421,0.2570284 0.06357,3.78334 0.08732,7.836246 0.02375," +
                    "4.052905 0.0658,7.409251 0.09345,7.458546 0.02764,0.04929 5.600384,3.561772 " +
                    "12.38386,7.805502 l 12.333598,7.715871 0.537584,0.959688 c 0.626485,1.118378 " +
                    "0.651686,1.311286 0.459287,3.516442 -0.175469,2.011604 -0.608966,2.863924 " +
                    "-1.590344,3.127136 -0.748529,0.200763 -1.293144,0.03637 -10.184829,-3.07436 " +
                    "C 48.007733,41.72562 44.793806,40.60197 43.35084,40.098045 l -2.623567," +
                    "-0.916227 -1.981212,-0.06614 c -1.089663,-0.03638 -1.985079,-0.05089 -1.989804," +
                    "-0.03225 -0.0052,0.01863 -0.02396,2.421278 -0.04267,5.339183 -0.0395,6.147742 " +
                    "-0.143635,7.215456 -0.862956,8.845475 l -0.300457,0.680872 2.91906,1.361455 " +
                    "c 2.929379,1.366269 3.714195,1.835385 4.04589,2.41841 0.368292,0.647353 " +
                    "0.594634,2.901439 0.395779,3.941627 -0.0705,0.368571 -0.106308,0.404853 " +
                    "-0.765159,0.773916 L 41.4545,62.83158 39.259237,62.80426 c -6.030106,-0.07507 " +
                    "-16.19508,-0.495041 -16.870991,-0.697033 -0.359409,-0.107405 -0.523792," +
                    "-0.227482 -0.741884,-0.541926 -0.250591,-0.361297 -0.28386,-0.522402 -0.315075," +
                    "-1.52589 -0.06327,-2.03378 0.23288,-3.033615 1.077963,-3.639283 0.307525," +
                    "-0.2204 4.818478,-2.133627 6.017853,-2.552345 0.247872,-0.08654 0.247455," +
                    "-0.102501 -0.01855,-0.711959 -0.330395,-0.756986 -0.708622,-2.221756 -0.832676," +
                    "-3.224748 -0.05031,-0.406952 -0.133825,-3.078805 -0.185533,-5.937448 -0.0517," +
                    "-2.858644 -0.145909,-5.208974 -0.209316,-5.222958 -0.06341,-0.01399 -0.974464," +
                    "-0.0493 -2.024551,-0.07845 L 23.247235,38.61921 18.831373,39.8906 C 4.9432155," +
                    "43.88916 4.2929558,44.057819 3.4954426,43.86823 2.7487826,43.690732 2.2007966," +
                    "42.916622 1.9565564,41.694305 z"
            };

			// If the squawk code is one of the international emergency codes,
			// match the info window alert color.
			if (this.squawk == 7500) {
				this.markerColor = "rgb(255, 85, 85)";
			}
			if (this.squawk == 7600) {
				this.markerColor = "rgb(0, 255, 255)";
			}
			if (this.squawk == 7700) {
				this.markerColor = "rgb(255, 255, 0)";
			}

			// If we have not overwritten color by now, an extension still could but
			// just keep on trucking.  :)

			return {
                strokeWeight: (this.is_selected ? 2 : 1),
                path:  "M 0,0 "+ baseSvg["planeData"],
                scale: 0.4,
                fillColor: this.markerColor,
                fillOpacity: 0.9,
                anchor: new google.maps.Point(32, 32), // Set anchor to middle of plane.
                rotation: this.track
            };
		},

	// TODO: Trigger actions of a selecting a plane
	funcSelectPlane	: function(selectedPlane){
			selectPlaneByHex(this.icao);
		},

	// Update our data
	funcUpdateData	: function(data){
			// So we can find out if we moved
			var oldlat 	= this.latitude;
			var oldlon	= this.longitude;
			var oldalt	= this.altitude;

			// Update all of our data
			this.updated	= new Date().getTime();
			this.altitude	= data.altitude;
			this.speed	= data.speed;
			this.track	= data.track;
			this.latitude	= data.lat;
			this.longitude	= data.lon;
			this.flight	= data.flight;
			this.squawk	= data.squawk;
			this.icao	= data.hex;
			this.messages	= data.messages;
			this.seen	= data.seen;

			// If no packet in over 58 seconds, consider the plane reapable
			// This way we can hold it, but not show it just in case the plane comes back
			if (this.seen > 58) {
				this.reapable = true;
				if (this.marker) {
					this.marker.setMap(null);
					this.marker = null;
				}
				if (this.line) {
					this.line.setMap(null);
					this.line = null;
				}
				if (SelectedPlane == this.icao) {
					if (this.is_selected) {
						this.is_selected = false;
					}
					SelectedPlane = null;
				}
			} else {
				if (this.reapable == true) {
				}
				this.reapable = false;
			}

			// Is the position valid?
			if ((data.validposition == 1) && (this.reapable == false)) {
				this.vPosition = true;

				// Detech if the plane has moved
				changeLat = false;
				changeLon = false;
				changeAlt = false;
				if (oldlat != this.latitude) {
					changeLat = true;
				}
				if (oldlon != this.longitude) {
					changeLon = true;
				}
				if (oldalt != this.altitude) {
					changeAlt = true;
				}
				// Right now we only care about lat/long, if alt is updated only, oh well
				if ((changeLat == true) || (changeLon == true)) {
					this.funcAddToTrack();
					if (this.is_selected) {
						this.line = this.funcUpdateLines();
					}
				}
				this.marker = this.funcUpdateMarker();
				PlanesOnMap++;
			} else {
				this.vPosition = false;
			}

			// Do we have a valid track for the plane?
			if (data.validtrack == 1)
				this.vTrack = true;
			else
				this.vTrack = false;
		},

	// Update our marker on the map
	funcUpdateMarker: function() {
			if (this.marker) {
				this.marker.setPosition(new google.maps.LatLng(this.latitude, this.longitude));
				this.marker.setIcon(this.funcGetIcon());
			} else {
				this.marker = new google.maps.Marker({
					position: new google.maps.LatLng(this.latitude, this.longitude),
					map: map,
					icon: this.funcGetIcon(),
					visable: true
				});

				// This is so we can match icao address
				this.marker.icao = this.icao;

				// Trap clicks for this marker.
				google.maps.event.addListener(this.marker, 'click', this.funcSelectPlane);
			}

			// Setting the marker title
			if (this.flight.length == 0) {
				this.marker.setTitle(this.hex);
			} else {
				this.marker.setTitle(this.flight+' ('+this.icao+')');
			}
			return this.marker;
		},

	// Update our planes tail line,
	// TODO: Make this multi colored based on options
	//		altitude (default) or speed
	funcUpdateLines: function() {
			if (this.line) {
				var path = this.line.getPath();
				path.push(new google.maps.LatLng(this.latitude, this.longitude));
			} else {
				this.line = new google.maps.Polyline({
					strokeColor: '#000000',
					strokeOpacity: 1.0,
					strokeWeight: 3,
					map: map,
					path: this.trackline
				});
			}
			return this.line;
		}
};
