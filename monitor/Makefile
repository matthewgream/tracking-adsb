
SYSTEM = adsb
TARGET = monitor
SOURCES = $(TARGET) fetch *.js
SCRIPTS = watcher

##

prettier:
	prettier --write $(SOURCES)
	shfmt -i 4 -w $(SCRIPTS)
lint:
	eslint $(SOURCES)
test: $(TARGET)
	./$(TARGET)
watcher:
	 stdbuf -i0 -o0 -e0  mosquitto_sub -t "adsb/#" -v | ./watcher --warnings --raw-text
.PHONY: all clean format test lint

##

SYSTEMD_DIR = /etc/systemd/system
define install_systemd_service
	-systemctl stop $(1) 2>/dev/null || true
	-systemctl disable $(1) 2>/dev/null || true
	cp $(2).service $(SYSTEMD_DIR)/$(1).service
	systemctl daemon-reload
	systemctl enable $(1)
	systemctl start $(1) || echo "Warning: Failed to start $(1)"
endef
install_systemd_service: $(TARGET).service
	$(call install_systemd_service,$(SYSTEM)-$(TARGET),$(TARGET))
install: install_systemd_service
restart:
	systemctl restart $(TARGET)
.PHONY: install install_systemd_service restart

