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
GAME := game_main.cpp render.cpp audio.cpp bridge.cpp carmesh.cpp ui.cpp home.cpp dress.cpp fx.cpp career.cpp home_career.cpp

SIM_O  := $(SIM:%.cpp=$(BUILD)/%.o)
GAME_O := $(GAME:%.cpp=$(BUILD)/%.o)

GAME_CFLAGS := $(shell pkg-config --cflags sdl3 epoxy freetype2)
GAME_LIBS   := $(shell pkg-config --libs sdl3 epoxy freetype2) -lm

# The photographs the browser game uses (data/tex, CC0 from ambientCG), turned
# into plain PPMs at build time so the game needs no JPEG decoder of its own.
TEXN := tarmac grass gravel concrete plaster apron sand
TEX  := $(foreach t,$(TEXN),$(BUILD)/tex/$(t)-c.ppm $(BUILD)/tex/$(t)-n.ppm)

# The plant photographs (data/flora, CC0 from ambientCG) and the two banners
# laid out of them (tools/bakestrips.mjs), as plain PAMs with their cut-out in
# the alpha: dress.cpp's woods.
FLORA := $(foreach t,leaf needle short tall bark,$(BUILD)/tex/flora-$(t).pam)
# (a rule above `all` would become the default goal — it did, once, and nothing else was rebuilt)
.DEFAULT_GOAL := all
# and the sticker sheet the liveries are cut from (tools/livery/bakeatlas.mjs)
FLORA += $(BUILD)/tex/livery-atlas.pam
$(BUILD)/tex/livery-atlas.pam: ../data/livery/atlas.png | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $< -depth 8 pam:$@

all: $(BUILD)/xbr-drive $(BUILD)/xbr-race $(BUILD)/xbr $(TEX) $(FLORA)

$(BUILD)/tex/flora-leaf.pam: ../data/flora/leaf-c.jpg ../data/flora/leaf-a.png | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $^ -alpha off -compose CopyOpacity -composite -resize 1024x1024! -depth 8 pam:$@
$(BUILD)/tex/flora-needle.pam: ../data/flora/needle-c.jpg ../data/flora/needle-a.png | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $^ -alpha off -compose CopyOpacity -composite -resize 1024x1024! -depth 8 pam:$@
$(BUILD)/tex/flora-short.pam: ../data/flora/strip-short.png | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $< -resize 1024x1024! -depth 8 pam:$@
$(BUILD)/tex/flora-tall.pam: ../data/flora/strip-tall.png | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $< -resize 1024x1024! -depth 8 pam:$@
$(BUILD)/tex/flora-bark.pam: ../data/flora/bark-c.jpg | $(BUILD)
	@mkdir -p $(BUILD)/tex
	magick $< -resize 1024x1024! -alpha opaque -depth 8 pam:$@
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
