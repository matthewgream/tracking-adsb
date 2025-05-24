
SOURCES = airports-data.js config.js radar-script.js 

prettier:
	prettier --write $(SOURCES) *.mjs
lint:
	eslint $(SOURCES)

.PHONY: all prettier lint

