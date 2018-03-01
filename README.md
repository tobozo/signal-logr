**GPS / Wifi logger for Raspberry Pi**
===========

This is an attempt to build a minimalistic GPS + Wifi logger for war walking.
Minimal-sized setup for this build is a Pi Zero + Serial GPS + Wifi USB Dongle, it fits in the pocket!
The collected data can be rendered later or observed in realtime through the HTML5 GUI.

<p align="center">
<img src="https://raw.githubusercontent.com/tobozo/signal-logr/master/signal-logr.png" />
</p> 


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
- [optional] A RTL-SDR dongle

**Installation:**
----

**Prerequisites** NodeJS is installed and GPS + Wifi devices are plugged and properly detected.

[optional]
Install RTL-SDR software from https://github.com/MalcolmRobb/dump1090

[optional] (if using GSM/GPRS/GNSS hat instead of external GPS module)
Install GSM/GPRS/GNSS software from WaveShare https://www.waveshare.com/wiki/GSM/GPRS/GNSS_HAT


Install gpsd

    sudo apt-get install gpsd

Edit your `/etc/defaults/gpsd`

    sudo nano /etc/defaults/gpsd

Verify the tty of your GPS device, change if necessary

    DEVICES="/dev/ttyUSB0"

Other values to check

    START_DAEMON="true"
    USBAUTO="false"

Then restart gpsd

    sudo service gpsd restart

You need *forever.js* installed globally to run this project headless

    sudo npm install forever -g

Clone the repository and install

    git clone https://github.com/tobozo/signal-logr.git
    cd signal-logr
    npm install

Put your Google Maps Api key in the `.env` file

    cp .env.example .env
    nano .env

Test the app

    node index.js

You can add to `/etc/rc.local` and reboot

    cd /home/pi/signal-logr/ && /opt/nodejs/bin/forever start index.js


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
