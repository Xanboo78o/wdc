# XBR, native. `make` builds both binaries into native/build/.
#
#   xbr-drive   the headless gate (sim core only, links nothing graphical)
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

SIM  := physics.cpp parts.cpp track.cpp driver.cpp collide.cpp
GAME := game_main.cpp render.cpp audio.cpp

SIM_O  := $(SIM:%.cpp=$(BUILD)/%.o)
GAME_O := $(GAME:%.cpp=$(BUILD)/%.o)

GAME_CFLAGS := $(shell pkg-config --cflags sdl3 epoxy)
GAME_LIBS   := $(shell pkg-config --libs sdl3 epoxy) -lm

all: $(BUILD)/xbr-drive $(BUILD)/xbr

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

.PHONY: all clean
