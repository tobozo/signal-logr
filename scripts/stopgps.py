# -*- coding: utf-8 -*-
#
# stopgps.py
# Script to stop GPS from spamming the serial
#
import wiringpi
import serial
import time, sys
import datetime
import os, signal
import argparse

##############Begin process command line ###########
parser = argparse.ArgumentParser(description='Enable GPS and display output')

parser.add_argument('--port', '-p',
                    help='Serial port',
                    type=str,
                    default='/dev/ttyAMA0')

args = parser.parse_args()
serial_port = args.port
##############End process command line ###########

# Wait for the nadhat answer
def wait_Answer(code):
    time.sleep(0.3)
    rep = ser.read(ser.inWaiting()) # Check if the board answers
    if rep != "":
        if code in rep:
            print "Answers : "+code
        else :
            print code+" not received : No communication with the board"
            sys.exit(0)
    else :
        print "No response from the board"
        sys.exit(1)

# Serial port init
ser = serial.Serial(
    port = serial_port,
    baudrate = 115200,
    parity = serial.PARITY_NONE,
    stopbits = serial.STOPBITS_ONE,
    bytesize = serial.EIGHTBITS
)

# Check the communication with the nadhat board
ser.write("AT\r") # Send AT command
print "AT\r"
wait_Answer("OK")

print "AT+CGNSTST=0\r" # turn off data sending (otherwise wait_Answer might raise false positives)

print "END"







