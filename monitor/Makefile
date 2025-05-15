

watch_warnings:
	 stdbuf -i0 -o0 -e0  mosquitto_sub -t "adsb/#" -v | ./watcher --warnings --raw-text

prettier:
	prettier --write fetch monitor *.js
	shfmt -i 4 -w watcher

lint:
	eslint monitor *.js

