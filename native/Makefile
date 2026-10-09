# XBR, native. `make` builds both binaries into native/build/.
#
#   xbr-drive   the headless gate (sim core only, links nothing graphical)
#   xbr-race    a whole race, headless (sim core + race layer, nothing graphical)
#   xbr         the game (SDL3 + OpenGL)
#
# No CMake on purpose: g++, make and SDL3 are all this needs.
CXX      ?= g++
CXXFLAGS ?= -O2 -g -std=c++20 -Wall -Wextra -Wno-unused-parameter
# The port is checked against the JS, which is IEEE doubles evaluated in source
# order. Keep the compiler from contracting a*b+c into one fused operation, or
# the two builds drift apart in the last bit and then in the lap time.
CXXFLAGS += -ffp-contract=off
BUILD    := build

SIM  := physics.cpp parts.cpp track.cpp driver.cpp collide.cpp world.cpp
# the race layer: js/race.js and everything it imports that is pure logic
SIM  += grid.cpp drivers.cpp pitstop.cpp xingus.cpp safetycar.cpp race.cpp weather.cpp
GAME := game_main.cpp render.cpp audio.cpp bridge.cpp carmesh.cpp ui.cpp home.cpp dress.cpp

SIM_O  := $(SIM:%.cpp=$(BUILD)/%.o)
GAME_O := $(GAME:%.cpp=$(BUILD)/%.o)

GAME_CFLAGS := $(shell pkg-config --cflags sdl3 epoxy freetype2)
GAME_LIBS   := $(shell pkg-config --libs sdl3 epoxy freetype2) -lm

# The photographs the browser game uses (data/tex, CC0 from ambientCG), turned
# into plain PPMs at build time so the game needs no JPEG decoder of its own.
TEXN := tarmac grass gravel concrete plaster apron sand
TEX  := $(foreach t,$(TEXN),$(BUILD)/tex/$(t)-c.ppm $(BUILD)/tex/$(t)-n.ppm)

all: $(BUILD)/xbr-drive $(BUILD)/xbr-race $(BUILD)/xbr $(TEX)
# the headless tools alone (what native/check.sh needs): `make -C native sim`
sim: $(BUILD)/xbr-drive $(BUILD)/xbr-race

$(BUILD)/xbr-race: $(SIM_O) $(BUILD)/race_main.o
	$(CXX) $(CXXFLAGS) -o $@ $^ -lm

$(BUILD)/tex/%.ppm: ../data/tex/%.jpg | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $< -resize 1024x1024! -depth 8 $@

$(BUILD)/xbr-drive: $(SIM_O) $(BUILD)/drive_main.o
	$(CXX) $(CXXFLAGS) -o $@ $^ -lm

$(BUILD)/xbr: $(SIM_O) $(GAME_O)
	$(CXX) $(CXXFLAGS) -o $@ $^ $(GAME_LIBS)

$(BUILD)/%.o: src/%.cpp $(wildcard src/*.hpp) | $(BUILD)
	$(CXX) $(CXXFLAGS) $(GAME_CFLAGS) -c -o $@ $<

$(BUILD):
	mkdir -p $(BUILD)

clean:
	rm -rf $(BUILD)

.PHONY: all sim clean
