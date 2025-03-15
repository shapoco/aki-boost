.PHONY: test deploy

TEST_PORT = 51680

APP_NAME = aki-boost
JS_NAME = $(APP_NAME).user.js
DIST_URL = "https://github.com/shapoco/$(APP_NAME)/raw/refs/heads/main/dist/"

BIN_DIR = $(shell pwd)/bin
SRC_DIR = src
DIST_DIR = dist

deploy:
	$(BIN_DIR)/increment_revision.py -f "$(SRC_DIR)/$(JS_NAME)"

	@mkdir -p dist
	cp -f "$(SRC_DIR)/$(JS_NAME)" "$(DIST_DIR)/."
	sed -i "$(DIST_DIR)/$(JS_NAME)" -e "s#http://localhost:[0-9]\+/#$(DIST_URL)#g"
	sed -i "$(DIST_DIR)/$(JS_NAME)" -e "s# (Debug)##g"
	sed -i "$(DIST_DIR)/$(JS_NAME)" -e "s#const DEBUG_MODE = true;#const DEBUG_MODE = false;#g"

test:
	python3 -m http.server -d "$(SRC_DIR)" "$(TEST_PORT)"
