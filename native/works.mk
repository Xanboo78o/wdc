# XBR Works, the car editor. Its own makefile so it can be built while the
# game's is being worked on: `make -C native -f works.mk`.
CXX      ?= g++
CXXFLAGS ?= -O2 -g -std=c++20 -Wall -Wextra -Wno-unused-parameter
BUILD    := build
CFLAGS_W := $(shell pkg-config --cflags sdl3 epoxy freetype2)
LIBS_W   := $(shell pkg-config --libs sdl3 epoxy freetype2) -lm

$(BUILD)/xbr-works: $(BUILD)/works/bricks.o $(BUILD)/works/works_main.o
	$(CXX) $(CXXFLAGS) -o $@ $^ $(LIBS_W)

$(BUILD)/works/%.o: src/%.cpp src/bricks.hpp src/json.hpp
	@mkdir -p $(BUILD)/works
	$(CXX) $(CXXFLAGS) $(CFLAGS_W) -c -o $@ $<
