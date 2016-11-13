**GPS / Wifi logger for Raspberry Pi**
===========

This is an attempt to build a minimalistic GPS + Wifi logger for war walking.
Minimal-sized setup for this build is a Pi Zero + Serial GPS + Wifi USB Dongle, it fits in the pocket!
The collected data can be rendered later or observed in realtime through the HTML5 GUI.


**OS/System Requirements:**
----

- Raspbian Jessie
- NodeJS
- ForeverJS (https://github.com/foreverjs/forever)
- gpsd (http://catb.org/gpsd/)
- GPS device connected to the Pi
- Wifi device connected to the Pi
- A valid Google Maps Api key (https://developers.google.com/maps/documentation/javascript/get-api-key)
- [optional] gammu-smsd (https://wammu.eu/gammu/)
- [optional] A GSM/GPRS device

**Installation:**
----

Assuming all devices are plugged and properly detected, install gpsd

    sudo apt-get install gpsd

Edit your `/etc/defaults/gpsd` to setup your own GPS tty and restart

    sudo service gpsd restart

You need *forever.js* installed globally to run this project headless

    sudo npm install forever -g

Clone the repository and install

    npm install

Put your Google Maps Api key in the `.env` file

    cp .env.example .env
    nano .env

Test the app

    node index.js

You can add to `/etc/rc.local` and reboot:

    cd /home/pi/rpi-gps-wifi/ && /opt/nodejs/bin/forever start index.js


****
**Useful links**
----
  * http://www.catb.org/gpsd/troubleshooting.html
  * http://www.xarg.org/2016/06/neo6mv2-gps-module-with-raspberry-pi/
  * https://bigdanzblog.wordpress.com/2015/01/18/connecting-u-blox-neo-6m-gps-to-raspberry-pi/
  * http://www.bashpi.org/?page_id=459

****
**Roadmap**
----
* Enable GSM/GPRS data collection using sim900 / sim800
* Enable rogue mode + sms/ppp notifications
* Compliance with more advanced wifi tools and platforms (e.g. Kali)
